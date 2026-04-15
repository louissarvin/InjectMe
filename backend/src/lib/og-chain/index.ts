import { ethers } from 'ethers';
import {
  OG_RPC_URL,
  ORACLE_PRIVATE_KEY,
  FACTORY_ADDRESS,
  AGENT_NFT_ADDRESS,
  ORACLE_STAKING_ADDRESS,
  WRAPPED_0G_ADDRESS,
  REPUTATION_REGISTRY_ADDRESS,
  ERC20_FACTORY_ADDRESS,
} from '../../config/main-config.ts';

import ChallengeFactoryABI from './abi/ChallengeFactory.json';
import ChallengeABI from './abi/Challenge.json';
import AgentNFTABI from './abi/AgentNFT.json';
import TeeOracleABI from './abi/TeeOracle.json';
import OracleStakingABI from './abi/OracleStaking.json';
import ERC20ABI from './abi/ERC20.json';
import ReputationRegistryABI from './abi/ReputationRegistry.json';
import ChallengeFactoryERC20ABI from './abi/ChallengeFactoryERC20.json';

const TEE_ORACLE_ADDRESS = process.env.TEE_ORACLE_ADDRESS || '';

// Provider and wallet
const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
const wallet = ORACLE_PRIVATE_KEY ? new ethers.Wallet(ORACLE_PRIVATE_KEY, provider) : null;

// Contract instances
function getFactory() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!FACTORY_ADDRESS) throw new Error('FACTORY_ADDRESS not configured');
  return new ethers.Contract(FACTORY_ADDRESS, ChallengeFactoryABI, wallet);
}

function getChallenge(address: string) {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  return new ethers.Contract(address, ChallengeABI, wallet);
}

function getAgentNFT() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!AGENT_NFT_ADDRESS) throw new Error('AGENT_NFT_ADDRESS not configured');
  return new ethers.Contract(AGENT_NFT_ADDRESS, AgentNFTABI, wallet);
}

// Read-only provider for queries
function getFactoryReadOnly() {
  if (!FACTORY_ADDRESS) throw new Error('FACTORY_ADDRESS not configured');
  return new ethers.Contract(FACTORY_ADDRESS, ChallengeFactoryABI, provider);
}

function getChallengeReadOnly(address: string) {
  return new ethers.Contract(address, ChallengeABI, provider);
}

// ============================================================
//                  WRITE FUNCTIONS (Oracle)
// ============================================================

/** Record an attack attempt on-chain */
export async function recordAttempt(
  challengeAddress: string,
  attacker: string,
  storageRoot: string,
  messagePrice: bigint
): Promise<{ txHash: string }> {
  const challenge = getChallenge(challengeAddress);
  const tx = await challenge.recordAttempt(attacker, storageRoot, { value: messagePrice });
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ============================================================
//              COMMIT-REVEAL (anti-front-running)
// ============================================================

/** Build a commit hash: keccak256(messageHash, salt, attacker) */
export function buildCommitHash(message: string, salt: string, attacker: string): string {
  const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32', 'address'], [messageHash, salt, attacker])
  );
}

