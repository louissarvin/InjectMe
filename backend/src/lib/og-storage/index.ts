import { ZgFile, Indexer, Batcher, KvClient, FixedPriceFlow__factory } from '@0gfoundation/0g-ts-sdk';
import { ethers } from 'ethers';
import {
  OG_RPC_URL,
  OG_STORAGE_INDEXER,
  OG_FLOW_CONTRACT,
  OG_KV_STREAM_ID,
  STORAGE_PRIVATE_KEY,
} from '../../config/main-config.ts';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
const signer = STORAGE_PRIVATE_KEY ? new ethers.Wallet(STORAGE_PRIVATE_KEY, provider) : null;

/** Get the FixedPriceFlow contract instance (required by Batcher) */
function getFlowContract() {
  if (!signer) throw new Error('STORAGE_PRIVATE_KEY not configured');
  return FixedPriceFlow__factory.connect(OG_FLOW_CONTRACT, signer);
}

function getIndexer() {
  return new Indexer(OG_STORAGE_INDEXER);
}

// ============================================================
//  LOG LAYER: Permanent, immutable archive
// ============================================================

interface AttemptRecord {
  version: number;
  challengeId: string;
  attemptNumber: number;
  attacker: string;
  timestamp: number;
  message: string;
  response: string;
  judgment: 'FAILED' | 'SUCCESS';
  reason: string;
  chatID: string;
  teeVerified: boolean;
  owaspCategory: string;
  model: string;
}

