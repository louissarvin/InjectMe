import cron from 'node-cron';
import { ethers } from 'ethers';
import { prismaQuery } from '../lib/prisma.ts';
import * as chain from '../lib/og-chain/index.ts';
import * as storage from '../lib/og-storage/index.ts';
import { generateReport } from '../lib/reportGenerator.ts';
import { FACTORY_ADDRESS } from '../config/main-config.ts';

let isRunning = false;

/**
 * Challenge Expiry Worker
 *
 * Runs every 60 seconds. For each known challenge:
 * 1. Checks if expired and still active on-chain
 * 2. Calls Challenge.claimExpiry() (anyone can call, funds go to defender)
 * 3. Updates iNFT: markAgentSurvived (agent passed the test)
 * 4. Archives final stats to 0G Storage Log Layer
 * 5. Generates vulnerability report and archives to 0G Storage
 * 6. Updates reputation cache on 0G Storage KV
 *
 * Based on INJECTME.md Flow 3: Challenge Expires (AI Wins)
 */
async function checkExpiredChallenges(): Promise<void> {
  if (isRunning) {
    console.log('[ExpiryWorker] Previous run still active, skipping...');
    return;
  }
  if (!FACTORY_ADDRESS) {
    return;
  }

  isRunning = true;

  try {
    // Get all challenges from DB
    const challenges = await (prismaQuery as any).challenge.findMany({
      select: { contractAddress: true, name: true },
    }) as Array<{ contractAddress: string; name: string }>;

    for (const { contractAddress, name } of challenges) {
      try {
        await processExpiredChallenge(contractAddress, name);
      } catch (err) {
        // Don't let one failed challenge block others
        console.error(`[ExpiryWorker] Error processing ${contractAddress}:`, err);
      }
    }
  } catch (error) {
    console.error('[ExpiryWorker] Error:', error);
  } finally {
    isRunning = false;
  }
}

async function processExpiredChallenge(challengeAddress: string, name: string): Promise<void> {
  // 1. Check on-chain state
  let details;
  try {
    details = await chain.getChallengeDetails(challengeAddress);
  } catch {
    return; // Contract may not exist or RPC error
  }

  // Only process if active and expired
  if (!details.active) return;
  if (details.timeRemaining > 0) return;

  console.log(`[ExpiryWorker] Challenge expired: ${name} (${challengeAddress})`);

  // 2. Call claimExpiry on-chain (funds go to defender via pendingWithdrawals)
  try {
    const result = await chain.claimExpiry(challengeAddress);
    console.log(`[ExpiryWorker] claimExpiry tx: ${result.txHash}`);
  } catch (err) {
    const msg = (err as Error).message || '';
    // "Already ended" means someone else already claimed it
    if (msg.includes('Already ended') || msg.includes('Not expired')) {
      return;
    }
    console.error(`[ExpiryWorker] claimExpiry failed:`, err);
    return; // Don't proceed if on-chain tx failed
  }

  // 3. Update iNFT: mark agent as survived
  try {
    await chain.markAgentSurvived(challengeAddress, details.totalAttempts);
    console.log(`[ExpiryWorker] iNFT marked survived: ${details.totalAttempts} attempts defended`);
  } catch (err) {
    console.error('[ExpiryWorker] markAgentSurvived failed (non-fatal):', err);
  }

  // 3b. Record defender survived on ReputationRegistry (fire-and-forget)
  const prizeDefended = ethers.parseEther(details.prizePool);
  chain.recordDefenderSurvived(details.defender, challengeAddress, prizeDefended)
    .catch(err => console.error('[ExpiryWorker] recordDefenderSurvived failed (non-fatal):', err));

  // 4. Archive final stats to 0G Storage Log Layer
  try {
    const finalStats = {
      type: 'challenge_completed',
      challengeId: challengeAddress,
      name,
      outcome: 'SURVIVED',
      totalAttempts: details.totalAttempts,
      defender: details.defender,
      prizeReturned: details.prizePool,
      defenderEarnings: details.defenderEarnings,
      expiresAt: details.expiresAt,
      completedAt: Date.now(),
    };

    await storage.archiveData(
      JSON.stringify(finalStats),
      `injectme:completion:${challengeAddress}`
    );
    console.log('[ExpiryWorker] Final stats archived to 0G Storage');
  } catch (err) {
    console.error('[ExpiryWorker] Stats archive failed (non-fatal):', err);
  }

  // 5. Generate vulnerability report and archive to 0G Storage
  try {
    const { report, storageRootHash } = await generateReport(challengeAddress);
    console.log(`[ExpiryWorker] Report generated: Grade ${report.securityGrade}, Score ${report.securityScore}`);
    console.log(`[ExpiryWorker] Report archived to 0G Storage: ${storageRootHash}`);

    // Store report reference in DB
    await (prismaQuery as any).challenge.update({
      where: { contractAddress: challengeAddress },
      data: {
        description: `${report.securityGrade} grade | ${report.totalAttempts} attempts | ${report.survivalRate}% survival | Report: ${storageRootHash}`,
      },
    });
  } catch (err) {
    console.error('[ExpiryWorker] Report generation failed (non-fatal):', err);
  }

  // 6. Update defender reputation on 0G Storage KV
  try {
    await storage.setReputation(details.defender, {
      role: 'defender',
      wins: 0,
      totalAttempts: details.totalAttempts,
      totalPrizeWon: 0,
      winRate: 0,
      owaspBreakdown: {},
      lastActive: Date.now(),
    });
    console.log(`[ExpiryWorker] Defender reputation updated: ${details.defender}`);
  } catch (err) {
    console.error('[ExpiryWorker] Reputation update failed (non-fatal):', err);
  }
}

export const startChallengeExpiryWorker = (): void => {
  console.log('[ExpiryWorker] Worker scheduled: every 60 seconds');
  cron.schedule('* * * * *', checkExpiredChallenges); // Every minute

  // Run initial check after 10s (give other services time to init)
  setTimeout(checkExpiredChallenges, 10000);
};
