import { ethers } from 'ethers';
import {
  STORAGE_PRIVATE_KEY,
} from '../../config/main-config.ts';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as storage from './index.ts';

/**
 * Encrypted Storage Layer for 0G Storage.
 *
 * Implements ECIES (Elliptic Curve Integrated Encryption Scheme) manually
 * because @0gfoundation/0g-ts-sdk v1.2.1 does not expose encryption options
 * on the Indexer.upload method.
 *
 * Security model:
 * - Data is encrypted client-side with AES-256-GCM before upload
 * - The AES key is derived from an ECDH shared secret
 * - Only the holder of the matching private key can decrypt
 * - 0G Storage network never sees plaintext
 *
 * Format: ECIES envelope
 * - Ephemeral public key (33 bytes, compressed secp256k1)
 * - IV (12 bytes)
 * - Auth tag (16 bytes)
 * - Ciphertext (variable)
 *
 * Serialized as: ecies:v1:<ephemeralPubKey>:<iv>:<authTag>:<ciphertext> (all hex)
 */

const ECIES_VERSION = 1;
const AES_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive ECDH shared secret using ethers v6 SigningKey.
 * ethers v6: signingKey.computeSharedSecret(otherPublicKey) is an instance method.
 */
function deriveSharedSecret(privateKey: string, publicKey: string): string {
  const signingKey = new ethers.SigningKey(privateKey);
  return signingKey.computeSharedSecret(publicKey);
}

/**
 * Encrypt data using ECIES with secp256k1.
 * The recipient's public key is used to derive a shared AES key.
 */
function eciesEncrypt(plaintext: string, recipientPubKeyHex: string): string {
  // Generate ephemeral keypair
  const ephemeralKey = ethers.Wallet.createRandom();
  const ephemeralPrivate = ephemeralKey.signingKey.privateKey;
  const ephemeralPublic = ethers.SigningKey.computePublicKey(
    ephemeralKey.signingKey.publicKey,
    true // compressed
  );

  // Derive shared secret via ECDH (instance method in ethers v6)
  const sharedSecret = deriveSharedSecret(ephemeralPrivate, recipientPubKeyHex);

  // Derive AES key from shared secret using keccak256
  const aesKey = Buffer.from(
    ethers.keccak256(sharedSecret).slice(2), // Remove 0x prefix
    'hex'
  );

  // Encrypt with AES-256-GCM
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Serialize: ecies:v1:<ephemeralPub>:<iv>:<authTag>:<ciphertext>
  return `ecies:v${ECIES_VERSION}:${ephemeralPublic}:${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

/**
 * Decrypt ECIES-encrypted data.
 * The recipient's private key is used to derive the shared AES key.
 */
function eciesDecrypt(serialized: string, recipientPrivateKey: string): string {
  const parts = serialized.split(':');
  if (parts.length !== 6 || parts[0] !== 'ecies') {
    throw new Error('Invalid ECIES envelope format');
  }

  const version = parseInt(parts[1].replace('v', ''));
  if (version !== ECIES_VERSION) {
    throw new Error(`Unsupported ECIES version: ${version}`);
  }

  const ephemeralPubKey = parts[2];
  const iv = Buffer.from(parts[3], 'hex');
  const authTag = Buffer.from(parts[4], 'hex');
  const ciphertext = parts[5];

  // Derive shared secret via ECDH (instance method in ethers v6)
  const sharedSecret = deriveSharedSecret(recipientPrivateKey, ephemeralPubKey);

  // Derive same AES key
  const aesKey = Buffer.from(
    ethers.keccak256(sharedSecret).slice(2),
    'hex'
  );

  // Decrypt with AES-256-GCM
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Archive data with ECIES encryption to 0G Storage.
 * Encrypts client-side, then uploads the ciphertext using the standard storage upload.
 *
 * The encryption key should be the recipient's compressed public key (hex).
 * Only the corresponding private key holder can decrypt.
 */
export async function archiveEncrypted(params: {
  data: string;
  encryptionKey: string; // Recipient's compressed public key (hex)
  tag: string;
}): Promise<{ rootHash: string; merkleRoot: string }> {
  // Encrypt the data client-side
  const encrypted = eciesEncrypt(params.data, params.encryptionKey);

  // Upload encrypted data through standard storage path
  const result = await storage.archiveData(encrypted, params.tag);

  return {
    rootHash: result.rootHash,
    merkleRoot: result.rootHash,
  };
}

/**
 * Download and decrypt data from 0G Storage.
 * Downloads the ECIES envelope, then decrypts with the private key.
 */
export async function downloadDecrypted(params: {
  rootHash: string;
  decryptionKey: string; // Private key (hex) matching the encryption pubkey
}): Promise<string> {
  // Download to temp file
  const { readFileSync, unlinkSync, mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const path = await import('path');

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'injectme-dec-'));
  const tmpPath = path.join(tmpDir, 'encrypted.dat');

  try {
    await storage.downloadFile(params.rootHash, tmpPath);
    const encrypted = readFileSync(tmpPath, 'utf-8');

    // Check if this is actually an ECIES envelope
    if (!encrypted.startsWith('ecies:v')) {
      // Not encrypted, return as-is (legacy plaintext data)
      return encrypted;
    }

    return eciesDecrypt(encrypted, params.decryptionKey);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Publish unencrypted dataset to 0G Storage (public good).
 * Used for alignment training data that is intended to be publicly accessible.
 * No encryption; anyone can download and verify.
 */
export async function publishPublicDataset(params: {
  data: string;
  tag: string;
}): Promise<{ rootHash: string }> {
  const result = await storage.archiveData(params.data, params.tag);
  return { rootHash: result.rootHash };
}

/**
 * Derive the compressed public key from a private key.
 * Used to derive the encryption target from the oracle's storage key
 * or from a challenge-derived key.
 */
export function derivePublicKey(privateKey: string): string {
  const signingKey = new ethers.SigningKey(privateKey);
  return ethers.SigningKey.computePublicKey(signingKey.publicKey, true);
}

/**
 * Derive a deterministic encryption key from the challenge's secret hash.
 * This produces a per-challenge private key so each challenge's data
 * is encrypted under a unique key.
 *
 * Key derivation: keccak256(STORAGE_PRIVATE_KEY || secretHash)
 * This ensures:
 * - Each challenge has its own encryption key
 * - Only the oracle (holder of STORAGE_PRIVATE_KEY) can derive the key
 * - The defender can request decryption through the oracle
 */
export function deriveKeyFromSecretHash(secretHash: string): string {
  if (!STORAGE_PRIVATE_KEY) throw new Error('STORAGE_PRIVATE_KEY not configured');
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32'], [STORAGE_PRIVATE_KEY, secretHash])
  );
}

/**
 * Check if stored data is ECIES encrypted.
 * Reads the first few bytes to check for the ECIES envelope prefix.
 */
export function isEciesEncrypted(data: string): boolean {
  return data.startsWith('ecies:v');
}
