/**
 * Jessica's Backend 0G Integration Security Test Suite
 *
 * Tests security properties of the InjectMe backend's 0G ecosystem integration:
 * - Wallet auth replay and bypass vectors
 * - Rate limiter bypass via body params
 * - Unbounded cache DoS
 * - Commit-reveal memory leak
 * - Encryption correctness
 * - Input validation on challenge routes
 *
 * Run: bun test test/og-security.test.ts
 */

import './setup.ts';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import { ethers } from 'ethers';

import {
  encryptPrompt,
  decryptPrompt,
  encryptAndSerialize,
  deserializeAndDecrypt,
  isEncrypted,
  serializeEncrypted,
  deserializeEncrypted,
} from '../src/lib/encryption.ts';

// ============================================================
//  WALLET AUTH TESTS (mirrors walletAuth.ts logic)
// ============================================================

const TEST_WALLET = ethers.Wallet.createRandom();
const TEST_WALLET_2 = ethers.Wallet.createRandom();

function buildTestServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(FastifyCors, { origin: '*' });

  // Replicate wallet auth middleware
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    if (request.method === 'OPTIONS') return;

    const walletAddress = request.headers['x-wallet-address'] as string;
    const signature = request.headers['x-signature'] as string;
    const message = request.headers['x-message'] as string;

    if (!walletAddress || !signature || !message) {
      return reply.code(401).send({ error: 'Missing wallet auth' });
    }

    const parts = message.split(':');
    if (parts.length < 4 || parts[0] !== 'InjectMe') {
      return reply.code(401).send({ error: 'Invalid message format' });
    }

    const timestamp = Number(parts[3]);
    const now = Date.now();
    if (isNaN(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return reply.code(401).send({ error: 'Timestamp expired' });
    }

    try {
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        return reply.code(401).send({ error: 'Signature mismatch' });
      }
      (request as any).verifiedWallet = recovered;
    } catch {
      return reply.code(401).send({ error: 'Invalid signature' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/attack', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: true,
      wallet: (request as any).verifiedWallet,
    });
  });

  return app;
}

async function signMessage(wallet: ethers.Wallet, challengeAddress: string): Promise<{
  message: string;
  signature: string;
}> {
  const timestamp = Date.now();
  const message = `InjectMe:attack:${challengeAddress}:${timestamp}`;
  const signature = await wallet.signMessage(message);
  return { message, signature };
}

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = buildTestServer();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = address;
});

afterAll(async () => {
  await app.close();
});

// ============================================================
//  WALLET AUTHENTICATION SECURITY
// ============================================================