/** Generate a random salt for commit-reveal */
export function generateSalt(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

/** Reveal and record an attempt (oracle only, verifies commit on-chain) */
export async function revealAndRecord(
  challengeAddress: string,
  attacker: string,
  messageHash: string,
  salt: string,
  storageRoot: string
): Promise<{ txHash: string }> {
  const challenge = getChallenge(challengeAddress);
  const tx = await challenge.revealAndRecord(attacker, messageHash, salt, storageRoot);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Check if an attacker has a valid commit */
export async function hasValidCommit(challengeAddress: string, attacker: string): Promise<boolean> {
  const challenge = getChallengeReadOnly(challengeAddress);
  return await challenge.hasValidCommit(attacker);
}

/** Get commit details for an attacker */
export async function getCommit(
  challengeAddress: string,
  attacker: string
): Promise<{ commitHash: string; timestamp: number; revealed: boolean }> {
  const challenge = getChallengeReadOnly(challengeAddress);
  const [commitHash, timestamp, revealed] = await challenge.getCommit(attacker);
  return { commitHash, timestamp: Number(timestamp), revealed };
}

/** Claim victory for an attacker (oracle only) */
export async function claimVictory(
  challengeAddress: string,
  winner: string,
  chatID: string
): Promise<{ txHash: string }> {
  const challenge = getChallenge(challengeAddress);
  const tx = await challenge.claimVictory(winner, chatID);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Update iNFT stats after an attempt */
export async function updateAgentStats(
  challengeAddress: string,
  totalAttempts: number,
  attemptsSurvived: number
): Promise<void> {
  const nft = getAgentNFT();
  const tx = await nft.updateStats(challengeAddress, totalAttempts, attemptsSurvived);
  await tx.wait();
}

/** Mark agent iNFT as breached */
export async function markAgentBreached(
  challengeAddress: string,
  attemptsBeforeBreach: number
): Promise<void> {
  const nft = getAgentNFT();
  const tx = await nft.markBreached(challengeAddress, attemptsBeforeBreach);
  await tx.wait();
}

/** Claim expiry (challenge expired, defender gets funds back) */
export async function claimExpiry(challengeAddress: string): Promise<{ txHash: string }> {
  const challenge = getChallenge(challengeAddress);
  const tx = await challenge.claimExpiry();
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Mark agent iNFT as survived */
export async function markAgentSurvived(
  challengeAddress: string,
  totalSurvived: number
): Promise<void> {
  const nft = getAgentNFT();
  const tx = await nft.markSurvived(challengeAddress, totalSurvived);
  await tx.wait();
}

/** Anchor TEE attestation hash on the iNFT */
export async function anchorAttestation(
  challengeAddress: string,
  attestationHash: string
): Promise<void> {
  const nft = getAgentNFT();
  const tx = await nft.anchorAttestation(challengeAddress, attestationHash);
  await tx.wait();
}

/** Sign a proof for ERC-7857 operations (oracle ECDSA) */
export function signProof(metadataHash: string): string {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  const messageHash = ethers.getBytes(metadataHash);
  return wallet.signMessageSync(messageHash);
}

// ============================================================
//              TEE ORACLE (on-chain TEE signer registry)
// ============================================================

function getTeeOracle() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!TEE_ORACLE_ADDRESS) throw new Error('TEE_ORACLE_ADDRESS not configured');
  return new ethers.Contract(TEE_ORACLE_ADDRESS, TeeOracleABI, wallet);
}

/** Register a TEE signer address from attestation report on-chain */
export async function registerTeeSigner(signerAddress: string): Promise<{ txHash: string }> {
  const oracle = getTeeOracle();
  const tx = await oracle.addTeeSigner(signerAddress);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Check if an address is a registered TEE signer */
export async function isTeeSigner(signerAddress: string): Promise<boolean> {
  if (!TEE_ORACLE_ADDRESS) return false;
  const oracle = new ethers.Contract(TEE_ORACLE_ADDRESS, TeeOracleABI, provider);
  return await oracle.isTeeSigner(signerAddress);
}

/** Get TEE signer count */
export async function getTeeSignerCount(): Promise<number> {
  if (!TEE_ORACLE_ADDRESS) return 0;
  const oracle = new ethers.Contract(TEE_ORACLE_ADDRESS, TeeOracleABI, provider);
  return Number(await oracle.signerCount());
}

// ============================================================
//                  READ FUNCTIONS
// ============================================================

/** Get all challenge addresses from factory */
export async function getChallengeCount(): Promise<number> {
  const factory = getFactoryReadOnly();
  return Number(await factory.getChallengeCount());
}

/** Get paginated challenges */
export async function getChallengesPaginated(offset: number, limit: number): Promise<string[]> {
  const factory = getFactoryReadOnly();
  return await factory.getChallengesPaginated(offset, limit);
}

/** Get active challenges */
export async function getActiveChallenges(maxResults: number = 50): Promise<string[]> {
  const factory = getFactoryReadOnly();
  return await factory.getActiveChallenges(maxResults);
}

/** Get challenge details */
export async function getChallengeDetails(address: string) {
  const challenge = getChallengeReadOnly(address);

  const [
    defender, messagePrice, expiresAt, challengeType,
    prizePool, totalAttempts, active, winner, defenderEarnings
  ] = await Promise.all([
    challenge.defender(),
    challenge.messagePrice(),
    challenge.expiresAt(),
    challenge.challengeType(),
    challenge.prizePool(),
    challenge.totalAttempts(),
    challenge.active(),
    challenge.winner(),
    challenge.defenderEarnings(),
  ]);

  return {
    address,
    defender,
    messagePrice: messagePrice.toString(),
    expiresAt: Number(expiresAt),
    challengeType: Number(challengeType), // 0 = TOURNAMENT, 1 = BOUNTY
    prizePool: ethers.formatEther(prizePool),
    totalAttempts: Number(totalAttempts),
    active,
    winner,
    defenderEarnings: ethers.formatEther(defenderEarnings),
    timeRemaining: Math.max(0, Number(expiresAt) - Math.floor(Date.now() / 1000)),
  };
}

/** Get defender's challenges */
export async function getDefenderChallenges(defender: string): Promise<string[]> {
  const factory = getFactoryReadOnly();
  return await factory.getDefenderChallenges(defender);
}

/** Get oracle wallet address */
export function getOracleAddress(): string {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  return wallet.address;
}

// ============================================================
//              iNFT / ERC-7857 FUNCTIONS
// ============================================================

function getAgentNFTReadOnly() {
  if (!AGENT_NFT_ADDRESS) throw new Error('AGENT_NFT_ADDRESS not configured');
  return new ethers.Contract(AGENT_NFT_ADDRESS, AgentNFTABI, provider);
}

/** Get all iNFT token IDs owned by an address (ERC721Enumerable) */
export async function getAgentsByOwner(owner: string): Promise<number[]> {
  const nft = getAgentNFTReadOnly();
  const balance = Number(await nft.balanceOf(owner));
  const tokenIds: number[] = [];
  for (let i = 0; i < balance; i++) {
    const tokenId = Number(await nft.tokenOfOwnerByIndex(owner, i));
    tokenIds.push(tokenId);
  }
  return tokenIds;
}

/** Get agent metadata from the agents mapping */
export async function getAgentMetadata(tokenId: number): Promise<{
  challengeAddress: string;
  model: string;
  totalAttempts: number;
  attemptsSurvived: number;
  breached: boolean;
  createdAt: number;
  resolvedAt: number;
}> {
  const nft = getAgentNFTReadOnly();
  const agent = await nft.getAgent(tokenId);
  return {
    challengeAddress: agent.challengeAddress,
    model: agent.model,
    totalAttempts: Number(agent.totalAttempts),
    attemptsSurvived: Number(agent.attemptsSurvived),
    breached: agent.breached,
    createdAt: Number(agent.createdAt),
    resolvedAt: Number(agent.resolvedAt),
  };
}

/** Get security score for an iNFT */
export async function getAgentSecurityScore(tokenId: number): Promise<number> {
  const nft = getAgentNFTReadOnly();
  return Number(await nft.getSecurityScore(tokenId));
}

/** Get attestation hashes for an iNFT (reads count then each entry) */
export async function getAgentAttestations(tokenId: number): Promise<string[]> {
  const nft = getAgentNFTReadOnly();
  const count = Number(await nft.getAttestationCount(tokenId));
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hash = await nft.attestationHashes(tokenId, i);
    hashes.push(hash);
  }
  return hashes;
}

/** Get the encrypted URI for an iNFT */
export async function getEncryptedURI(tokenId: number): Promise<string> {
  const nft = getAgentNFTReadOnly();
  return await nft.getEncryptedURI(tokenId);
}

/** Get the owner of a specific token */
export async function getAgentOwner(tokenId: number): Promise<string> {
  const nft = getAgentNFTReadOnly();
  return await nft.ownerOf(tokenId);
}

/** Check if an executor is authorized for an iNFT */
export async function isAgentAuthorized(tokenId: number, executor: string): Promise<boolean> {
  const nft = getAgentNFTReadOnly();
  return await nft.isAuthorized(tokenId, executor);
}

/** Get the metadata hash for ERC-7857 proof signing */
export async function getMetadataHash(tokenId: number): Promise<string> {
  const nft = getAgentNFTReadOnly();
  return await nft.getMetadataHash(tokenId);
}

/** ERC-7857 transfer with re-encryption proof */
export async function transferAgent(
  from: string,
  to: string,
  tokenId: number,
  sealedKey: string,
  proof: string
): Promise<{ txHash: string }> {
  const nft = getAgentNFT();
  const tx = await nft.transfer(from, to, tokenId, sealedKey, proof);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** ERC-7857 clone with proof */
export async function cloneAgent(
  to: string,
  tokenId: number,
  sealedKey: string,
  proof: string
): Promise<{ txHash: string; newTokenId: number }> {
  const nft = getAgentNFT();
  const tx = await nft.clone(to, tokenId, sealedKey, proof);
  const receipt = await tx.wait();

  // Parse newTokenId from AgentCloned event
  let newTokenId = 0;
  for (const log of receipt.logs) {
    try {
      const parsed = nft.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'AgentCloned') {
        newTokenId = Number(parsed.args.newTokenId);
        break;
      }
    } catch {}
  }

  return { txHash: receipt.hash, newTokenId };
}

/** Authorize usage rights for an executor on an iNFT */
export async function authorizeAgent(
  tokenId: number,
  executor: string,
  permissions: string
): Promise<{ txHash: string }> {
  const nft = getAgentNFT();
  const permBytes = ethers.toUtf8Bytes(permissions);
  const tx = await nft.authorizeUsage(tokenId, executor, permBytes);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Revoke usage rights for an executor on an iNFT */
export async function revokeAgent(
  tokenId: number,
  executor: string
): Promise<{ txHash: string }> {
  const nft = getAgentNFT();
  const tx = await nft.revokeUsage(tokenId, executor);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Get all currently authorized executors for an iNFT by querying events and verifying on-chain */
export async function getAuthorizedExecutors(
  tokenId: number
): Promise<Array<{ executor: string; permissions: string }>> {
  const nft = getAgentNFTReadOnly();

  // Query UsageAuthorized events filtered by tokenId (indexed topic)
  const authorizedFilter = nft.filters.UsageAuthorized(tokenId);
  const authorizedEvents = await nft.queryFilter(authorizedFilter, 0, 'latest');

  // Collect unique executor addresses from events
  const candidateExecutors = new Set<string>();
  for (const event of authorizedEvents) {
    const parsed = nft.interface.parseLog({ topics: event.topics as string[], data: event.data });
    if (parsed) {
      candidateExecutors.add(parsed.args.executor as string);
    }
  }

  // Verify each candidate is still authorized and fetch permissions
  const results: Array<{ executor: string; permissions: string }> = [];

  const checks = Array.from(candidateExecutors).map(async (executor) => {
    const stillAuthorized: boolean = await nft.isAuthorized(tokenId, executor);
    if (!stillAuthorized) return;

    const permBytes: string = await nft.getAuthorization(tokenId, executor);
    let permissions = '';
    try {
      permissions = ethers.toUtf8String(permBytes);
    } catch {
      // If bytes are not valid UTF-8, return hex representation
      permissions = permBytes;
    }

    results.push({ executor, permissions });
  });

  await Promise.all(checks);

  return results;
}

// ============================================================
//              ALIGNMENT CHALLENGE FUNCTIONS
// ============================================================

/** Create an alignment challenge on-chain via factory */
export async function createAlignment(params: {
  name: string;
  rewardPerAttempt: bigint;
  duration: number;
  secretHash: string;
  model: string;
  value: bigint;
}): Promise<{ challengeAddress: string; txHash: string }> {
  const factory = getFactory();
  const tx = await factory.createAlignment(
    params.name,
    params.rewardPerAttempt,
    params.duration,
    params.secretHash,
    params.model,
    { value: params.value }
  );
  const receipt = await tx.wait();

  // Parse ChallengeCreated event to get address
  let challengeAddress = '';
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'ChallengeCreated') {
        challengeAddress = parsed.args[0]; // challenge address
        break;
      }
    } catch {}
  }

  if (!challengeAddress) throw new Error('ChallengeCreated event not found in receipt');

  return { challengeAddress, txHash: receipt.hash };
}

/** Publish alignment data root hash on-chain (oracle only) */
export async function publishAlignmentData(
  challengeAddress: string,
  dataRoot: string,
  sampleCount: number
): Promise<{ txHash: string }> {
  const challenge = getChallenge(challengeAddress);
  const tx = await challenge.publishAlignmentData(dataRoot, sampleCount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Get alignment sample count from challenge */
export async function getAlignmentSamples(challengeAddress: string): Promise<number> {
  const challenge = getChallengeReadOnly(challengeAddress);
  return Number(await challenge.alignmentSamples());
}

/** Get reward per attempt for alignment challenge */
export async function getRewardPerAttempt(challengeAddress: string): Promise<bigint> {
  const challenge = getChallengeReadOnly(challengeAddress);
  return await challenge.rewardPerAttempt();
}

// ============================================================
//              ERC-20 CHALLENGE FUNCTIONS
// ============================================================

function getERC20(tokenAddress: string) {
  return new ethers.Contract(tokenAddress, ERC20ABI, provider);
}

function getERC20WithSigner(tokenAddress: string) {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  return new ethers.Contract(tokenAddress, ERC20ABI, wallet);
}

/** Get ERC-20 token balance for an address */
export async function getTokenBalance(token: string, address: string): Promise<bigint> {
  const erc20 = getERC20(token);
  return await erc20.balanceOf(address);
}

/** Approve ERC-20 token spending */
export async function approveToken(token: string, spender: string, amount: bigint): Promise<string> {
  const erc20 = getERC20WithSigner(token);
  const tx = await erc20.approve(spender, amount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Get ERC-20 token info (symbol, decimals, name) */
export async function getTokenInfo(tokenAddress: string): Promise<{
  symbol: string;
  decimals: number;
  name: string;
}> {
  const erc20 = getERC20(tokenAddress);
  const [symbol, decimals, name] = await Promise.all([
    erc20.symbol(),
    erc20.decimals(),
    erc20.name(),
  ]);
  return { symbol, decimals: Number(decimals), name };
}

/** Check if an address is the Wrapped0GBase precompile */
export function isWrapped0G(tokenAddress: string): boolean {
  if (!WRAPPED_0G_ADDRESS) return false;
  return tokenAddress.toLowerCase() === WRAPPED_0G_ADDRESS.toLowerCase();
}

/** Wrap native 0G to Wrapped0GBase ERC-20 */
export async function wrapNative0G(amount: bigint): Promise<string> {
  if (!WRAPPED_0G_ADDRESS) throw new Error('WRAPPED_0G_ADDRESS not configured');
  const wrapped = getERC20WithSigner(WRAPPED_0G_ADDRESS);
  const tx = await wrapped.deposit({ value: amount });
  const receipt = await tx.wait();
  return receipt.hash;
}

// ============================================================
//              ORACLE STAKING FUNCTIONS
// ============================================================

function getOracleStaking() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!ORACLE_STAKING_ADDRESS) throw new Error('ORACLE_STAKING_ADDRESS not configured');
  return new ethers.Contract(ORACLE_STAKING_ADDRESS, OracleStakingABI, wallet);
}

function getOracleStakingReadOnly() {
  if (!ORACLE_STAKING_ADDRESS) throw new Error('ORACLE_STAKING_ADDRESS not configured');
  return new ethers.Contract(ORACLE_STAKING_ADDRESS, OracleStakingABI, provider);
}

/** Get all active oracle operator addresses */
export async function getActiveOracles(): Promise<string[]> {
  const staking = getOracleStakingReadOnly();
  return await staking.getActiveOracles();
}

/** Check if an address is an active oracle operator */
export async function isActiveOracle(address: string): Promise<boolean> {
  const staking = getOracleStakingReadOnly();
  return await staking.isActiveOracle(address);
}

/** Get operator info (staking details, performance stats) */
export async function getOperatorInfo(address: string): Promise<{
  stakedAmount: bigint;
  isActive: boolean;
  judgmentsSubmitted: number;
  judgmentsSlashed: number;
  rewards: bigint;
}> {
  const staking = getOracleStakingReadOnly();
  const [stakedAmount, isActive, judgmentsSubmitted, judgmentsSlashed, rewards] =
    await staking.getOperatorInfo(address);
  return {
    stakedAmount,
    isActive,
    judgmentsSubmitted: Number(judgmentsSubmitted),
    judgmentsSlashed: Number(judgmentsSlashed),
    rewards,
  };
}

/** Submit a judgment via oracle staking contract (multi-sig flow) */
export async function submitJudgment(
  challenge: string,
  winner: string,
  chatID: string
): Promise<{ judgmentId: number; txHash: string }> {
  const staking = getOracleStaking();
  const tx = await staking.submitJudgment(challenge, winner, chatID);
  const receipt = await tx.wait();

  // Parse judgmentId from return value or event
  let judgmentId = 0;
  for (const log of receipt.logs) {
    try {
      const parsed = staking.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.args.judgmentId !== undefined) {
        judgmentId = Number(parsed.args.judgmentId);
        break;
      }
    } catch {}
  }

  return { judgmentId, txHash: receipt.hash };
}

/** Confirm a pending judgment (multi-sig confirmation) */
export async function confirmJudgment(judgmentId: number): Promise<{ txHash: string }> {
  const staking = getOracleStaking();
  const tx = await staking.confirmJudgment(judgmentId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Get judgment status (confirmations, required threshold, execution state) */
export async function getJudgmentStatus(judgmentId: number): Promise<{
  confirmations: number;
  required: number;
  executed: boolean;
}> {
  const staking = getOracleStakingReadOnly();
  const [confirmations, required, executed] = await staking.getJudgmentStatus(judgmentId);
  return {
    confirmations: Number(confirmations),
    required: Number(required),
    executed,
  };
}

/** Get staking contract configuration info */
export async function getStakingInfo(): Promise<{
  minStake: string;
  activeOracleCount: number;
  requiredConfirmations: number;
  totalStaked: string;
}> {
  const staking = getOracleStakingReadOnly();
  const [minStake, activeCount, requiredConf, totalStaked] = await Promise.all([
    staking.minStake(),
    staking.activeOracleCount(),
    staking.requiredConfirmations(),
    staking.totalStaked(),
  ]);
  return {
    minStake: ethers.formatEther(minStake),
    activeOracleCount: Number(activeCount),
    requiredConfirmations: Number(requiredConf),
    totalStaked: ethers.formatEther(totalStaked),
  };
}

// ============================================================
//              REPUTATION REGISTRY FUNCTIONS
// ============================================================

function getReputationRegistry() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!REPUTATION_REGISTRY_ADDRESS) throw new Error('REPUTATION_REGISTRY_ADDRESS not configured');
  return new ethers.Contract(REPUTATION_REGISTRY_ADDRESS, ReputationRegistryABI, wallet);
}

function getReputationRegistryReadOnly() {
  if (!REPUTATION_REGISTRY_ADDRESS) throw new Error('REPUTATION_REGISTRY_ADDRESS not configured');
  return new ethers.Contract(REPUTATION_REGISTRY_ADDRESS, ReputationRegistryABI, provider);
}

/** Get on-chain attacker reputation */
export async function getAttackerReputation(attacker: string): Promise<{
  totalAttempts: number;
  successfulBreaches: number;
  challengesParticipated: number;
  totalEarnings: string;
  lastActiveAt: number;
}> {
  const registry = getReputationRegistryReadOnly();
  const rep = await registry.getAttackerReputation(attacker);
  return {
    totalAttempts: Number(rep.totalAttempts),
    successfulBreaches: Number(rep.successfulBreaches),
    challengesParticipated: Number(rep.challengesParticipated),
    totalEarnings: ethers.formatEther(rep.totalEarnings),
    lastActiveAt: Number(rep.lastActiveAt),
  };
}

/** Get on-chain defender reputation */
export async function getDefenderReputation(defender: string): Promise<{
  totalChallengesCreated: number;
  challengesSurvived: number;
  challengesBreached: number;
  totalPrizeDefended: string;
  totalPrizeLost: string;
  lastActiveAt: number;
}> {
  const registry = getReputationRegistryReadOnly();
  const rep = await registry.getDefenderReputation(defender);
  return {
    totalChallengesCreated: Number(rep.totalChallengesCreated),
    challengesSurvived: Number(rep.challengesSurvived),
    challengesBreached: Number(rep.challengesBreached),
    totalPrizeDefended: ethers.formatEther(rep.totalPrizeDefended),
    totalPrizeLost: ethers.formatEther(rep.totalPrizeLost),
    lastActiveAt: Number(rep.lastActiveAt),
  };
}

/** Get on-chain attacker score */
export async function getAttackerScore(attacker: string): Promise<number> {
  const registry = getReputationRegistryReadOnly();
  return Number(await registry.getAttackerScore(attacker));
}

/** Get on-chain defender score */
export async function getDefenderScore(defender: string): Promise<number> {
  const registry = getReputationRegistryReadOnly();
  return Number(await registry.getDefenderScore(defender));
}

/** Record an attacker attempt on the reputation registry (oracle only) */
export async function recordAttackerAttempt(attacker: string, challenge: string): Promise<void> {
  if (!REPUTATION_REGISTRY_ADDRESS) return;
  const registry = getReputationRegistry();
  const tx = await registry.recordAttackerAttempt(attacker, challenge);
  await tx.wait();
}

/** Record an attacker victory on the reputation registry (oracle only) */
export async function recordAttackerVictory(attacker: string, challenge: string, prize: bigint): Promise<void> {
  if (!REPUTATION_REGISTRY_ADDRESS) return;
  const registry = getReputationRegistry();
  const tx = await registry.recordAttackerVictory(attacker, challenge, prize);
  await tx.wait();
}

/** Record a defender survived on the reputation registry (oracle only) */
export async function recordDefenderSurvived(defender: string, challenge: string, prizeDefended: bigint): Promise<void> {
  if (!REPUTATION_REGISTRY_ADDRESS) return;
  const registry = getReputationRegistry();
  const tx = await registry.recordDefenderSurvived(defender, challenge, prizeDefended);
  await tx.wait();
}

/** Record a defender breached on the reputation registry (oracle only) */
export async function recordDefenderBreached(defender: string, challenge: string, prizeLost: bigint): Promise<void> {
  if (!REPUTATION_REGISTRY_ADDRESS) return;
  const registry = getReputationRegistry();
  const tx = await registry.recordDefenderBreached(defender, challenge, prizeLost);
  await tx.wait();
}

// ============================================================
//              ERC-20 CHALLENGE FACTORY FUNCTIONS
// ============================================================

function getERC20Factory() {
  if (!wallet) throw new Error('ORACLE_PRIVATE_KEY not configured');
  if (!ERC20_FACTORY_ADDRESS) throw new Error('ERC20_FACTORY_ADDRESS not configured');
  return new ethers.Contract(ERC20_FACTORY_ADDRESS, ChallengeFactoryERC20ABI, wallet);
}

/** Create an ERC-20 tournament challenge via the ERC20 factory */
export async function createTournamentERC20(params: {
  name: string;
  token: string;
  amount: bigint;
  messagePrice: bigint;
  duration: number;
  secretHash: string;
  model: string;
}): Promise<{ challengeAddress: string; txHash: string }> {
  const factory = getERC20Factory();

  // For Wrapped0G: send native value so the factory can wrap it
  // For other ERC-20s: approve the factory to spend tokens first
  const txOverrides: { value?: bigint } = {};
  if (isWrapped0G(params.token)) {
    txOverrides.value = params.amount;
  } else {
    await approveToken(params.token, ERC20_FACTORY_ADDRESS, params.amount);
  }

  const tx = await factory.createTournamentERC20(
    params.name,
    params.token,
    params.amount,
    params.messagePrice,
    params.duration,
    params.secretHash,
    params.model,
    txOverrides
  );
  const receipt = await tx.wait();

  // Parse challenge address from receipt logs (the factory returns address)
  let challengeAddress = '';
  // The return value is the challenge address; extract from logs or transaction
  for (const log of receipt.logs) {
    try {
      // Try to parse with the main ChallengeFactory ABI (events bubble up)
      const mainFactory = getFactoryReadOnly();
      const parsed = mainFactory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'ChallengeCreated') {
        challengeAddress = parsed.args[0];
        break;
      }
    } catch {}
  }

  if (!challengeAddress) {
    // Fallback: decode from the return value in the transaction
    // The function returns an address, extract from the last log topic
    const iface = new ethers.Interface(ChallengeFactoryERC20ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed) {
          challengeAddress = parsed.args[0];
          break;
        }
      } catch {}
    }
  }

  if (!challengeAddress) throw new Error('Could not extract challenge address from ERC20 factory receipt');

  return { challengeAddress, txHash: receipt.hash };
}

