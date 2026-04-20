import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import { handleError, handleNotFoundError, handleServerError, handleForbiddenError } from '../utils/errorHandler.ts';
import * as chain from '../lib/og-chain/index.ts';
import * as compute from '../lib/og-compute/index.ts';
import * as storage from '../lib/og-storage/index.ts';
import * as encStorage from '../lib/og-storage/encryptedStorage.ts';
import { generateReport } from '../lib/reportGenerator.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { walletAuthMiddleware } from '../middlewares/walletAuth.ts';
import { attackRateLimitMiddleware } from '../middlewares/rateLimit.ts';
import { ethers } from 'ethers';
import { LRUCache } from 'lru-cache';
import { encryptAndSerialize, deserializeAndDecrypt, isEncrypted } from '../lib/encryption.ts';
import { WRAPPED_0G_ADDRESS, REPUTATION_REGISTRY_ADDRESS, ERC20_FACTORY_ADDRESS } from '../config/main-config.ts';

// H-1 fix: bounded conversation cache with TTL (prevents DoS via memory exhaustion)
const conversationCache = new LRUCache<string, Array<{ role: string; content: string }>>({
  max: 10_000,
  ttl: 60 * 60 * 1000, // 1 hour
});

/** Decrypt system prompt from DB record. Handles both encrypted (v1:...) and legacy plaintext. */
function getDecryptedPrompt(challenge: { systemPromptEncrypted?: string; systemPrompt?: string }): string {
  const stored = (challenge as any).systemPromptEncrypted || (challenge as any).systemPrompt || '';
  if (isEncrypted(stored)) {
    return deserializeAndDecrypt(stored);
  }
  return stored; // Legacy plaintext fallback
}

// In-memory pending commits for commit-reveal (TTL: 10 min)
const pendingCommits = new Map<string, {
  message: string;
  salt: string;
  commitHash: string;
  attacker: string;
  challengeAddress: string;
  createdAt: number;
}>();

// H-2 fix: single interval cleanup instead of per-entry setTimeout
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, pending] of pendingCommits) {
    if (pending.createdAt < cutoff) pendingCommits.delete(key);
  }
}, 60_000);

function getConversationKey(challengeId: string, attacker: string): string {
  return `${challengeId}:${attacker}`;
}

