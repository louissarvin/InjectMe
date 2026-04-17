import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { ORACLE_PRIVATE_KEY } from '../../config/main-config.ts';
import { deserializeAndDecrypt, serializeEncrypted, type EncryptedData } from '../encryption.ts';
import * as chain from '../og-chain/index.ts';

/**
 * TEE Re-encryption for iNFT Transfer (ERC-7857)
 *
 * When an iNFT is transferred, the system prompt must be re-encrypted
 * for the new owner. Since 0G's TEE re-encryption service is not yet
 * publicly available, this module implements backend-mediated
 * re-encryption that mimics the TEE flow:
 *
 * 1. Decrypt with oracle key (existing encryption.ts)
 * 2. Re-encrypt with owner-specific key derived via PBKDF2
 * 3. Sign proof: oracle signs (oldHash, newHash, newOwner, tokenId)
 * 4. Generate sealed key (encrypted key material for the owner)
 *
 * Security model:
 * - Each owner gets a unique encryption key via PBKDF2(oracleKey, ownerAddress)
 * - Oracle can always decrypt (it knows the private key)
 * - Owner cannot decrypt without oracle cooperation (key is derived from oracle key)
 * - Proof is ECDSA-signed by oracle for on-chain verification
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;

/**
 * Derive a 256-bit encryption key specific to an owner address.
 * Uses PBKDF2 with the oracle private key as the password and
 * a domain-separated salt including the owner address.
 */
function deriveOwnerKey(ownerAddress: string): Buffer {
  if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY not configured');

  return pbkdf2Sync(
    ORACLE_PRIVATE_KEY,
    `injectme-owner-${ownerAddress.toLowerCase()}`,
    PBKDF2_ITERATIONS,
    32, // 256-bit key
    'sha256'
  );
}

/**
 * Encrypt plaintext with an owner-specific key.
 * Returns serialized encrypted data in v1:<iv>:<authTag>:<ciphertext> format.
 */
export function encryptForOwner(plaintext: string, ownerAddress: string): string {
  const key = deriveOwnerKey(ownerAddress);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  const data: EncryptedData = {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
    version: 1,
  };

  return serializeEncrypted(data);
}

/**
 * Decrypt ciphertext with an owner-specific key.
 * Expects serialized format: v1:<iv>:<authTag>:<ciphertext>
 */
export function decryptForOwner(serialized: string, ownerAddress: string): string {
  const parts = serialized.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted data format');

  const version = parseInt(parts[0].replace('v', ''));
  if (version !== 1) throw new Error(`Unsupported encryption version: ${version}`);

  const key = deriveOwnerKey(ownerAddress);
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(parts[3], 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Generate a sealed key for the owner.
 * This is a deterministic key identifier that the owner can use
 * to request decryption from the oracle. It does NOT contain
 * the actual encryption key (that stays with the oracle).
 *
 * Format: hex-encoded PBKDF2 of (oracleKey, "seal-" + ownerAddress)
 * This proves the oracle generated it without exposing the oracle key.
 */
export function deriveSealedKey(ownerAddress: string): string {
  if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY not configured');

  const sealKey = pbkdf2Sync(
    ORACLE_PRIVATE_KEY,
    `injectme-seal-${ownerAddress.toLowerCase()}`,
    PBKDF2_ITERATIONS,
    32,
    'sha256'
  );

  return '0x' + sealKey.toString('hex');
}

/**
 * Re-encrypt a system prompt for transfer to a new owner.
 *
 * @param params.tokenId - The iNFT token ID
 * @param params.challengeAddress - The challenge contract address
 * @param params.newOwner - The new owner's wallet address
 * @param params.currentEncryptedPrompt - The currently encrypted prompt (v1:... format, oracle-key encrypted)
 *
 * @returns Re-encrypted prompt, sealed key, proof, and new metadata hash
 */
export async function reencryptForTransfer(params: {
  tokenId: number;
  challengeAddress: string;
  newOwner: string;
  currentEncryptedPrompt: string;
}): Promise<{
  newEncryptedPrompt: string;
  newSealedKey: string;
  proof: string;
  newMetadataHash: string;
}> {
  // Validate inputs
  if (!ethers.isAddress(params.newOwner)) {
    throw new Error('Invalid new owner address');
  }

  // 1. Decrypt with oracle key (existing encryption.ts handles this)
  const plaintext = deserializeAndDecrypt(params.currentEncryptedPrompt);

  // 2. Re-encrypt with new owner-derived key
  const newEncryptedPrompt = encryptForOwner(plaintext, params.newOwner);

  // 3. Compute old and new metadata hashes
  const oldMetadataHash = ethers.keccak256(ethers.toUtf8Bytes(params.currentEncryptedPrompt));
  const newMetadataHash = ethers.keccak256(ethers.toUtf8Bytes(newEncryptedPrompt));

  // 4. Sign proof: oracle signs (oldHash, newHash, newOwner, tokenId)
  //    This proves the oracle authorized the re-encryption
  const proofMessage = ethers.solidityPacked(
    ['bytes32', 'bytes32', 'address', 'uint256'],
    [oldMetadataHash, newMetadataHash, params.newOwner, params.tokenId]
  );
  const proofHash = ethers.keccak256(proofMessage);
  const signature = chain.signProof(proofHash);
  const proof = ethers.hexlify(ethers.concat([proofHash, signature]));

  // 5. Generate sealed key for the new owner
  const newSealedKey = deriveSealedKey(params.newOwner);

  return {
    newEncryptedPrompt,
    newSealedKey,
    proof,
    newMetadataHash,
  };
}