/** Create an ERC-20 bounty challenge via the ERC20 factory */
export async function createBountyERC20(params: {
  name: string;
  token: string;
  amount: bigint;
  duration: number;
  secretHash: string;
  model: string;
}): Promise<{ challengeAddress: string; txHash: string }> {
  const factory = getERC20Factory();

  const txOverrides: { value?: bigint } = {};
  if (isWrapped0G(params.token)) {
    txOverrides.value = params.amount;
  } else {
    await approveToken(params.token, ERC20_FACTORY_ADDRESS, params.amount);
  }

  const tx = await factory.createBountyERC20(
    params.name,
    params.token,
    params.amount,
    params.duration,
    params.secretHash,
    params.model,
    txOverrides
  );
  const receipt = await tx.wait();

  let challengeAddress = '';
  for (const log of receipt.logs) {
    try {
      const mainFactory = getFactoryReadOnly();
      const parsed = mainFactory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'ChallengeCreated') {
        challengeAddress = parsed.args[0];
        break;
      }
    } catch {}
  }

  if (!challengeAddress) throw new Error('Could not extract challenge address from ERC20 factory receipt');

  return { challengeAddress, txHash: receipt.hash };
}

/** Create an ERC-20 alignment challenge via the ERC20 factory */
export async function createAlignmentERC20(params: {
  name: string;
  token: string;
  amount: bigint;
  rewardPerAttempt: bigint;
  duration: number;
  secretHash: string;
  model: string;
}): Promise<{ challengeAddress: string; txHash: string }> {
  const factory = getERC20Factory();

  const txOverrides: { value?: bigint } = {};
  if (isWrapped0G(params.token)) {
    txOverrides.value = params.amount;
  } else {
    await approveToken(params.token, ERC20_FACTORY_ADDRESS, params.amount);
  }

  const tx = await factory.createAlignmentERC20(
    params.name,
    params.token,
    params.amount,
    params.rewardPerAttempt,
    params.duration,
    params.secretHash,
    params.model,
    txOverrides
  );
  const receipt = await tx.wait();

  let challengeAddress = '';
  for (const log of receipt.logs) {
    try {
      const mainFactory = getFactoryReadOnly();
      const parsed = mainFactory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === 'ChallengeCreated') {
        challengeAddress = parsed.args[0];
        break;
      }
    } catch {}
  }

  if (!challengeAddress) throw new Error('Could not extract challenge address from ERC20 factory receipt');

  return { challengeAddress, txHash: receipt.hash };
}

// ============================================================
//              AGENT-TO-CHALLENGE LINKAGE (on-chain)
// ============================================================

/**
 * Links an agent iNFT to a challenge contract on-chain.
 * Calls AgentNFT.linkAgentToChallenge(tokenId, challengeAddress)
 * using the backend oracle wallet (must be registered as backendOracle).
 */
export async function linkAgentToChallenge(
  tokenId: number,
  challengeAddress: string
): Promise<void> {
  const nft = getAgentNFT();
  console.log(`[og-chain] linkAgentToChallenge: tokenId=${tokenId}, challenge=${challengeAddress}`);
  const tx = await nft.linkAgentToChallenge(tokenId, challengeAddress);
  const receipt = await tx.wait();
  console.log(`[og-chain] linkAgentToChallenge confirmed in tx ${receipt.hash}`);
}

export { provider, wallet };