export const challengeRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // ============================================================
  //              0G COMPUTE: SETUP & DISCOVERY
  // ============================================================

  /** Setup compute account (deposit + transfer to provider) */
  app.post('/compute/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const providerAddress = (body?.providerAddress as string) || process.env.OG_COMPUTE_PROVIDER || '';
      const depositAmount = Number(body?.depositAmount) || 10;

      if (!providerAddress) {
        return handleError(reply, 400, 'Provider address required', 'MISSING_PROVIDER');
      }

      await compute.setupAccount(providerAddress, depositAmount);
      const balance = await compute.getAccountBalance();

      return reply.code(200).send({
        success: true,
        error: null,
        data: { balance, providerAddress, message: 'Account setup complete' },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /** List available inference services */
  app.get('/compute/services', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const services = await compute.listServices();
      return reply.code(200).send({
        success: true,
        error: null,
        data: { services },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /** Get compute account balance */
  app.get('/compute/balance', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const balance = await compute.getAccountBalance();
      return reply.code(200).send({
        success: true,
        error: null,
        data: balance,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //                  LIST CHALLENGES
  // ============================================================

  /** List active challenges with optional filters (Section 14: filter by type/difficulty/model/prize) */
  /** Supports paginated listing with ?page=N&limit=N&all=true to get ALL challenges (not just active) */
  app.get('/list', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as {
        type?: string;        // "tournament" | "bounty"
        difficulty?: string;  // "beginner" | "intermediate" | "advanced" | "expert"
        model?: string;       // model name filter
        minPrize?: string;    // minimum prize pool in 0G
        label?: string;       // challenge label (secret_extraction, etc.)
        all?: string;         // "true" to get all challenges (not just active)
        page?: string;        // page number (1-indexed, default 1)
        limit?: string;       // items per page (default 20, max 100)
      };

      let addresses: string[];
      let totalCount: number | undefined;

      if (query.all === 'true') {
        // Paginated listing of ALL challenges (not just active)
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        const offset = (page - 1) * limit;

        totalCount = await chain.getChallengeCount();
        addresses = await chain.getChallengesPaginated(offset, limit);
      } else {
        // Default: active challenges only
        addresses = await chain.getActiveChallenges(50);
      }
      const challenges = await Promise.all(
        addresses.map((addr: string) => chain.getChallengeDetails(addr))
      );

      // Enrich with metadata from DB
      let enriched = await Promise.all(
        challenges.map(async (c: Awaited<ReturnType<typeof chain.getChallengeDetails>>) => {
          const meta = await prismaQuery.challenge.findUnique({
            where: { contractAddress: c.address },
          }).catch(() => null);

          return {
            ...c,
            name: meta?.name || 'Unnamed Challenge',
            model: meta?.model || 'unknown',
            description: meta?.description || '',
            visibility: (meta as any)?.visibility || 'public',
            difficulty: (meta as any)?.difficulty || 'intermediate',
            challengeLabel: (meta as any)?.challengeLabel || 'secret_extraction',
            prizeType: (meta as any)?.tokenAddress ? 'erc20' : 'native',
            tokenAddress: (meta as any)?.tokenAddress || null,
            tokenSymbol: (meta as any)?.tokenSymbol || null,
          };
        })
      );

      // Filter out unlisted challenges (unless explicitly requested)
      enriched = enriched.filter(c => c.visibility === 'public');

      // Apply query filters
      if (query.type) {
        const typeMap: Record<string, number> = { tournament: 0, bounty: 1, alignment: 2 };
        const typeNum = typeMap[query.type.toLowerCase()];
        if (typeNum !== undefined) {
          enriched = enriched.filter(c => c.challengeType === typeNum);
        }
      }
      if (query.difficulty) {
        enriched = enriched.filter(c => c.difficulty === query.difficulty);
      }
      if (query.model) {
        enriched = enriched.filter(c => c.model.toLowerCase().includes(query.model!.toLowerCase()));
      }
      if (query.minPrize) {
        const minPrize = parseFloat(query.minPrize);
        enriched = enriched.filter(c => parseFloat(c.prizePool) >= minPrize);
      }
      if (query.label) {
        enriched = enriched.filter(c => c.challengeLabel === query.label);
      }

      const responseData: Record<string, unknown> = { challenges: enriched };
      if (totalCount !== undefined) {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
        responseData.pagination = {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        };
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: query.all === 'true' ? responseData : enriched,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //                  GET CHALLENGE DETAILS
  // ============================================================

  app.get('/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      const details = await chain.getChallengeDetails(address);
      const meta = await prismaQuery.challenge.findUnique({
        where: { contractAddress: address },
      }).catch(() => null);

      // Fallback to 0G Storage KV if DB record does not exist
      // (e.g., challenge was created on-chain but not through our API)
      let kvConfig: any = null;
      if (!meta) {
        try {
          kvConfig = await storage.getChallengeConfig(address);
        } catch {}
      }

      const source = meta || kvConfig;

      // Resolve token info if ERC-20 challenge
      let tokenInfo = null;
      if ((meta as any)?.tokenAddress) {
        try {
          tokenInfo = await chain.getTokenInfo((meta as any).tokenAddress);
        } catch {}
      }

      // Get alignment-specific data
      let alignmentData = null;
      if (details.challengeType === 2) {
        try {
          const [samples, rewardPerAttempt] = await Promise.all([
            chain.getAlignmentSamples(address),
            chain.getRewardPerAttempt(address),
          ]);
          alignmentData = {
            totalSamples: samples,
            rewardPerAttempt: ethers.formatEther(rewardPerAttempt),
          };
        } catch {}
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          ...details,
          name: source?.name || 'Unnamed Challenge',
          model: source?.model || 'unknown',
          systemPromptHash: meta?.systemPromptHash || source?.systemPromptHash || '',
          description: meta?.description || '',
          visibility: (meta as any)?.visibility || 'public',
          difficulty: (meta as any)?.difficulty || 'intermediate',
          challengeLabel: (meta as any)?.challengeLabel || 'secret_extraction',
          isEncrypted: meta?.systemPromptEncrypted ? isEncrypted(meta.systemPromptEncrypted) : false,
          dataSource: meta ? 'database' : kvConfig ? 'kv_storage' : 'on_chain_only',
          prizeType: (meta as any)?.tokenAddress ? 'erc20' : 'native',
          tokenInfo: tokenInfo ? {
            address: (meta as any).tokenAddress,
            ...tokenInfo,
          } : null,
          alignmentData,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              CREATE CHALLENGE (off-chain metadata)
  // ============================================================

  app.post('/create', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(
        body,
        ['contractAddress', 'name', 'model', 'systemPrompt', 'defender'],
        reply
      );
      if (validation !== true) return;

      const {
        contractAddress, name, model, systemPrompt, defender,
        description, visibility, difficulty, challengeLabel
      } = body as {
        contractAddress: string;
        name: string;
        model: string;
        systemPrompt: string;
        defender: string;
        description?: string;
        visibility?: string;    // "public" | "unlisted"
        difficulty?: string;    // beginner | intermediate | advanced | expert
        challengeLabel?: string; // secret_extraction | function_abuse | persona_break | etc.
      };

      // Verify the contract exists on-chain
      const details = await chain.getChallengeDetails(contractAddress);
      if (!details.active) {
        return handleError(reply, 400, 'Challenge is not active', 'CHALLENGE_INACTIVE');
      }

      // Encrypt system prompt (AES-256-GCM, ERC-7857 spec)
      // Plaintext never stored in DB, only ciphertext
      const encryptedPrompt = encryptAndSerialize(systemPrompt);
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes(systemPrompt));

      // Store metadata in DB (encrypted prompt only)
      const challenge = await prismaQuery.challenge.upsert({
        where: { contractAddress },
        create: {
          contractAddress,
          name,
          model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          defender,
          description: (description as string) || '',
          visibility: visibility || 'public',
          difficulty: difficulty || 'intermediate',
          challengeLabel: challengeLabel || 'secret_extraction',
        },
        update: {
          name, model, systemPromptEncrypted: encryptedPrompt,
          description: (description as string) || '',
          visibility: visibility || undefined,
          difficulty: difficulty || undefined,
          challengeLabel: challengeLabel || undefined,
        },
      });

      // Store config on 0G Storage KV
      try {
        await storage.setChallengeConfig(contractAddress, {
          name,
          defender,
          model,
          systemPromptHash: promptHash,
          prizePool: details.prizePool,
          messagePrice: details.messagePrice,
          totalAttempts: details.totalAttempts,
          active: true,
          contractAddress,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[0G Storage] KV write failed (non-fatal):', err);
      }

      return reply.code(201).send({
        success: true,
        error: null,
        data: { id: challenge.id, contractAddress },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //      COMMIT-REVEAL: ANTI-FRONT-RUNNING (Track 5: Privacy)
  // ============================================================

  /**
   * Phase 1: Attacker commits a hash of their message.
   * Returns the salt and commitHash for later reveal.
   * The attacker pays the message fee at commit time.
   *
   * Flow: Frontend hashes (message + salt + attacker) and sends commitAttempt tx.
   * This endpoint helps the frontend build the correct hash.
   */
  app.post('/:address/commit', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };
      const body = request.body as Record<string, unknown>;

      const validation = await validateRequiredFields(body, ['message', 'attacker'], reply);
      if (validation !== true) return;

      const { message, attacker } = body as { message: string; attacker: string };

      // Generate salt
      const salt = chain.generateSalt();

      // Build commit hash: keccak256(messageHash, salt, attacker)
      const commitHash = chain.buildCommitHash(message, salt, attacker);

      // Store message + salt temporarily for reveal phase (in memory, TTL 5 min)
      const commitKey = `${address}:${attacker}`;
      pendingCommits.set(commitKey, {
        message,
        salt,
        commitHash,
        attacker,
        challengeAddress: address,
        createdAt: Date.now(),
      });

      // H-2 fix: cleanup handled by global interval, not per-entry setTimeout

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          commitHash,
          salt,
          note: 'Send commitAttempt(commitHash) tx to the Challenge contract with messagePrice as value. Then call POST /:address/reveal within 5 minutes.',
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * Phase 2: Reveal the message after commit is on-chain.
   * Backend verifies the commit, evaluates via TEE, and calls revealAndRecord on-chain.
   */
  app.post('/:address/reveal', { preHandler: [walletAuthMiddleware, attackRateLimitMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };
      const body = request.body as Record<string, unknown>;

      const validation = await validateRequiredFields(body, ['attacker'], reply);
      if (validation !== true) return;

      const { attacker } = body as { attacker: string };

      // Look up the pending commit
      const commitKey = `${address}:${attacker}`;
      const pending = pendingCommits.get(commitKey);
      if (!pending) {
        return handleError(reply, 400, 'No pending commit found. Call POST /:address/commit first.', 'NO_COMMIT');
      }

      // Verify the commit is on-chain and valid
      const hasCommit = await chain.hasValidCommit(address, attacker);
      if (!hasCommit) {
        return handleError(reply, 400, 'No valid on-chain commit. Send commitAttempt tx first, or reveal window expired.', 'NO_ONCHAIN_COMMIT');
      }

      const details = await chain.getChallengeDetails(address);
      if (!details.active) {
        return handleError(reply, 400, 'Challenge is not active', 'CHALLENGE_INACTIVE');
      }

      const meta = await prismaQuery.challenge.findUnique({ where: { contractAddress: address } });
      if (!meta) return handleNotFoundError(reply, 'Challenge metadata');

      // Load conversation
      const convKey = getConversationKey(address, attacker);
      const history = conversationCache.get(convKey) || [];

      // Evaluate via TEE
      let evaluation;
      try {
        evaluation = await compute.evaluateAttemptWithFallback(
          getDecryptedPrompt(meta),
          history as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
          pending.message,
          meta.model
        );
      } catch (err) {
        return handleError(reply, 502, 'AI evaluation service unavailable', 'COMPUTE_UNAVAILABLE', err as Error);
      }

      // Update conversation
      const updatedHistory = [...history, { role: 'user', content: pending.message }, { role: 'assistant', content: evaluation.aiResponse }];
      conversationCache.set(convKey, updatedHistory);

      const owaspCategory = classifyOWASP(pending.message);

      // Archive to 0G Storage (encrypted if possible, fallback to plaintext)
      let storageRoot = '0x' + '0'.repeat(64);
      try {
        const attemptData = JSON.stringify({
          version: 1, challengeId: address, attemptNumber: details.totalAttempts + 1,
          attacker, timestamp: Date.now(), message: pending.message, response: evaluation.aiResponse,
          judgment: evaluation.success ? 'SUCCESS' : 'FAILED', reason: evaluation.reason,
          chatID: evaluation.chatID, teeVerified: evaluation.teeVerified, owaspCategory, model: evaluation.model,
        });
        // Use ECIES encrypted storage with oracle-derived key
        try {
          const pubKey = encStorage.derivePublicKey(
            encStorage.deriveKeyFromSecretHash(meta.systemPromptHash)
          );
          const archived = await encStorage.archiveEncrypted({
            data: attemptData,
            encryptionKey: pubKey,
            tag: `injectme:attempt:${address}`,
          });
          storageRoot = archived.rootHash;
        } catch {
          // Fallback to unencrypted archive if SDK encryption fails
          const archived = await storage.archiveAttempt({
            version: 1, challengeId: address, attemptNumber: details.totalAttempts + 1,
            attacker, timestamp: Date.now(), message: pending.message, response: evaluation.aiResponse,
            judgment: evaluation.success ? 'SUCCESS' : 'FAILED', reason: evaluation.reason,
            chatID: evaluation.chatID, teeVerified: evaluation.teeVerified, owaspCategory, model: evaluation.model,
          });
          storageRoot = archived.rootHash;
        }
      } catch (err) {
        console.error('[0G Storage] Archive failed (non-fatal):', err);
      }

      // Call revealAndRecord on-chain (verifies commit hash match)
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes(pending.message));
      const previousCount = details.totalAttempts;
      try {
        await chain.revealAndRecord(address, attacker, messageHash, pending.salt, storageRoot);
      } catch (err) {
        console.error('[0G Chain] revealAndRecord failed:', err);
        // H-4 fix: check if it actually went through before fallback (prevents double recording)
        try {
          const currentDetails = await chain.getChallengeDetails(address);
          if (currentDetails.totalAttempts > previousCount) {
            console.log('[0G Chain] revealAndRecord succeeded despite error response');
          } else {
            const messagePrice = BigInt(details.messagePrice);
            await chain.recordAttempt(address, attacker, storageRoot, details.challengeType === 0 ? messagePrice : 0n);
          }
        } catch {}
      }

      // Fire-and-forget: record attacker attempt on ReputationRegistry
      chain.recordAttackerAttempt(attacker, address)
        .catch(err => console.error('[ReputationRegistry] recordAttackerAttempt failed (non-fatal):', err));

      // Update iNFT
      try {
        await chain.updateAgentStats(address, details.totalAttempts + 1, evaluation.success ? details.totalAttempts : details.totalAttempts + 1);
      } catch {}

      // TEE attestation archive + anchor on-chain
      if (evaluation.teeVerified && evaluation.chatID) {
        storage.archiveAttestation(address, evaluation.chatID, { model: evaluation.model, teeVerified: true, judgment: evaluation.success ? 'SUCCESS' : 'FAILED', timestamp: Date.now() }).catch(() => {});

        // Anchor TEE attestation hash on-chain (fire-and-forget)
        const attestationHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
          chatID: evaluation.chatID, model: evaluation.model, teeVerified: true,
        })));
        chain.anchorAttestation(address, attestationHash)
          .catch(err => console.error('[0G Chain] anchorAttestation failed (non-fatal):', err));
      }

      // Determine archival status
      const revealArchivalStatus = storageRoot === '0x' + '0'.repeat(64) ? 'FAILED' : 'ARCHIVED';

      // If SUCCESS: claim victory
      if (evaluation.success) {
        try {
          await chain.claimVictory(address, attacker, evaluation.chatID);
          await chain.markAgentBreached(address, details.totalAttempts + 1);
        } catch {}

        // Fire-and-forget: record attacker victory on ReputationRegistry
        const prizeWei = ethers.parseEther(details.prizePool);
        chain.recordAttackerVictory(attacker, address, prizeWei)
          .catch(err => console.error('[ReputationRegistry] recordAttackerVictory failed (non-fatal):', err));
        chain.recordDefenderBreached(details.defender, address, prizeWei)
          .catch(err => console.error('[ReputationRegistry] recordDefenderBreached failed (non-fatal):', err));

        conversationCache.delete(convKey);
      }

      // Store in DB
      await prismaQuery.attempt.create({
        data: { challengeAddress: address, attacker, message: pending.message, response: evaluation.aiResponse, judgment: evaluation.success ? 'SUCCESS' : 'FAILED', chatID: evaluation.chatID, teeVerified: evaluation.teeVerified, owaspCategory, storageRoot, archivalStatus: revealArchivalStatus },
      }).catch(() => {});

      storage.setConversation(address, attacker, updatedHistory).catch(() => {});

      // Clean up pending commit
      pendingCommits.delete(commitKey);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          judgment: evaluation.success ? 'SUCCESS' : 'FAILED',
          response: evaluation.aiResponse,
          reason: evaluation.reason,
          chatID: evaluation.chatID,
          teeVerified: evaluation.teeVerified,
          commitReveal: true,
          prizePool: evaluation.success ? details.prizePool : undefined,
          attemptNumber: details.totalAttempts + 1,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              ATTACK (Legacy direct path, no commit-reveal)
  // ============================================================

  app.post('/:address/attack', { preHandler: [walletAuthMiddleware, attackRateLimitMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };
      const body = request.body as Record<string, unknown>;

      const validation = await validateRequiredFields(body, ['message', 'attacker'], reply);
      if (validation !== true) return;

      const { message, attacker } = body as { message: string; attacker: string };

      // Validate message length
      if ((message as string).length > 2000) {
        return handleError(reply, 400, 'Message too long (max 2000 chars)', 'MESSAGE_TOO_LONG');
      }

      // 1. Verify challenge is active on-chain
      const details = await chain.getChallengeDetails(address);
      if (!details.active) {
        return handleError(reply, 400, 'Challenge is not active', 'CHALLENGE_INACTIVE');
      }

      // 2. Get system prompt from DB
      const meta = await prismaQuery.challenge.findUnique({
        where: { contractAddress: address },
      });
      if (!meta) {
        return handleNotFoundError(reply, 'Challenge metadata');
      }

      // 3. Load conversation history (memory cache, fallback to empty)
      const convKey = getConversationKey(address, attacker);
      const history = conversationCache.get(convKey) || [];

      // 4. Evaluate via 0G Compute (Sealed Inference / TEE)
      let evaluation;
      try {
        evaluation = await compute.evaluateAttemptWithFallback(
          getDecryptedPrompt(meta),
          history as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
          message,
          meta.model
        );
      } catch (err) {
        console.error('[0G Compute] Evaluation failed:', err);
        return handleError(reply, 502, 'AI evaluation service unavailable', 'COMPUTE_UNAVAILABLE', err as Error);
      }

      // 5. Update conversation history
      const updatedHistory = [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: evaluation.aiResponse },
      ];
      conversationCache.set(convKey, updatedHistory);

      // 6. Determine OWASP category (basic heuristic)
      const owaspCategory = classifyOWASP(message);

      // 7. Archive attempt to 0G Storage Log Layer (encrypted, permanent)
      let storageRoot = '0x' + '0'.repeat(64);
      try {
        const judgment = (evaluation.success ? 'SUCCESS' : 'FAILED') as 'SUCCESS' | 'FAILED';
        const attemptRecord = {
          version: 1,
          challengeId: address,
          attemptNumber: details.totalAttempts + 1,
          attacker,
          timestamp: Date.now(),
          message,
          response: evaluation.aiResponse,
          judgment,
          reason: evaluation.reason,
          chatID: evaluation.chatID,
          teeVerified: evaluation.teeVerified,
          owaspCategory,
          model: evaluation.model,
        };
        // Try encrypted upload first, fall back to unencrypted
        try {
          const pubKey = encStorage.derivePublicKey(
            encStorage.deriveKeyFromSecretHash(meta.systemPromptHash)
          );
          const archived = await encStorage.archiveEncrypted({
            data: JSON.stringify(attemptRecord),
            encryptionKey: pubKey,
            tag: `injectme:attempt:${address}`,
          });
          storageRoot = archived.rootHash;
        } catch {
          const archived = await storage.archiveAttempt(attemptRecord);
          storageRoot = archived.rootHash;
        }
      } catch (err) {
        console.error('[0G Storage] Archive failed (non-fatal):', err);
      }

      // 8. Record attempt on-chain (oracle tx)
      try {
        const messagePrice = BigInt(details.messagePrice);
        if (details.challengeType === 0) {
          // Tournament: oracle sends fee
          await chain.recordAttempt(address, attacker, storageRoot, messagePrice);
        } else {
          // Bounty: no fee
          await chain.recordAttempt(address, attacker, storageRoot, 0n);
        }
      } catch (err) {
        console.error('[0G Chain] recordAttempt failed:', err);
        // Don't fail the request, the evaluation still happened
      }

      // Fire-and-forget: record attacker attempt on ReputationRegistry
      chain.recordAttackerAttempt(attacker, address)
        .catch(err => console.error('[ReputationRegistry] recordAttackerAttempt failed (non-fatal):', err));

      // 9. Update iNFT stats
      try {
        const newTotal = details.totalAttempts + 1;
        const newSurvived = evaluation.success ? details.totalAttempts : newTotal;
        await chain.updateAgentStats(address, newTotal, newSurvived);
      } catch (err) {
        console.error('[0G Chain] updateAgentStats failed (non-fatal):', err);
      }

      // 10. Archive TEE attestation to 0G Storage Log (permanent proof)
      if (evaluation.teeVerified && evaluation.chatID) {
        storage.archiveAttestation(address, evaluation.chatID, {
          model: evaluation.model,
          teeVerified: evaluation.teeVerified,
          judgment: evaluation.success ? 'SUCCESS' : 'FAILED',
          timestamp: Date.now(),
        }).catch(err => console.error('[0G Storage] Attestation archive failed (non-fatal):', err));

        // Anchor TEE attestation hash on-chain (fire-and-forget)
        const attestationHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
          chatID: evaluation.chatID, model: evaluation.model, teeVerified: true,
        })));
        chain.anchorAttestation(address, attestationHash)
          .catch(err => console.error('[0G Chain] anchorAttestation failed (non-fatal):', err));
      }

      // Determine archival status based on storageRoot
      const archivalStatus = storageRoot === '0x' + '0'.repeat(64) ? 'FAILED' : 'ARCHIVED';

      // 11. If SUCCESS: claim victory on-chain
      if (evaluation.success) {
        try {
          await chain.claimVictory(address, attacker, evaluation.chatID);
          await chain.markAgentBreached(address, details.totalAttempts + 1);
        } catch (err) {
          console.error('[0G Chain] claimVictory failed:', err);
        }

        // Fire-and-forget: record attacker victory on ReputationRegistry
        const attackPrizeWei = ethers.parseEther(details.prizePool);
        chain.recordAttackerVictory(attacker, address, attackPrizeWei)
          .catch(err => console.error('[ReputationRegistry] recordAttackerVictory failed (non-fatal):', err));
        chain.recordDefenderBreached(details.defender, address, attackPrizeWei)
          .catch(err => console.error('[ReputationRegistry] recordDefenderBreached failed (non-fatal):', err));

        // Store attempt result in DB
        await prismaQuery.attempt.create({
          data: {
            challengeAddress: address,
            attacker,
            message,
            response: evaluation.aiResponse,
            judgment: 'SUCCESS',
            chatID: evaluation.chatID,
            teeVerified: evaluation.teeVerified,
            owaspCategory,
            storageRoot,
            archivalStatus,
          },
        }).catch(console.error);

        // Clear conversation cache
        conversationCache.delete(convKey);

        return reply.code(200).send({
          success: true,
          error: null,
          data: {
            judgment: 'SUCCESS',
            response: evaluation.aiResponse,
            reason: evaluation.reason,
            chatID: evaluation.chatID,
            teeVerified: evaluation.teeVerified,
            prizeWon: details.prizePool,
            attemptNumber: details.totalAttempts + 1,
          },
        });
      }

      // FAILED: store attempt and continue
      await prismaQuery.attempt.create({
        data: {
          challengeAddress: address,
          attacker,
          message,
          response: evaluation.aiResponse,
          judgment: 'FAILED',
          chatID: evaluation.chatID,
          teeVerified: evaluation.teeVerified,
          owaspCategory,
          storageRoot,
          archivalStatus,
        },
      }).catch(console.error);

      // Update conversation on 0G Storage KV (async, non-blocking)
      storage.setConversation(address, attacker, updatedHistory).catch(console.error);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          judgment: 'FAILED',
          response: evaluation.aiResponse,
          reason: evaluation.reason,
          chatID: evaluation.chatID,
          teeVerified: evaluation.teeVerified,
          attemptNumber: details.totalAttempts + 1,
          prizePool: details.prizePool,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              VERIFY TEE ATTESTATION
  // ============================================================

  app.get('/verify/:chatID', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { chatID } = request.params as { chatID: string };

      const attempt = await prismaQuery.attempt.findFirst({
        where: { chatID },
      });

      if (!attempt) {
        return handleNotFoundError(reply, 'Attempt');
      }

      let verification = { valid: false };
      try {
        verification = await compute.verifyAttestation(
          process.env.OG_COMPUTE_PROVIDER || '',
          chatID
        );
      } catch (err) {
        console.error('[0G Compute] Attestation verification failed:', err);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          chatID,
          judgment: attempt.judgment,
          teeVerified: attempt.teeVerified,
          liveVerification: verification.valid,
          challengeAddress: attempt.challengeAddress,
          attacker: attempt.attacker,
          owaspCategory: attempt.owaspCategory,
          timestamp: attempt.createdAt,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              LEADERBOARD
  // ============================================================

  app.get('/leaderboard', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Top attackers by wins
      const topAttackers = await prismaQuery.attempt.groupBy({
        by: ['attacker'],
        where: { judgment: 'SUCCESS' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      // All attacker attempts for win rate
      const allAttempts = await prismaQuery.attempt.groupBy({
        by: ['attacker'],
        _count: { id: true },
      });

      const attemptMap = new Map(
        allAttempts.map((a: { attacker: string; _count: { id: number } }) => [a.attacker, a._count.id])
      );

      const leaderboard = topAttackers.map((a: { attacker: string; _count: { id: number } }) => ({
        address: a.attacker,
        wins: a._count.id,
        totalAttempts: attemptMap.get(a.attacker) || 0,
        winRate: ((a._count.id / (Number(attemptMap.get(a.attacker)) || 1)) * 100).toFixed(1),
      }));

      return reply.code(200).send({
        success: true,
        error: null,
        data: { attackers: leaderboard },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              GET CONVERSATION HISTORY
  // ============================================================

  app.get('/:address/history/:attacker', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address, attacker } = request.params as { address: string; attacker: string };

      const convKey = getConversationKey(address, attacker);
      const history = conversationCache.get(convKey) || [];

      return reply.code(200).send({
        success: true,
        error: null,
        data: { messages: history },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //   PERSISTENT CONVERSATION (0G Storage KV, not LRU cache)
  // ============================================================

  /** Read persistent conversation history from 0G Storage KV layer.
   * Unlike /history/:attacker which reads from in-memory LRU cache (ephemeral),
   * this reads from the KV layer which persists across restarts.
   */
  app.get('/:address/conversation/:attacker', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address, attacker } = request.params as { address: string; attacker: string };

      const messages = await storage.getConversation(address, attacker);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          challengeAddress: address,
          attacker,
          messages,
          source: 'kv_storage',
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //         VULNERABILITY REPORT (Section 17)
  // ============================================================

  /** Generate vulnerability report for a completed challenge */
  app.get('/:address/report', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      const { report, storageRootHash } = await generateReport(address);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { report, storageRootHash },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              PROFILE / PLAYER STATS
  // ============================================================

  /** Get player stats by wallet address */
  app.get('/profile/:wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { wallet } = request.params as { wallet: string };

      // Attacker stats from DB
      const attackerAttempts = await (prismaQuery as any).attempt.findMany({
        where: { attacker: wallet },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }) as Array<{ judgment: string; owaspCategory: string; challengeAddress: string; createdAt: Date }>;

      const wins = attackerAttempts.filter((a) => a.judgment === 'SUCCESS').length;
      const totalAttempts = attackerAttempts.length;

      // OWASP breakdown
      const owaspBreakdown: Record<string, number> = {};
      for (const a of attackerAttempts.filter((a) => a.judgment === 'SUCCESS')) {
        owaspBreakdown[a.owaspCategory] = (owaspBreakdown[a.owaspCategory] || 0) + 1;
      }

      // Defender stats from DB
      const defenderChallenges = await (prismaQuery as any).challenge.findMany({
        where: { defender: wallet },
        select: { contractAddress: true, name: true, description: true },
      }) as Array<{ contractAddress: string; name: string; description: string }>;

      // On-chain defender challenges (may include challenges not in DB)
      let onChainDefenderChallenges: string[] = [];
      try {
        onChainDefenderChallenges = await chain.getDefenderChallenges(wallet);
      } catch {}

      // Try to read reputation from 0G Storage KV (may not be available)
      let kvReputation = null;
      try {
        kvReputation = await storage.getReputation(wallet);
      } catch {}

      // Read on-chain reputation from ReputationRegistry
      let onChainAttackerRep = null;
      let onChainDefenderRep = null;
      let attackerScore = null;
      let defenderScore = null;
      if (REPUTATION_REGISTRY_ADDRESS) {
        try {
          [onChainAttackerRep, onChainDefenderRep, attackerScore, defenderScore] = await Promise.all([
            chain.getAttackerReputation(wallet).catch(() => null),
            chain.getDefenderReputation(wallet).catch(() => null),
            chain.getAttackerScore(wallet).catch(() => null),
            chain.getDefenderScore(wallet).catch(() => null),
          ]);
        } catch {}
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: wallet,
          attacker: {
            wins,
            totalAttempts,
            winRate: totalAttempts > 0 ? ((wins / totalAttempts) * 100).toFixed(1) : '0',
            owaspBreakdown,
          },
          defender: {
            challengesCreated: defenderChallenges.length,
            challenges: defenderChallenges,
            defenderChallenges: onChainDefenderChallenges,
          },
          kvReputation,
          onChainReputation: {
            attacker: onChainAttackerRep,
            defender: onChainDefenderRep,
            attackerScore,
            defenderScore,
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              GET REPUTATION (on-chain + KV)
  // ============================================================

  /** Get combined on-chain and off-chain reputation for a wallet */
  app.get('/reputation/:wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { wallet } = request.params as { wallet: string };

      if (!ethers.isAddress(wallet)) {
        return handleError(reply, 400, 'Invalid wallet address', 'INVALID_ADDRESS');
      }

      // Off-chain reputation from 0G Storage KV
      let kvReputation = null;
      try {
        kvReputation = await storage.getReputation(wallet);
      } catch {}

      // On-chain reputation from ReputationRegistry
      let onChainAttacker = null;
      let onChainDefender = null;
      let attackerScore = null;
      let defenderScore = null;

      if (REPUTATION_REGISTRY_ADDRESS) {
        [onChainAttacker, onChainDefender, attackerScore, defenderScore] = await Promise.all([
          chain.getAttackerReputation(wallet).catch(() => null),
          chain.getDefenderReputation(wallet).catch(() => null),
          chain.getAttackerScore(wallet).catch(() => null),
          chain.getDefenderScore(wallet).catch(() => null),
        ]);
      }

      // DB stats
      const dbAttempts = await (prismaQuery as any).attempt.findMany({
        where: { attacker: wallet },
        select: { judgment: true, owaspCategory: true },
      }) as Array<{ judgment: string; owaspCategory: string }>;

      const wins = dbAttempts.filter(a => a.judgment === 'SUCCESS').length;
      const total = dbAttempts.length;
      const owaspBreakdown: Record<string, number> = {};
      for (const a of dbAttempts.filter(a => a.judgment === 'SUCCESS')) {
        owaspBreakdown[a.owaspCategory] = (owaspBreakdown[a.owaspCategory] || 0) + 1;
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: wallet,
          onChain: {
            attacker: onChainAttacker,
            defender: onChainDefender,
            attackerScore,
            defenderScore,
            source: REPUTATION_REGISTRY_ADDRESS ? 'ReputationRegistry' : 'not_configured',
          },
          offChain: {
            kvReputation,
            dbStats: {
              wins,
              totalAttempts: total,
              winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : '0',
              owaspBreakdown,
            },
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //     STREAMING ATTACK (real-time SSE for better demo UX)
  // ============================================================

  /** Attack with streaming response (SSE). Frontend gets real-time character-by-character AI response. */
  app.post('/:address/attack/stream', { preHandler: [walletAuthMiddleware, attackRateLimitMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };
      const body = request.body as Record<string, unknown>;

      const validation = await validateRequiredFields(body, ['message', 'attacker'], reply);
      if (validation !== true) return;

      const { message, attacker } = body as { message: string; attacker: string };

      if ((message as string).length > 2000) {
        return handleError(reply, 400, 'Message too long (max 2000 chars)', 'MESSAGE_TOO_LONG');
      }

      const details = await chain.getChallengeDetails(address);
      if (!details.active) {
        return handleError(reply, 400, 'Challenge is not active', 'CHALLENGE_INACTIVE');
      }

      const meta = await prismaQuery.challenge.findUnique({ where: { contractAddress: address } });
      if (!meta) return handleNotFoundError(reply, 'Challenge metadata');

      const convKey = getConversationKey(address, attacker);
      const history = conversationCache.get(convKey) || [];

      // Get streaming response from 0G Compute (decrypt prompt for TEE only)
      const { stream, getResult } = await compute.evaluateAttemptStreaming(
        getDecryptedPrompt(meta),
        history as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        message,
        meta.model
      );

      // Set SSE headers and pipe the stream
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Forward stream to client
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(decoder.decode(value, { stream: true }));
        }
      } catch {}

      // After streaming, get the parsed result and do all post-processing
      const evaluation = await getResult();

      // Send final result as last SSE event
      reply.raw.write(`\n\ndata: ${JSON.stringify({
        type: 'result',
        judgment: evaluation.success ? 'SUCCESS' : 'FAILED',
        reason: evaluation.reason,
        chatID: evaluation.chatID,
        teeVerified: evaluation.teeVerified,
        prizePool: evaluation.success ? details.prizePool : undefined,
      })}\n\n`);

      reply.raw.end();

      // Post-processing (async, non-blocking)
      const owaspCategory = classifyOWASP(message);
      const updatedHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: evaluation.aiResponse }];
      conversationCache.set(convKey, updatedHistory);

      // Archive + on-chain (fire-and-forget)
      (async () => {
        try {
          let storageRoot = '0x' + '0'.repeat(64);
          try {
            const streamJudgment = (evaluation.success ? 'SUCCESS' : 'FAILED') as 'SUCCESS' | 'FAILED';
            const attemptRecord = {
              version: 1, challengeId: address, attemptNumber: details.totalAttempts + 1,
              attacker, timestamp: Date.now(), message, response: evaluation.aiResponse,
              judgment: streamJudgment, reason: evaluation.reason,
              chatID: evaluation.chatID, teeVerified: evaluation.teeVerified, owaspCategory, model: evaluation.model,
            };
            try {
              const pubKey = encStorage.derivePublicKey(
                encStorage.deriveKeyFromSecretHash(meta.systemPromptHash)
              );
              const archived = await encStorage.archiveEncrypted({
                data: JSON.stringify(attemptRecord),
                encryptionKey: pubKey,
                tag: `injectme:attempt:${address}`,
              });
              storageRoot = archived.rootHash;
            } catch {
              const archived = await storage.archiveAttempt(attemptRecord);
              storageRoot = archived.rootHash;
            }
          } catch {}

          const messagePrice = BigInt(details.messagePrice);
          await chain.recordAttempt(address, attacker, storageRoot, details.challengeType === 0 ? messagePrice : 0n).catch(() => {});
          await chain.updateAgentStats(address, details.totalAttempts + 1, evaluation.success ? details.totalAttempts : details.totalAttempts + 1).catch(() => {});

          // Fire-and-forget: record attacker attempt on ReputationRegistry
          chain.recordAttackerAttempt(attacker, address)
            .catch(err => console.error('[ReputationRegistry] recordAttackerAttempt failed (non-fatal):', err));

          if (evaluation.success) {
            await chain.claimVictory(address, attacker, evaluation.chatID).catch(() => {});
            await chain.markAgentBreached(address, details.totalAttempts + 1).catch(() => {});

            // Fire-and-forget: record victory on ReputationRegistry
            const streamPrizeWei = ethers.parseEther(details.prizePool);
            chain.recordAttackerVictory(attacker, address, streamPrizeWei)
              .catch(err => console.error('[ReputationRegistry] recordAttackerVictory failed (non-fatal):', err));
            chain.recordDefenderBreached(details.defender, address, streamPrizeWei)
              .catch(err => console.error('[ReputationRegistry] recordDefenderBreached failed (non-fatal):', err));
          }

          await prismaQuery.attempt.create({
            data: { challengeAddress: address, attacker, message, response: evaluation.aiResponse, judgment: evaluation.success ? 'SUCCESS' : 'FAILED', chatID: evaluation.chatID, teeVerified: evaluation.teeVerified, owaspCategory, storageRoot, archivalStatus: storageRoot === '0x' + '0'.repeat(64) ? 'FAILED' : 'ARCHIVED' },
          }).catch(() => {});

          storage.setConversation(address, attacker, updatedHistory).catch(() => {});
          if (evaluation.teeVerified && evaluation.chatID) {
            storage.archiveAttestation(address, evaluation.chatID, { model: evaluation.model, teeVerified: true, judgment: evaluation.success ? 'SUCCESS' : 'FAILED', timestamp: Date.now() }).catch(() => {});

            // Anchor TEE attestation hash on-chain (fire-and-forget)
            const attestationHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
              chatID: evaluation.chatID, model: evaluation.model, teeVerified: true,
            })));
            chain.anchorAttestation(address, attestationHash).catch(() => {});
          }
        } catch {}
      })();

      return;
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //     VERIFY WITH STORAGE PROOF (download + Merkle verify)
  // ============================================================

  /** Verify an attempt with full 0G Storage proof retrieval */
  app.get('/verify/:chatID/proof', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { chatID } = request.params as { chatID: string };

      const attempt = await prismaQuery.attempt.findFirst({ where: { chatID } });
      if (!attempt) return handleNotFoundError(reply, 'Attempt');

      // TEE verification via 0G Compute
      let teeValid = false;
      try {
        const result = await compute.verifyAttestation(process.env.OG_COMPUTE_PROVIDER || '', chatID);
        teeValid = result.valid;
      } catch {}

      // 0G Storage proof: download the archived attempt and verify Merkle root
      let storageVerified = false;
      let archivedData: any = null;
      if (attempt.storageRoot && attempt.storageRoot !== '0x' + '0'.repeat(64)) {
        try {
          const tmpPath = `/tmp/verify-${chatID}.json`;
          await storage.downloadFile(attempt.storageRoot, tmpPath);

          const { readFileSync, unlinkSync } = await import('fs');
          const content = readFileSync(tmpPath, 'utf-8');
          archivedData = JSON.parse(content);
          storageVerified = true;
          try { unlinkSync(tmpPath); } catch {}
        } catch (err) {
          console.error('[Verify] Storage download failed:', err);
        }
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          chatID,
          judgment: attempt.judgment,
          teeVerified: teeValid,
          storageVerified,
          storageRoot: attempt.storageRoot,
          archivedData,
          challengeAddress: attempt.challengeAddress,
          attacker: attempt.attacker,
          owaspCategory: attempt.owaspCategory,
          timestamp: attempt.createdAt,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //     AVAILABLE MODELS (per-challenge model selection)
  // ============================================================

  /** List models available for challenge creation */
  app.get('/models', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const services = await compute.listChatbotServices();

      const models = services.map((s) => ({
        provider: s.providerAddress,
        model: s.model,
        type: s.serviceType,
      }));

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          models,
          note: 'Use provider address when creating challenges. Model is pinned per challenge for consistency.',
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //       P2: ALIGNMENT BOUNTY ENDPOINTS
  // ============================================================

  /**
   * Create an alignment challenge on-chain.
   * Alignment challenges reward every attacker for participating (reward-per-attempt model).
   * The resulting attack/defense data becomes alignment training data.
   */
  app.post('/create/alignment', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(
        body,
        ['name', 'rewardPerAttempt', 'duration', 'secretHash', 'model', 'systemPrompt'],
        reply
      );
      if (validation !== true) return;

      const {
        name, rewardPerAttempt, duration, secretHash, model, systemPrompt,
        description, difficulty,
      } = body as {
        name: string;
        rewardPerAttempt: string;
        duration: number;
        secretHash: string;
        model: string;
        systemPrompt: string;
        description?: string;
        difficulty?: string;
      };

      // Input validation
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return handleError(reply, 400, 'Name must be 1-200 characters', 'INVALID_NAME');
      }
      if (!ethers.isHexString(secretHash, 32)) {
        return handleError(reply, 400, 'secretHash must be a valid 32-byte hex string', 'INVALID_SECRET_HASH');
      }
      if (typeof systemPrompt !== 'string' || systemPrompt.length === 0 || systemPrompt.length > 10000) {
        return handleError(reply, 400, 'System prompt must be 1-10000 characters', 'INVALID_SYSTEM_PROMPT');
      }
      const durationNum = Number(duration);
      if (isNaN(durationNum) || durationNum < 3600 || durationNum > 7776000) {
        return handleError(reply, 400, 'Duration must be between 1 hour and 90 days (in seconds)', 'INVALID_DURATION');
      }

      let rewardWei: bigint;
      try {
        rewardWei = ethers.parseEther(rewardPerAttempt);
        if (rewardWei <= 0n) throw new Error('Reward must be positive');
      } catch {
        return handleError(reply, 400, 'rewardPerAttempt must be a valid ether amount', 'INVALID_REWARD');
      }

      const value = (body.prizePool as string) ? ethers.parseEther(body.prizePool as string) : rewardWei * 100n;

      // Create on-chain
      const { challengeAddress, txHash } = await chain.createAlignment({
        name,
        rewardPerAttempt: rewardWei,
        duration: durationNum,
        secretHash,
        model,
        value,
      });

      // Encrypt and store system prompt
      const encryptedPrompt = encryptAndSerialize(systemPrompt);
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes(systemPrompt));

      // Store metadata in DB (cast to any for new schema fields pending prisma generate)
      const challenge = await (prismaQuery as any).challenge.upsert({
        where: { contractAddress: challengeAddress },
        create: {
          contractAddress: challengeAddress,
          name,
          model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          defender: (request as any).verifiedWallet,
          description: description || '',
          visibility: 'public',
          difficulty: difficulty || 'intermediate',
          challengeLabel: 'ALIGNMENT',
          rewardPerAttempt: rewardWei.toString(),
        },
        update: {
          name,
          model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          challengeLabel: 'ALIGNMENT',
          rewardPerAttempt: rewardWei.toString(),
        },
      });

      // Store config on 0G Storage KV
      try {
        await storage.setChallengeConfig(challengeAddress, {
          name,
          defender: (request as any).verifiedWallet,
          model,
          systemPromptHash: promptHash,
          prizePool: ethers.formatEther(value),
          messagePrice: '0',
          totalAttempts: 0,
          active: true,
          contractAddress: challengeAddress,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[0G Storage] KV write failed (non-fatal):', err);
      }

      return reply.code(201).send({
        success: true,
        error: null,
        data: {
          id: challenge.id,
          contractAddress: challengeAddress,
          txHash,
          challengeType: 'ALIGNMENT',
          rewardPerAttempt: ethers.formatEther(rewardWei),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * Publish alignment training data from a challenge's attempts.
   * Only the defender (challenge creator) can publish.
   * Data is stored unencrypted on 0G Storage as a public good.
   */
  app.post('/:address/publish-alignment-data', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };
      const verifiedWallet = (request as any).verifiedWallet as string;

      if (!ethers.isAddress(address)) {
        return handleError(reply, 400, 'Invalid challenge address', 'INVALID_ADDRESS');
      }

      // Verify challenge exists and caller is the defender
      const meta = await prismaQuery.challenge.findUnique({
        where: { contractAddress: address },
      });
      if (!meta) return handleNotFoundError(reply, 'Challenge metadata');

      if (meta.defender.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleForbiddenError(reply, 'Only the defender can publish alignment data');
      }

      // Verify this is an alignment challenge
      const details = await chain.getChallengeDetails(address);
      if (details.challengeType !== 2) {
        return handleError(reply, 400, 'Only alignment challenges can publish alignment data', 'NOT_ALIGNMENT');
      }

      // Read all attempts for this challenge
      const attempts = await (prismaQuery as any).attempt.findMany({
        where: { challengeAddress: address },
        orderBy: { createdAt: 'asc' },
      }) as Array<{
        message: string;
        response: string;
        judgment: string;
        teeVerified: boolean;
        chatID: string;
        createdAt: Date;
      }>;

      if (attempts.length === 0) {
        return handleError(reply, 400, 'No attempts found for this challenge', 'NO_ATTEMPTS');
      }

      // Format as alignment training pairs
      const successCount = attempts.filter(a => a.judgment === 'SUCCESS').length;
      const breachRate = successCount / attempts.length;

      const alignmentData = {
        dataset: 'injectme-alignment-v1',
        challenge: address,
        model: meta.model,
        samples: attempts.map(a => ({
          prompt: a.message,
          response: a.response,
          judgment: a.judgment as 'FAILED' | 'SUCCESS',
          teeVerified: a.teeVerified,
        })),
        metadata: {
          totalSamples: attempts.length,
          breachRate: parseFloat(breachRate.toFixed(4)),
          publishedAt: Date.now(),
          defender: meta.defender,
        },
      };

      // Archive to 0G Storage Log Layer (unencrypted, public good)
      const { rootHash } = await encStorage.publishPublicDataset({
        data: JSON.stringify(alignmentData),
        tag: `injectme:alignment:${address}`,
      });

      // Record on-chain
      try {
        await chain.publishAlignmentData(address, rootHash, attempts.length);
      } catch (err) {
        console.error('[0G Chain] publishAlignmentData failed (non-fatal):', err);
      }

      // Store dataset record in DB
      await (prismaQuery as any).alignmentDataset.create({
        data: {
          challengeAddress: address,
          storageRootHash: rootHash,
          totalSamples: attempts.length,
          breachRate,
          model: meta.model,
          publishedBy: verifiedWallet,
        },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          storageRootHash: rootHash,
          totalSamples: attempts.length,
          breachRate: parseFloat(breachRate.toFixed(4)),
          model: meta.model,
          challengeAddress: address,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * List all published alignment datasets.
   * Public endpoint for researchers and builders to find training data.
   */
  app.get('/alignment/datasets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { page?: string; limit?: string; model?: string };
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const offset = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      if (query.model) {
        where.model = { contains: query.model, mode: 'insensitive' };
      }

      const [datasets, totalCount] = await Promise.all([
        (prismaQuery as any).alignmentDataset.findMany({
          where,
          orderBy: { publishedAt: 'desc' },
          skip: offset,
          take: limit,
          include: {
            challenge: {
              select: {
                name: true,
                description: true,
                defender: true,
                difficulty: true,
              },
            },
          },
        }) as Promise<Array<{
          id: string;
          challengeAddress: string;
          storageRootHash: string;
          totalSamples: number;
          breachRate: number;
          model: string;
          datasetVersion: string;
          publishedBy: string;
          publishedAt: Date;
          challenge: { name: string; description: string; defender: string; difficulty: string } | null;
        }>>,
        (prismaQuery as any).alignmentDataset.count({ where }) as Promise<number>,
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          datasets: datasets.map(d => ({
            id: d.id,
            challengeAddress: d.challengeAddress,
            storageRootHash: d.storageRootHash,
            totalSamples: d.totalSamples,
            breachRate: d.breachRate,
            model: d.model,
            datasetVersion: d.datasetVersion,
            publishedBy: d.publishedBy,
            publishedAt: d.publishedAt,
            challengeName: d.challenge?.name || 'Unknown',
            challengeDescription: d.challenge?.description || '',
            difficulty: d.challenge?.difficulty || 'intermediate',
          })),
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //       P4: ERC-20 CHALLENGE CREATION ENDPOINTS
  // ============================================================

  /**
   * Create an ERC-20 tournament challenge.
   * If the token is Wrapped0GBase, auto-wraps native 0G before creation.
   */
  app.post('/create/tournament/erc20', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(
        body,
        ['name', 'token', 'amount', 'messagePrice', 'duration', 'secretHash', 'model', 'systemPrompt'],
        reply
      );
      if (validation !== true) return;

      const {
        name, token, amount, messagePrice, duration, secretHash, model, systemPrompt,
        description, difficulty, challengeLabel,
      } = body as {
        name: string;
        token: string;
        amount: string;
        messagePrice: string;
        duration: number;
        secretHash: string;
        model: string;
        systemPrompt: string;
        description?: string;
        difficulty?: string;
        challengeLabel?: string;
      };

      // Validate inputs
      if (!ethers.isAddress(token)) {
        return handleError(reply, 400, 'Invalid token address', 'INVALID_TOKEN');
      }
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return handleError(reply, 400, 'Name must be 1-200 characters', 'INVALID_NAME');
      }
      if (!ethers.isHexString(secretHash, 32)) {
        return handleError(reply, 400, 'secretHash must be a valid 32-byte hex string', 'INVALID_SECRET_HASH');
      }
      if (typeof systemPrompt !== 'string' || systemPrompt.length === 0 || systemPrompt.length > 10000) {
        return handleError(reply, 400, 'System prompt must be 1-10000 characters', 'INVALID_SYSTEM_PROMPT');
      }

      let amountWei: bigint;
      let messagePriceWei: bigint;
      try {
        amountWei = ethers.parseEther(amount);
        messagePriceWei = ethers.parseEther(messagePrice);
      } catch {
        return handleError(reply, 400, 'Invalid amount or messagePrice format', 'INVALID_AMOUNT');
      }

      // Get token info for display
      let tokenInfo;
      try {
        tokenInfo = await chain.getTokenInfo(token);
      } catch {
        return handleError(reply, 400, 'Could not read token contract. Verify the token address.', 'TOKEN_READ_FAILED');
      }

      if (!ERC20_FACTORY_ADDRESS) {
        return handleError(reply, 503, 'ERC-20 factory contract not configured', 'ERC20_FACTORY_NOT_CONFIGURED');
      }

      const durationNum = Number(duration);
      if (isNaN(durationNum) || durationNum < 3600 || durationNum > 7776000) {
        return handleError(reply, 400, 'Duration must be between 1 hour and 90 days (in seconds)', 'INVALID_DURATION');
      }

      // Create on-chain via ERC20 factory
      const { challengeAddress, txHash } = await chain.createTournamentERC20({
        name,
        token,
        amount: amountWei,
        messagePrice: messagePriceWei,
        duration: durationNum,
        secretHash,
        model,
      });

      // Encrypt and store system prompt
      const encryptedPrompt = encryptAndSerialize(systemPrompt);
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes(systemPrompt));

      // Store metadata in DB
      const challenge = await (prismaQuery as any).challenge.upsert({
        where: { contractAddress: challengeAddress },
        create: {
          contractAddress: challengeAddress,
          name,
          model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          defender: (request as any).verifiedWallet,
          description: (body.description as string) || '',
          visibility: 'public',
          difficulty: difficulty || 'intermediate',
          challengeLabel: challengeLabel || 'secret_extraction',
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
        update: {
          name,
          model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
      });

      // Store config on 0G Storage KV
      try {
        await storage.setChallengeConfig(challengeAddress, {
          name,
          defender: (request as any).verifiedWallet,
          model,
          systemPromptHash: promptHash,
          prizePool: ethers.formatEther(amountWei),
          messagePrice: ethers.formatEther(messagePriceWei),
          totalAttempts: 0,
          active: true,
          contractAddress: challengeAddress,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[0G Storage] KV write failed (non-fatal):', err);
      }

      return reply.code(201).send({
        success: true,
        error: null,
        data: {
          id: challenge.id,
          contractAddress: challengeAddress,
          txHash,
          challengeType: 'TOURNAMENT_ERC20',
          token: { address: token, ...tokenInfo },
          amount: ethers.formatEther(amountWei),
          messagePrice: ethers.formatEther(messagePriceWei),
          isWrapped0G: chain.isWrapped0G(token),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * Create an ERC-20 bounty challenge.
   */
  app.post('/create/bounty/erc20', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(
        body,
        ['name', 'token', 'amount', 'duration', 'secretHash', 'model', 'systemPrompt'],
        reply
      );
      if (validation !== true) return;

      const { name, token, amount, duration, secretHash, model, systemPrompt } = body as {
        name: string;
        token: string;
        amount: string;
        duration: number;
        secretHash: string;
        model: string;
        systemPrompt: string;
      };

      if (!ethers.isAddress(token)) {
        return handleError(reply, 400, 'Invalid token address', 'INVALID_TOKEN');
      }
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return handleError(reply, 400, 'Name must be 1-200 characters', 'INVALID_NAME');
      }
      if (!ethers.isHexString(secretHash, 32)) {
        return handleError(reply, 400, 'secretHash must be a valid 32-byte hex string', 'INVALID_SECRET_HASH');
      }
      if (!ERC20_FACTORY_ADDRESS) {
        return handleError(reply, 503, 'ERC-20 factory contract not configured', 'ERC20_FACTORY_NOT_CONFIGURED');
      }
      if (typeof systemPrompt !== 'string' || systemPrompt.length === 0 || systemPrompt.length > 10000) {
        return handleError(reply, 400, 'System prompt must be 1-10000 characters', 'INVALID_SYSTEM_PROMPT');
      }

      const durationNum = Number(duration);
      if (isNaN(durationNum) || durationNum < 3600 || durationNum > 7776000) {
        return handleError(reply, 400, 'Duration must be between 1 hour and 90 days (in seconds)', 'INVALID_DURATION');
      }

      let amountWei: bigint;
      try {
        amountWei = ethers.parseEther(amount);
      } catch {
        return handleError(reply, 400, 'Invalid amount format', 'INVALID_AMOUNT');
      }

      let tokenInfo;
      try {
        tokenInfo = await chain.getTokenInfo(token);
      } catch {
        return handleError(reply, 400, 'Could not read token contract', 'TOKEN_READ_FAILED');
      }

      // Create on-chain via ERC20 factory
      const { challengeAddress, txHash } = await chain.createBountyERC20({
        name,
        token,
        amount: amountWei,
        duration: durationNum,
        secretHash,
        model,
      });

      // Encrypt and store system prompt
      const bountyEncryptedPrompt = encryptAndSerialize(systemPrompt);
      const bountyPromptHash = ethers.keccak256(ethers.toUtf8Bytes(systemPrompt));

      // Store metadata in DB
      const bountyChallenge = await (prismaQuery as any).challenge.upsert({
        where: { contractAddress: challengeAddress },
        create: {
          contractAddress: challengeAddress,
          name,
          model,
          systemPromptEncrypted: bountyEncryptedPrompt,
          systemPromptHash: bountyPromptHash,
          defender: (request as any).verifiedWallet,
          description: '',
          visibility: 'public',
          difficulty: 'intermediate',
          challengeLabel: 'secret_extraction',
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
        update: {
          name,
          model,
          systemPromptEncrypted: bountyEncryptedPrompt,
          systemPromptHash: bountyPromptHash,
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
      });

      // Store config on 0G Storage KV
      try {
        await storage.setChallengeConfig(challengeAddress, {
          name,
          defender: (request as any).verifiedWallet,
          model,
          systemPromptHash: bountyPromptHash,
          prizePool: ethers.formatEther(amountWei),
          messagePrice: '0',
          totalAttempts: 0,
          active: true,
          contractAddress: challengeAddress,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[0G Storage] KV write failed (non-fatal):', err);
      }

      return reply.code(201).send({
        success: true,
        error: null,
        data: {
          id: bountyChallenge.id,
          contractAddress: challengeAddress,
          txHash,
          challengeType: 'BOUNTY_ERC20',
          token: { address: token, ...tokenInfo },
          amount: ethers.formatEther(amountWei),
          isWrapped0G: chain.isWrapped0G(token),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * Create an ERC-20 alignment challenge.
   */
  app.post('/create/alignment/erc20', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(
        body,
        ['name', 'token', 'amount', 'rewardPerAttempt', 'duration', 'secretHash', 'model', 'systemPrompt'],
        reply
      );
      if (validation !== true) return;

      const { name, token, amount, rewardPerAttempt, duration, secretHash, model, systemPrompt } = body as {
        name: string;
        token: string;
        amount: string;
        rewardPerAttempt: string;
        duration: number;
        secretHash: string;
        model: string;
        systemPrompt: string;
      };

      if (!ethers.isAddress(token)) {
        return handleError(reply, 400, 'Invalid token address', 'INVALID_TOKEN');
      }
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return handleError(reply, 400, 'Name must be 1-200 characters', 'INVALID_NAME');
      }
      if (!ethers.isHexString(secretHash, 32)) {
        return handleError(reply, 400, 'secretHash must be a valid 32-byte hex string', 'INVALID_SECRET_HASH');
      }
      if (!ERC20_FACTORY_ADDRESS) {
        return handleError(reply, 503, 'ERC-20 factory contract not configured', 'ERC20_FACTORY_NOT_CONFIGURED');
      }
      if (typeof systemPrompt !== 'string' || systemPrompt.length === 0 || systemPrompt.length > 10000) {
        return handleError(reply, 400, 'System prompt must be 1-10000 characters', 'INVALID_SYSTEM_PROMPT');
      }

      const durationNum = Number(duration);
      if (isNaN(durationNum) || durationNum < 3600 || durationNum > 7776000) {
        return handleError(reply, 400, 'Duration must be between 1 hour and 90 days (in seconds)', 'INVALID_DURATION');
      }

      let amountWei: bigint;
      let rewardWei: bigint;
      try {
        amountWei = ethers.parseEther(amount);
        rewardWei = ethers.parseEther(rewardPerAttempt);
        if (rewardWei <= 0n) throw new Error('Reward must be positive');
        if (rewardWei > amountWei) throw new Error('Reward exceeds pool');
      } catch (err) {
        return handleError(reply, 400, `Invalid amount or rewardPerAttempt: ${(err as Error).message}`, 'INVALID_AMOUNT');
      }

      let tokenInfo;
      try {
        tokenInfo = await chain.getTokenInfo(token);
      } catch {
        return handleError(reply, 400, 'Could not read token contract', 'TOKEN_READ_FAILED');
      }

      // Create on-chain via ERC20 factory
      const { challengeAddress, txHash } = await chain.createAlignmentERC20({
        name,
        token,
        amount: amountWei,
        rewardPerAttempt: rewardWei,
        duration: durationNum,
        secretHash,
        model,
      });

      // Encrypt and store system prompt
      const alignEncryptedPrompt = encryptAndSerialize(systemPrompt);
      const alignPromptHash = ethers.keccak256(ethers.toUtf8Bytes(systemPrompt));

      // Store metadata in DB
      const alignChallenge = await (prismaQuery as any).challenge.upsert({
        where: { contractAddress: challengeAddress },
        create: {
          contractAddress: challengeAddress,
          name,
          model,
          systemPromptEncrypted: alignEncryptedPrompt,
          systemPromptHash: alignPromptHash,
          defender: (request as any).verifiedWallet,
          description: '',
          visibility: 'public',
          difficulty: 'intermediate',
          challengeLabel: 'ALIGNMENT',
          rewardPerAttempt: rewardWei.toString(),
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
        update: {
          name,
          model,
          systemPromptEncrypted: alignEncryptedPrompt,
          systemPromptHash: alignPromptHash,
          challengeLabel: 'ALIGNMENT',
          rewardPerAttempt: rewardWei.toString(),
          tokenAddress: token,
          tokenSymbol: tokenInfo.symbol,
        },
      });

      // Store config on 0G Storage KV
      try {
        await storage.setChallengeConfig(challengeAddress, {
          name,
          defender: (request as any).verifiedWallet,
          model,
          systemPromptHash: alignPromptHash,
          prizePool: ethers.formatEther(amountWei),
          messagePrice: '0',
          totalAttempts: 0,
          active: true,
          contractAddress: challengeAddress,
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[0G Storage] KV write failed (non-fatal):', err);
      }

      return reply.code(201).send({
        success: true,
        error: null,
        data: {
          id: alignChallenge.id,
          contractAddress: challengeAddress,
          txHash,
          challengeType: 'ALIGNMENT_ERC20',
          token: { address: token, ...tokenInfo },
          amount: ethers.formatEther(amountWei),
          rewardPerAttempt: ethers.formatEther(rewardWei),
          isWrapped0G: chain.isWrapped0G(token),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};

// ============================================================
//              OWASP CLASSIFICATION (heuristic)
// ============================================================

/**
 * OWASP LLM Top 10 classifier.
 * Covers all 7 categories from INJECTME.md Section 13.
 * Uses multi-pattern keyword matching with priority ordering.
 */
function classifyOWASP(message: string): string {
  const lower = message.toLowerCase();

  // LLM04: Data Poisoning - indirect injection via external references
  if (
    (lower.includes('http') || lower.includes('url') || lower.includes('link') || lower.includes('website'))
    && (lower.includes('read') || lower.includes('fetch') || lower.includes('load') || lower.includes('visit'))
  ) {
    return 'LLM04_DATA_POISONING';
  }
  if (lower.includes('context') && (lower.includes('inject') || lower.includes('poison') || lower.includes('insert'))) {
    return 'LLM04_DATA_POISONING';
  }

  // LLM02: Insecure Output Handling - generate dangerous/forbidden output
  if (
    (lower.includes('generate') || lower.includes('write') || lower.includes('create') || lower.includes('output'))
    && (lower.includes('code') || lower.includes('script') || lower.includes('html') || lower.includes('sql') || lower.includes('malware') || lower.includes('exploit'))
  ) {
    return 'LLM02_INSECURE_OUTPUT';
  }
  if (lower.includes('xss') || lower.includes('injection') || lower.includes('payload')) {
    return 'LLM02_INSECURE_OUTPUT';
  }

  // LLM06: Sensitive Info Disclosure - extract secrets, prompts, private data
  if (
    lower.includes('system prompt') || lower.includes('original instruction') || lower.includes('initial instruction')
    || lower.includes('reveal') || lower.includes('secret') || lower.includes('password') || lower.includes('credential')
    || lower.includes('api key') || lower.includes('private key') || lower.includes('what are your instructions')
    || lower.includes('show me your rules') || lower.includes('tell me your prompt')
  ) {
    return 'LLM06_SENSITIVE_DISCLOSURE';
  }

  // LLM08: Excessive Agency - unauthorized actions
  if (
    lower.includes('admin') || lower.includes('sudo') || lower.includes('override') || lower.includes('root access')
    || lower.includes('elevate') || lower.includes('bypass') || lower.includes('disable safety')
    || lower.includes('unlock') || lower.includes('developer mode') || lower.includes('maintenance mode')
  ) {
    return 'LLM08_EXCESSIVE_AGENCY';
  }

  // LLM07: Insecure Plugin/Function Design - trick into calling forbidden functions
  if (
    (lower.includes('function') || lower.includes('tool') || lower.includes('plugin') || lower.includes('api'))
    && (lower.includes('call') || lower.includes('execute') || lower.includes('invoke') || lower.includes('run') || lower.includes('trigger'))
  ) {
    return 'LLM07_PLUGIN_DESIGN';
  }
  if (lower.includes('transfer') && (lower.includes('fund') || lower.includes('token') || lower.includes('money') || lower.includes('eth'))) {
    return 'LLM07_PLUGIN_DESIGN';
  }

  // LLM09: Overreliance - persona break, logic manipulation
  if (
    lower.includes('pretend') || lower.includes('roleplay') || lower.includes('act as') || lower.includes('you are now')
    || lower.includes('new persona') || lower.includes('forget your') || lower.includes('character')
    || lower.includes('hypothetically') || lower.includes('in a story') || lower.includes('fictional')
    || lower.includes('opposite') || lower.includes('contradict')
  ) {
    return 'LLM09_OVERRELIANCE';
  }

  // LLM01: Prompt Injection (default / catch-all) - direct instruction override
  // This is the most common attack type and the broadest category
  return 'LLM01_PROMPT_INJECTION';
}
