import cron from 'node-cron';
import { ethers } from 'ethers';
import { OG_RPC_URL, FACTORY_ADDRESS } from '../config/main-config.ts';
import { prismaQuery } from '../lib/prisma.ts';
import * as storage from '../lib/og-storage/index.ts';
import * as chain from '../lib/og-chain/index.ts';

import ChallengeFactoryABI from '../lib/og-chain/abi/ChallengeFactory.json';
import ChallengeABI from '../lib/og-chain/abi/Challenge.json';

const provider = new ethers.JsonRpcProvider(OG_RPC_URL);

// Track the last processed block to avoid re-processing
let lastProcessedBlock = 0;

let isRunning = false;

/**
 * Index on-chain events from ChallengeFactory and Challenge contracts.
 * Updates DB with challenge state and caches reputation on 0G Storage KV.
 *
 * Events indexed:
 * - ChallengeCreated (from Factory)
 * - AttemptMade (from each Challenge)
 * - ChallengeWon (from each Challenge)
 * - ChallengeExpired (from each Challenge)
 */
async function indexEvents(): Promise<void> {
  if (isRunning) {
    console.log('[EventIndexer] Previous run still active, skipping...');
    return;
  }
  if (!FACTORY_ADDRESS) {
    console.log('[EventIndexer] FACTORY_ADDRESS not configured, skipping...');
    return;
  }

  isRunning = true;

  try {
    const currentBlock = await provider.getBlockNumber();

    // On first run, look back 1000 blocks (about 8 min on 0G at ~500ms blocks)
    if (lastProcessedBlock === 0) {
      lastProcessedBlock = Math.max(0, currentBlock - 1000);
    }

    // Don't query if no new blocks
    if (currentBlock <= lastProcessedBlock) {
      return;
    }

    // Cap batch size to 2000 blocks to avoid RPC limits
    const fromBlock = lastProcessedBlock + 1;
    const toBlock = Math.min(currentBlock, fromBlock + 2000);

    console.log(`[EventIndexer] Scanning blocks ${fromBlock} to ${toBlock}...`);

    // 1. Index ChallengeCreated events from Factory
    await indexChallengeCreated(fromBlock, toBlock);

    // 2. Index events from all known Challenge contracts
    await indexChallengeEvents(fromBlock, toBlock);

    lastProcessedBlock = toBlock;
  } catch (error) {
    console.error('[EventIndexer] Error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Index ChallengeCreated events from the Factory contract
 */
async function indexChallengeCreated(fromBlock: number, toBlock: number): Promise<void> {
  const factory = new ethers.Contract(FACTORY_ADDRESS, ChallengeFactoryABI, provider);

  const events = await factory.queryFilter(
    factory.filters.ChallengeCreated(),
    fromBlock,
    toBlock
  );

  for (const event of events) {
    const log = event as ethers.EventLog;
    const [challengeAddr, creator, prizePool, messagePrice, name, model, challengeType] = log.args;

    console.log(`[EventIndexer] ChallengeCreated: ${challengeAddr} by ${creator} (${name})`);

    // Upsert in DB (may already exist from POST /challenge/create)
    try {
      await (prismaQuery as any).challenge.upsert({
        where: { contractAddress: challengeAddr },
        create: {
          contractAddress: challengeAddr,
          name: name || 'Unnamed',
          model: model || 'unknown',
          systemPromptEncrypted: '', // Not available from event, stored via POST /create
          systemPromptHash: '',
          defender: creator,
          description: `${Number(challengeType) === 0 ? 'Tournament' : Number(challengeType) === 1 ? 'Bounty' : 'Alignment'} - ${ethers.formatEther(prizePool)} 0G`,
          visibility: 'public',
          difficulty: 'intermediate',
          challengeLabel: Number(challengeType) === 2 ? 'ALIGNMENT' : 'secret_extraction',
        },
        update: {
          name: name || undefined,
          model: model || undefined,
        },
      });
    } catch (err) {
      console.error('[EventIndexer] DB upsert failed:', err);
    }
  }
}

/**
 * Index AttemptMade, ChallengeWon, ChallengeExpired from all known challenges
 */
async function indexChallengeEvents(fromBlock: number, toBlock: number): Promise<void> {
  // Get all challenge addresses from DB
  const challenges = await (prismaQuery as any).challenge.findMany({
    select: { contractAddress: true },
  }) as Array<{ contractAddress: string }>;

  for (const { contractAddress } of challenges) {
    const challenge = new ethers.Contract(contractAddress, ChallengeABI, provider);

    // Index ChallengeWon
    const wonEvents = await challenge.queryFilter(
      challenge.filters.ChallengeWon(),
      fromBlock,
      toBlock
    );

    for (const event of wonEvents) {
      const log = event as ethers.EventLog;
      const [attacker, prize, attemptNumber, chatID] = log.args;

      console.log(`[EventIndexer] ChallengeWon: ${contractAddress} by ${attacker}, prize ${ethers.formatEther(prize)} 0G`);

      // Update reputation cache on 0G Storage KV
      await updateAttackerReputation(attacker, prize, contractAddress);
      await updateDefenderReputation(contractAddress, Number(attemptNumber), true);

      // Fire-and-forget: record on ReputationRegistry
      chain.recordAttackerVictory(attacker, contractAddress, prize)
        .catch(err => console.error('[EventIndexer] recordAttackerVictory failed (non-fatal):', err));

      // Look up defender for breach recording
      try {
        const challengeMeta = await (prismaQuery as any).challenge.findUnique({
          where: { contractAddress },
          select: { defender: true },
        });
        if (challengeMeta?.defender) {
          chain.recordDefenderBreached(challengeMeta.defender, contractAddress, prize)
            .catch(err => console.error('[EventIndexer] recordDefenderBreached failed (non-fatal):', err));
        }
      } catch {}
    }

    // Index ChallengeExpired
    const expiredEvents = await challenge.queryFilter(
      challenge.filters.ChallengeExpired(),
      fromBlock,
      toBlock
    );

    for (const event of expiredEvents) {
      const log = event as ethers.EventLog;
      const [defender, returnedAmount] = log.args;

      console.log(`[EventIndexer] ChallengeExpired: ${contractAddress}, returned ${ethers.formatEther(returnedAmount)} to ${defender}`);

      await updateDefenderReputation(contractAddress, 0, false);
    }
  }
}

/**
 * Update attacker reputation on 0G Storage KV
 */
async function updateAttackerReputation(
  attackerAddress: string,
  prizeWon: bigint,
  challengeAddress: string
): Promise<void> {
  try {
    // Get current stats from DB
    const attempts = await (prismaQuery as any).attempt.findMany({
      where: { attacker: attackerAddress },
    }) as Array<{ judgment: string; owaspCategory: string }>;

    const wins = attempts.filter((a) => a.judgment === 'SUCCESS').length;
    const totalAttempts = attempts.length;

    // Build OWASP breakdown
    const owaspBreakdown: Record<string, number> = {};
    for (const a of attempts.filter((a) => a.judgment === 'SUCCESS')) {
      owaspBreakdown[a.owaspCategory] = (owaspBreakdown[a.owaspCategory] || 0) + 1;
    }

    // Total prize won
    const allWins = await (prismaQuery as any).attempt.findMany({
      where: { attacker: attackerAddress, judgment: 'SUCCESS' },
      select: { challengeAddress: true },
    }) as Array<{ challengeAddress: string }>;

    // Cache on 0G Storage KV
    await storage.setReputation(attackerAddress, {
      role: 'attacker',
      wins,
      totalAttempts,
      totalPrizeWon: Number(ethers.formatEther(prizeWon)),
      winRate: totalAttempts > 0 ? wins / totalAttempts : 0,
      owaspBreakdown,
      lastActive: Date.now(),
    });

    console.log(`[EventIndexer] Updated attacker reputation: ${attackerAddress} (${wins} wins / ${totalAttempts} attempts)`);
  } catch (err) {
    console.error('[EventIndexer] Reputation update failed (non-fatal):', err);
  }
}

/**
 * Update defender reputation on 0G Storage KV
 */
async function updateDefenderReputation(
  challengeAddress: string,
  attemptCount: number,
  breached: boolean
): Promise<void> {
  try {
    const challenge = await (prismaQuery as any).challenge.findUnique({
      where: { contractAddress: challengeAddress },
    });

    if (!challenge) return;

    const defenderAddress = challenge.defender;

    // Count all defender's challenges
    const allChallenges = await (prismaQuery as any).challenge.findMany({
      where: { defender: defenderAddress },
      select: { contractAddress: true },
    }) as Array<{ contractAddress: string }>;

    await storage.setReputation(defenderAddress, {
      role: 'defender',
      wins: 0, // Defenders don't "win" in the same way
      totalAttempts: allChallenges.length,
      totalPrizeWon: 0,
      winRate: 0,
      owaspBreakdown: {},
      lastActive: Date.now(),
    });

    console.log(`[EventIndexer] Updated defender reputation: ${defenderAddress}`);
  } catch (err) {
    console.error('[EventIndexer] Defender reputation update failed (non-fatal):', err);
  }
}

export const startEventIndexer = (): void => {
  console.log('[EventIndexer] Worker scheduled: every 30 seconds');
  // 0G has ~500ms block times, so 30s = ~60 blocks per scan
  cron.schedule('*/30 * * * * *', indexEvents);

  // Run initial scan on startup (after 5s delay for other services to init)
  setTimeout(indexEvents, 5000);
};