/** Archive an attack attempt permanently to 0G Storage Log Layer */
export async function archiveAttempt(attempt: AttemptRecord): Promise<{ rootHash: string; txHash: string }> {
  if (!signer) throw new Error('STORAGE_PRIVATE_KEY not configured');

  const data = JSON.stringify(attempt);

  // C-4 fix: use mkdtempSync for unpredictable temp paths (prevents symlink attack)
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'injectme-'));
  const tmpPath = path.join(tmpDir, 'attempt.json');

  writeFileSync(tmpPath, Buffer.from(data, 'utf-8'));

  try {
    const file = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw treeErr;

    const rootHash = tree!.rootHash()!;

    const indexer = getIndexer();
    const [result, uploadErr] = await indexer.upload(
      file,
      OG_RPC_URL,
      signer,
      {
        tags: ethers.toUtf8Bytes(`injectme:attempt:${attempt.challengeId}`),
        finalityRequired: true,
      }
    );

    await file.close();

    if (uploadErr) throw uploadErr;

    return {
      rootHash,
      txHash: (result as { txHash: string }).txHash,
    };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Archive from in-memory data using temp file */
export async function archiveData(
  data: string,
  tag: string
): Promise<{ rootHash: string; txHash: string }> {
  if (!signer) throw new Error('STORAGE_PRIVATE_KEY not configured');

  // C-4 fix: secure temp directory
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'injectme-'));
  const tmpPath = path.join(tmpDir, 'data.json');
  writeFileSync(tmpPath, Buffer.from(data, 'utf-8'));

  try {
    const file = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw treeErr;

    const rootHash = tree!.rootHash()!;

    const indexer = getIndexer();
    const [result, uploadErr] = await indexer.upload(
      file,
      OG_RPC_URL,
      signer,
      { tags: ethers.toUtf8Bytes(tag), finalityRequired: true }
    );

    await file.close();
    if (uploadErr) throw uploadErr;

    return {
      rootHash,
      txHash: (result as { txHash: string }).txHash,
    };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Archive TEE attestation report permanently */
export async function archiveAttestation(
  challengeId: string,
  chatID: string,
  attestationData: unknown
): Promise<{ rootHash: string }> {
  const data = JSON.stringify({
    challengeId,
    chatID,
    attestation: attestationData,
    timestamp: Date.now(),
  });

  const result = await archiveData(data, `injectme:attestation:${challengeId}`);
  return { rootHash: result.rootHash };
}

/** Download file from 0G Storage by root hash */
export async function downloadFile(rootHash: string, outputPath: string): Promise<void> {
  const indexer = getIndexer();
  const err = await indexer.download(rootHash, outputPath, true);
  if (err) throw err;
}

// ============================================================
//  KV LAYER: Mutable state (conversation, config, reputation)
// ============================================================

/** Write a key-value pair to 0G Storage KV Layer */
async function kvWrite(key: string, value: string): Promise<{ txHash: string }> {
  if (!signer) throw new Error('STORAGE_PRIVATE_KEY not configured');
  if (!OG_KV_STREAM_ID) throw new Error('OG_KV_STREAM_ID not configured');

  const indexer = getIndexer();
  const [nodes, nodesErr] = await indexer.selectNodes(1);
  if (nodesErr) throw nodesErr;

  // Batcher requires FixedPriceFlow contract instance, NOT a string address
  const flowContract = getFlowContract();
  const batcher = new Batcher(1, nodes!, flowContract, OG_RPC_URL);

  const keyBytes = Uint8Array.from(Buffer.from(key, 'utf-8'));
  const valueBytes = Uint8Array.from(Buffer.from(value, 'utf-8'));

  batcher.streamDataBuilder.set(OG_KV_STREAM_ID, keyBytes, valueBytes);
  const [result, batchErr] = await batcher.exec();
  if (batchErr) throw batchErr;

  return { txHash: result.txHash };
}

/** Read a value from 0G Storage KV Layer */
export async function kvRead(key: string, kvNodeUrl?: string): Promise<string | null> {
  // KvClient connects to a specific KV storage node
  const nodeUrl = kvNodeUrl || process.env.OG_KV_NODE_URL || '';
  if (!nodeUrl) {
    console.warn('[0G Storage] OG_KV_NODE_URL not configured, KV read unavailable');
    return null;
  }
  if (!OG_KV_STREAM_ID) {
    console.warn('[0G Storage] OG_KV_STREAM_ID not configured');
    return null;
  }

  const kvClient = new KvClient(nodeUrl);
  const keyBytes = Uint8Array.from(Buffer.from(key, 'utf-8'));

  const result = await kvClient.getValue(OG_KV_STREAM_ID, keyBytes as any);
  if (!result) return null;

  // Value.data is base64 encoded
  return Buffer.from(result.data, 'base64').toString('utf-8');
}

// ============================================================
//  KV HIGH-LEVEL FUNCTIONS
// ============================================================

/** Store challenge config in KV layer */
export async function setChallengeConfig(
  challengeId: string,
  config: {
    name: string;
    defender: string;
    model: string;
    systemPromptHash: string;
    prizePool: string;
    messagePrice: string;
    totalAttempts: number;
    active: boolean;
    contractAddress: string;
    createdAt: number;
  }
): Promise<void> {
  await kvWrite(`challenge:${challengeId}`, JSON.stringify(config));
}

/** Read challenge config from KV layer */
export async function getChallengeConfig(challengeId: string): Promise<any | null> {
  const data = await kvRead(`challenge:${challengeId}`);
  return data ? JSON.parse(data) : null;
}

/** Store conversation history for an active challenge */
export async function setConversation(
  challengeId: string,
  attacker: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  await kvWrite(
    `conversation:${challengeId}:${attacker}`,
    JSON.stringify(messages)
  );
}

/** Read conversation history from KV layer */
export async function getConversation(
  challengeId: string,
  attacker: string
): Promise<Array<{ role: string; content: string }>> {
  const data = await kvRead(`conversation:${challengeId}:${attacker}`);
  return data ? JSON.parse(data) : [];
}

/** Update reputation cache in KV layer */
export async function setReputation(
  address: string,
  stats: {
    role: 'attacker' | 'defender';
    wins: number;
    totalAttempts: number;
    totalPrizeWon: number;
    winRate: number;
    owaspBreakdown: Record<string, number>;
    lastActive: number;
  }
): Promise<void> {
  await kvWrite(`reputation:${address}`, JSON.stringify(stats));
}

/** Read reputation from KV layer */
export async function getReputation(address: string): Promise<any | null> {
  const data = await kvRead(`reputation:${address}`);
  return data ? JSON.parse(data) : null;
}
