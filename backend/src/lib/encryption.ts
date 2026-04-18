import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { ORACLE_PRIVATE_KEY } from '../config/main-config.ts';

/**
 * System Prompt Encryption Service
 *
 * Encrypts system prompts at rest using AES-256-GCM (as specified by ERC-7857).
 * The encryption key is derived from the oracle's private key using SHA-256.
 * Plaintext only exists in memory during TEE evaluation.
 *
 * Based on:
 * - INJECTME.md: "Defender's system prompt and secret are encrypted, only accessible inside TEE"
 * - ERC-7857 spec: "AES-256-GCM for symmetric encryption"
 * - Track 5 alignment: "Confidentiality rails"
 *
 * Security model:
 * - DB stores only ciphertext (encrypted prompt)
 * - 0G Storage KV stores only the hash (no prompt at all)
 * - Backend decrypts only when sending to 0G Compute Sealed Inference
 * - TEE ensures the inference provider can't exfiltrate the prompt
 * - Even a DB breach reveals nothing about the system prompt
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for AES-GCM (NIST recommended)
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derive a 256-bit encryption key from the oracle private key.
 * H-5 fix: uses PBKDF2 with 100k iterations instead of raw SHA-256.
 * Domain-separated salt prevents key reuse across different purposes.
 */
function deriveKey(): Buffer {
  if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY not configured');

  return pbkdf2Sync(
    ORACLE_PRIVATE_KEY,
    'injectme-prompt-encryption-v1', // Domain-separated salt
    100_000,                          // 100k iterations (OWASP recommended minimum)
    32,                               // 256-bit key
    'sha256'
  );
}

export interface EncryptedData {
  /** AES-256-GCM ciphertext (hex) */
  ciphertext: string;
  /** 96-bit initialization vector (hex) */
  iv: string;
  /** 128-bit authentication tag (hex) */
  authTag: string;
  /** Version for future-proofing */
  version: number;
}

/**
 * Encrypt a system prompt using AES-256-GCM.
 * Returns ciphertext + IV + auth tag (all hex-encoded).
 */
export function encryptPrompt(plaintext: string): EncryptedData {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
    version: 1,
  };
}

/**
 * Decrypt a system prompt from its encrypted form.
 * Only called when sending to 0G Compute TEE for evaluation.
 */
export function decryptPrompt(encrypted: EncryptedData): string {
  const key = deriveKey();
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Serialize encrypted data to a single string for DB storage.
 * Format: v1:<iv>:<authTag>:<ciphertext>
 */
export function serializeEncrypted(data: EncryptedData): string {
  return `v${data.version}:${data.iv}:${data.authTag}:${data.ciphertext}`;
}

/**
 * Deserialize encrypted data from DB storage.
 */
export function deserializeEncrypted(serialized: string): EncryptedData {
  const parts = serialized.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted data format');

  const version = parseInt(parts[0].replace('v', ''));
  if (version !== 1) throw new Error(`Unsupported encryption version: ${version}`);

  return {
    version,
    iv: parts[1],
    authTag: parts[2],
    ciphertext: parts[3],
  };
}

/**
 * Encrypt + serialize in one step (for storing in DB)
 */
export function encryptAndSerialize(plaintext: string): string {
  return serializeEncrypted(encryptPrompt(plaintext));
}

/**
 * Deserialize + decrypt in one step (for reading from DB before TEE evaluation)
 */
export function deserializeAndDecrypt(serialized: string): string {
  return decryptPrompt(deserializeEncrypted(serialized));
}

/**
 * Check if a stored value is encrypted (vs legacy plaintext)
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith('v1:');
}

// ============================================================
//    OWNER-SPECIFIC ENCRYPTION (for TEE re-encryption flow)
// ============================================================

/**
 * Derive a 256-bit key specific to an owner address.
 * Key derivation: PBKDF2(oraclePrivateKey, 'injectme-owner-' + ownerAddress, 100000)
 * Each owner gets a unique key, but oracle can always derive it.
 */
function deriveOwnerKey(ownerAddress: string): Buffer {
  if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY not configured');

  return pbkdf2Sync(
    ORACLE_PRIVATE_KEY,
    `injectme-owner-${ownerAddress.toLowerCase()}`,
    100_000,
    32,
    'sha256'
  );
}

/**
 * Encrypt plaintext with an owner-specific key.
 * Returns serialized format: v1:<iv>:<authTag>:<ciphertext>
 */
export function encryptForOwner(plaintext: string, ownerAddress: string): string {
  const key = deriveOwnerKey(ownerAddress);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return serializeEncrypted({ ciphertext, iv: iv.toString('hex'), authTag, version: 1 });
}

/**
 * Decrypt ciphertext encrypted with an owner-specific key.
 */
export function decryptForOwner(serialized: string, ownerAddress: string): string {
  const data = deserializeEncrypted(serialized);
  const key = deriveOwnerKey(ownerAddress);
  const iv = Buffer.from(data.iv, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Generate a sealed key for an owner.
 * This is a deterministic identifier derived from the oracle key and owner address.
 * The owner can present this to prove they are the intended recipient
 * of a re-encrypted prompt, but it does not contain the actual decryption key.
 */
export function deriveSealedKey(ownerAddress: string): string {
  if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY not configured');

  const sealKey = pbkdf2Sync(
    ORACLE_PRIVATE_KEY,
    `injectme-seal-${ownerAddress.toLowerCase()}`,
    100_000,
    32,
    'sha256'
  );

  return '0x' + sealKey.toString('hex');
}