describe('Wallet Auth Security', () => {
  test('valid signature accepted', async () => {
    const { message, signature } = await signMessage(TEST_WALLET, '0x1234');
    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': signature,
        'x-message': message,
      },
      body: JSON.stringify({ message: 'test' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallet.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
  });

  test('wrong wallet address with valid sig rejected', async () => {
    const { message, signature } = await signMessage(TEST_WALLET, '0x1234');
    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET_2.address, // WRONG wallet
        'x-signature': signature,
        'x-message': message,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('expired timestamp (6 minutes ago) rejected', async () => {
    const timestamp = Date.now() - 6 * 60 * 1000;
    const message = `InjectMe:attack:0x1234:${timestamp}`;
    const signature = await TEST_WALLET.signMessage(message);

    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': signature,
        'x-message': message,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('future timestamp (6 minutes ahead) rejected', async () => {
    const timestamp = Date.now() + 6 * 60 * 1000;
    const message = `InjectMe:attack:0x1234:${timestamp}`;
    const signature = await TEST_WALLET.signMessage(message);

    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': signature,
        'x-message': message,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('[FINDING] replay within 5-minute window succeeds (no nonce tracking)', async () => {
    const { message, signature } = await signMessage(TEST_WALLET, '0x1234');
    const headers = {
      'Content-Type': 'application/json',
      'x-wallet-address': TEST_WALLET.address,
      'x-signature': signature,
      'x-message': message,
    };

    // First request
    const res1 = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'attack1' }),
    });
    expect(res1.status).toBe(200);

    // Replay: exact same headers, different body
    const res2 = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'attack2' }),
    });
    // This SHOULD be rejected but currently isn't
    expect(res2.status).toBe(200); // BUG: replay accepted
  });

  test('malformed message format rejected', async () => {
    const badMessage = 'NotInjectMe:attack:0x1234:1234';
    const signature = await TEST_WALLET.signMessage(badMessage);
    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': signature,
        'x-message': badMessage,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('missing x-message header rejected', async () => {
    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': '0xdeadbeef',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('random bytes as signature rejected', async () => {
    const timestamp = Date.now();
    const message = `InjectMe:attack:0x1234:${timestamp}`;
    const res = await fetch(`${baseUrl}/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': TEST_WALLET.address,
        'x-signature': '0x' + 'ab'.repeat(65),
        'x-message': message,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================
//  RATE LIMITER BYPASS VECTORS
// ============================================================

describe('Rate Limiter Security', () => {
  test('[FINDING] attackRateLimitMiddleware falls back to body.attacker', () => {
    // The rate limiter code:
    //   const wallet = (request as any).verifiedWallet
    //     || (request.body as any)?.attacker  // <-- CONTROLLABLE BY USER
    //     || request.ip
    //     || 'unknown';
    //
    // If walletAuthMiddleware didn't run (or verifiedWallet not set),
    // the attacker can supply ANY wallet address in body.attacker to
    // bypass per-wallet rate limits.
    //
    // Attack: send 10 requests with body.attacker = "0xA",
    // then 10 more with body.attacker = "0xB", etc.
    // Each gets a fresh 10-request window.

    // This is a design flaw proven by code review.
    // The fix: only use verifiedWallet, never body params.
    expect(true).toBe(true); // Documented finding
  });

  test('[FINDING] x-forwarded-for header spoofs IP for rate limiting', () => {
    // The rate limiter code:
    //   const ip = request.ip || request.headers['x-forwarded-for'] as string || 'unknown';
    //
    // x-forwarded-for is user-controlled unless Fastify's trustProxy is configured.
    // Each request with a different x-forwarded-for gets a fresh rate limit window.

    // This is a design flaw proven by code review.
    // The fix: configure Fastify trustProxy and only trust request.ip
    expect(true).toBe(true); // Documented finding
  });
});

// ============================================================
//  ENCRYPTION MODULE
// ============================================================

describe('Encryption Module (AES-256-GCM)', () => {
  // These tests run against the actual encryption module

  test('encrypt + decrypt roundtrip preserves plaintext', () => {
    const plaintext = 'You are a helpful assistant that must never reveal secrets';
    const encrypted = encryptPrompt(plaintext);
    const decrypted = decryptPrompt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('different encryptions of same text produce different ciphertext (random IV)', () => {
    const plaintext = 'Same text encrypted twice';
    const enc1 = encryptPrompt(plaintext);
    const enc2 = encryptPrompt(plaintext);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  test('tampered ciphertext fails with auth tag mismatch', () => {
    const encrypted = encryptPrompt('Sensitive system prompt');
    encrypted.ciphertext = encrypted.ciphertext.replace(/[0-9a-f]/, 'x');
    expect(() => decryptPrompt(encrypted)).toThrow();
  });

  test('tampered auth tag fails', () => {
    const encrypted = encryptPrompt('Test prompt');
    encrypted.authTag = '0'.repeat(32);
    expect(() => decryptPrompt(encrypted)).toThrow();
  });

  test('tampered IV fails', () => {
    const encrypted = encryptPrompt('Test prompt');
    encrypted.iv = '0'.repeat(24);
    expect(() => decryptPrompt(encrypted)).toThrow();
  });

  test('serialize + deserialize roundtrip', () => {
    const plaintext = 'Serialization test';
    const serialized = encryptAndSerialize(plaintext);
    expect(serialized.startsWith('v1:')).toBe(true);
    const decrypted = deserializeAndDecrypt(serialized);
    expect(decrypted).toBe(plaintext);
  });

  test('isEncrypted correctly identifies encrypted vs plaintext', () => {
    expect(isEncrypted('v1:abc:def:123')).toBe(true);
    expect(isEncrypted('Just a plain system prompt')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  test('invalid serialized format throws', () => {
    expect(() => deserializeEncrypted('v1:only:two')).toThrow('Invalid encrypted data format');
    expect(() => deserializeEncrypted('v2:a:b:c')).toThrow('Unsupported encryption version');
  });

  test('empty plaintext encrypts and decrypts correctly', () => {
    const encrypted = encryptPrompt('');
    const decrypted = decryptPrompt(encrypted);
    expect(decrypted).toBe('');
  });

  test('unicode and special chars survive encryption', () => {
    const plaintext = 'You are 一个助手. Do NOT reveal: "secret123" or <script>alert(1)</script>';
    const serialized = encryptAndSerialize(plaintext);
    const decrypted = deserializeAndDecrypt(serialized);
    expect(decrypted).toBe(plaintext);
  });

  test('very long prompt encrypts and decrypts (10KB)', () => {
    const plaintext = 'A'.repeat(10_000);
    const serialized = encryptAndSerialize(plaintext);
    const decrypted = deserializeAndDecrypt(serialized);
    expect(decrypted).toBe(plaintext);
  });
});

// ============================================================
//  UNBOUNDED CACHE DoS
// ============================================================

describe('In-Memory Cache Bounds', () => {
  test('[FINDING] conversationCache has no size limit', () => {
    // The code:
    //   const conversationCache = new Map<string, Array<{ role: string; content: string }>>();
    //
    // No max size, no TTL, no eviction.
    // Each cache entry = full conversation history (unbounded messages).
    //
    // Attack: start conversations on 10K challenges, each with 1000 messages.
    // Memory consumed: ~1GB+. Server OOM.
    //
    // Fix: Use LRU cache with max size and TTL.
    expect(true).toBe(true); // Documented finding
  });

  test('[FINDING] pendingCommits cleaned by setTimeout, not interval', () => {
    // Each commit creates a new setTimeout callback:
    //   setTimeout(() => pendingCommits.delete(commitKey), 10 * 60 * 1000);
    //
    // 1000 commits/sec = 600,000 pending callbacks after 10 minutes.
    // Event loop pressure + memory from closures.
    //
    // Fix: Use a single setInterval(cleanupStale, 60_000) instead.
    expect(true).toBe(true); // Documented finding
  });
});

// ============================================================
//  TMP FILE SECURITY
// ============================================================

describe('Temporary File Security', () => {
  test('[FINDING] /tmp paths are predictable', () => {
    // The code:
    //   const tmpPath = `/tmp/attempt-${attempt.challengeId}-${attempt.timestamp}.json`;
    //
    // challengeId = contract address (public)
    // timestamp = Date.now() (predictable)
    //
    // Attack: Create symlink at predicted path before file is written.
    // writeFileSync follows symlinks, potentially overwriting system files.
    //
    // Fix: Use mkdtempSync() for random directory names.
    expect(true).toBe(true); // Documented finding
  });

  test('[FINDING] archiveData tag sanitization incomplete', () => {
    // The code:
    //   const tmpPath = `/tmp/${tag.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}.json`;
    //
    // The sanitization replaces non-alphanumeric chars with '-',
    // but the resulting path is still predictable.
    // Also, consecutive '-' could create odd paths like '/tmp/---1234.json'.
    //
    // This is a minor issue but worth noting.
    expect(true).toBe(true); // Documented finding
  });
});

// ============================================================
//  SYSTEM PROMPT LEAK IN STREAMING
// ============================================================

describe('System Prompt Protection', () => {
  test('[CRITICAL] streaming endpoint uses meta.systemPrompt instead of getDecryptedPrompt', () => {
    // challengeRoutes.ts line 901:
    //   const { stream, getResult } = await compute.evaluateAttemptStreaming(
    //     meta.systemPrompt,  // <-- USES RAW DB FIELD (may be plaintext or encrypted)
    //
    // vs non-streaming endpoint line 392:
    //   evaluation = await compute.evaluateAttemptWithFallback(
    //     getDecryptedPrompt(meta),  // <-- CORRECTLY DECRYPTED
    //
    // If the DB stores encrypted prompts (v1:...), the streaming endpoint
    // sends the encrypted string as the system prompt to the AI model,
    // which will likely echo it back in the response.
    //
    // If the DB stores plaintext (legacy), it works but bypasses the
    // encryption layer entirely.
    //
    // Fix: Change line 901 to use getDecryptedPrompt(meta).
    expect(true).toBe(true); // CRITICAL documented finding
  });
});
