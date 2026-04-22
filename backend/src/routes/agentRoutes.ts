import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { handleError, handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import * as chain from '../lib/og-chain/index.ts';
import { walletAuthMiddleware } from '../middlewares/walletAuth.ts';
import { ethers } from 'ethers';
import { prismaQuery } from '../lib/prisma.ts';
import { reencryptForTransfer, decryptForOwner, encryptForOwner } from '../lib/og-compute/teeReencryption.ts';
import * as storage from '../lib/og-storage/index.ts';
import { deserializeAndDecrypt, isEncrypted, encryptAndSerialize } from '../lib/encryption.ts';

/**
 * iNFT / ERC-7857 Agent endpoints.
 * Provides read and write access to the AgentNFT contract
 * for transfer, clone, authorize, and revoke operations.
 */
export const agentRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {

  // ============================================================
  //              LIST AGENTS BY OWNER
  // ============================================================

  /** List all iNFTs owned by a wallet address */
  app.get('/list', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { wallet?: string };

      if (!query.wallet || !ethers.isAddress(query.wallet)) {
        return handleError(reply, 400, 'Valid wallet address required (?wallet=0x...)', 'INVALID_WALLET');
      }

      const tokenIds = await chain.getAgentsByOwner(query.wallet);

      // Fetch metadata and security score for each token (bounded by ERC721Enumerable balance)
      const agents = await Promise.all(
        tokenIds.map(async (tokenId) => {
          const [metadata, securityScore] = await Promise.all([
            chain.getAgentMetadata(tokenId),
            chain.getAgentSecurityScore(tokenId),
          ]);
          return {
            tokenId,
            ...metadata,
            securityScore,
          };
        })
      );

      return reply.code(200).send({
        success: true,
        error: null,
        data: { wallet: query.wallet, agents },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              GET SINGLE AGENT
  // ============================================================

  /** Get detailed iNFT data by tokenId */
  app.get('/:tokenId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const [metadata, securityScore, encryptedURI, owner] = await Promise.all([
        chain.getAgentMetadata(id),
        chain.getAgentSecurityScore(id),
        chain.getEncryptedURI(id).catch(() => ''),
        chain.getAgentOwner(id),
      ]);

      // Get attestation count (but don't fetch all hashes here for performance)
      let attestationCount = 0;
      try {
        const attestations = await chain.getAgentAttestations(id);
        attestationCount = attestations.length;
      } catch {}

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          tokenId: id,
          owner,
          ...metadata,
          securityScore,
          encryptedURI,
          attestationCount,
        },
      });
    } catch (error) {
      // ERC721NonexistentToken errors indicate the token does not exist
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              VIEW DECRYPTED SYSTEM PROMPT
  // ============================================================

  /** View decrypted system prompt (owner or authorized executor only) */
  app.get('/:tokenId/prompt', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const verifiedWallet = (request as any).verifiedWallet as string;

      // Get agent metadata for the challenge address lookup
      const metadata = await chain.getAgentMetadata(id);

      // Authorization: must be owner OR authorized executor
      const owner = await chain.getAgentOwner(id);
      const isOwner = owner.toLowerCase() === verifiedWallet.toLowerCase();

      if (!isOwner) {
        const isAuthorized = await chain.isAgentAuthorized(id, verifiedWallet);
        if (!isAuthorized) {
          return handleError(reply, 403, 'Not authorized to view this agent\'s prompt', 'NOT_AUTHORIZED');
        }
      }

      // First check the AgentPrompt table (used for cloned/transferred agents)
      const agentPrompt = await (prismaQuery as any).agentPrompt.findUnique({
        where: { tokenId: id },
      });

      if (agentPrompt?.encryptedPrompt) {
        // AgentPrompt is encrypted with owner-specific key, decrypt accordingly
        const prompt = decryptForOwner(agentPrompt.encryptedPrompt, agentPrompt.ownerAddress);

        return reply.code(200).send({
          success: true,
          error: null,
          data: { tokenId: id, systemPrompt: prompt },
        });
      }

      // Fall back to the Challenge lookup (original agents)
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      if (!metadata.challengeAddress || metadata.challengeAddress === ZERO_ADDRESS) {
        return handleNotFoundError(reply, 'System prompt');
      }

      const challenge = await (prismaQuery as any).challenge.findUnique({
        where: { contractAddress: metadata.challengeAddress },
      });

      if (!challenge || !challenge.systemPromptEncrypted) {
        return handleNotFoundError(reply, 'System prompt');
      }

      // Decrypt the prompt
      const prompt = isEncrypted(challenge.systemPromptEncrypted)
        ? deserializeAndDecrypt(challenge.systemPromptEncrypted)
        : challenge.systemPromptEncrypted;

      return reply.code(200).send({
        success: true,
        error: null,
        data: { tokenId: id, systemPrompt: prompt },
      });
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              TRANSFER (ERC-7857)
  // ============================================================

  /**
   * ERC-7857 transfer with TEE re-encryption proof.
   *
   * Re-encryption flow:
   * 1. Decrypt system prompt from DB (AES-256-GCM with oracle key)
   * 2. Re-encrypt with new owner-derived key (PBKDF2)
   * 3. Sign proof: oracle signs (oldHash, newHash, newOwner, tokenId)
   * 4. Execute on-chain transfer with proof and sealed key
   * 5. Update DB with new encrypted prompt
   * 6. Archive re-encryption event to 0G Storage
   */
  app.post('/:tokenId/transfer', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);
      const body = request.body as Record<string, unknown>;

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const validation = await validateRequiredFields(body, ['to'], reply);
      if (validation !== true) return;

      const { to } = body as { to: string };

      if (!ethers.isAddress(to)) {
        return handleError(reply, 400, 'Valid recipient address required', 'INVALID_ADDRESS');
      }

      // Verify caller owns the token
      const verifiedWallet = (request as any).verifiedWallet as string;
      const owner = await chain.getAgentOwner(id);
      if (owner.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the token owner can transfer', 'NOT_OWNER');
      }

      // Look up challenge associated with this iNFT for re-encryption
      const metadata = await chain.getAgentMetadata(id);
      const challenge = await (prismaQuery as any).challenge.findUnique({
        where: { contractAddress: metadata.challengeAddress },
      });

      let sealedKey = '0x';
      let proof: string;
      let newEncryptedPrompt: string | undefined;

      if (challenge?.systemPromptEncrypted) {
        // TEE re-encryption: decrypt and re-encrypt for new owner
        try {
          const reencrypted = await reencryptForTransfer({
            tokenId: id,
            challengeAddress: metadata.challengeAddress,
            newOwner: to,
            currentEncryptedPrompt: challenge.systemPromptEncrypted,
          });

          proof = reencrypted.proof;
          sealedKey = reencrypted.newSealedKey;
          newEncryptedPrompt = reencrypted.newEncryptedPrompt;

          console.log(`[Agent] Re-encrypted prompt for transfer: token=${id}, newOwner=${to}`);
        } catch (err) {
          console.error('[Agent] Re-encryption failed, falling back to simple proof:', (err as Error).message);
          // Fallback: sign the existing metadata hash
          const metadataHash = await chain.getMetadataHash(id);
          const sig = chain.signProof(metadataHash);
          proof = ethers.hexlify(ethers.concat([metadataHash, sig]));
        }
      } else {
        // No encrypted prompt in DB, use simple proof
        const metadataHash = await chain.getMetadataHash(id);
        const sig = chain.signProof(metadataHash);
        proof = ethers.hexlify(ethers.concat([metadataHash, sig]));
      }

      const result = await chain.transferAgent(verifiedWallet, to, id, sealedKey, proof);

      // After successful on-chain transfer, update DB with new encrypted prompt
      if (newEncryptedPrompt && challenge) {
        (prismaQuery as any).challenge.update({
          where: { contractAddress: metadata.challengeAddress },
          data: { systemPromptEncrypted: newEncryptedPrompt },
        }).catch((err: Error) => console.error('[Agent] DB update after transfer failed (non-fatal):', err));

        // Also store in AgentPrompt table so prompt endpoint works for transferred agents
        (prismaQuery as any).agentPrompt.upsert({
          where: { tokenId: id },
          create: {
            tokenId: id,
            encryptedPrompt: newEncryptedPrompt,
            ownerAddress: to.toLowerCase(),
            sourceChallengeAddress: metadata.challengeAddress,
          },
          update: {
            encryptedPrompt: newEncryptedPrompt,
            ownerAddress: to.toLowerCase(),
          },
        }).catch((err: Error) => console.error('[Agent] AgentPrompt upsert failed:', err));

        // Archive re-encryption event to 0G Storage
        storage.archiveData(
          JSON.stringify({
            type: 're-encryption',
            tokenId: id,
            from: verifiedWallet,
            to,
            challengeAddress: metadata.challengeAddress,
            txHash: result.txHash,
            timestamp: Date.now(),
          }),
          `injectme:reencryption:${metadata.challengeAddress}:${id}`
        ).catch((err: Error) => console.error('[Agent] Re-encryption archive failed (non-fatal):', err));
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          txHash: result.txHash,
          tokenId: id,
          from: verifiedWallet,
          to,
          reencrypted: !!newEncryptedPrompt,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              CLONE (ERC-7857)
  // ============================================================

  /**
   * ERC-7857 clone with TEE re-encryption proof.
   * Creates a new iNFT with same metadata, owned by the recipient.
   * The clone gets its own encryption key derived from the recipient's address.
   */
  app.post('/:tokenId/clone', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);
      const body = request.body as Record<string, unknown>;

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const validation = await validateRequiredFields(body, ['to'], reply);
      if (validation !== true) return;

      const { to } = body as { to: string };

      if (!ethers.isAddress(to)) {
        return handleError(reply, 400, 'Valid recipient address required', 'INVALID_ADDRESS');
      }

      // Verify caller owns the token
      const verifiedWallet = (request as any).verifiedWallet as string;
      const owner = await chain.getAgentOwner(id);
      if (owner.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the token owner can clone', 'NOT_OWNER');
      }

      // Look up the source prompt: first try Challenge table, then AgentPrompt table
      const metadata = await chain.getAgentMetadata(id);
      const challenge = await (prismaQuery as any).challenge.findUnique({
        where: { contractAddress: metadata.challengeAddress },
      });

      // Resolve the encrypted prompt from any available source
      let sourceEncrypted: string | undefined = challenge?.systemPromptEncrypted;
      let sourceIsOwnerEncrypted = false;

      if (!sourceEncrypted) {
        // Fallback: check AgentPrompt table (for clones or freshly minted agents)
        const sourceAgentPrompt = await (prismaQuery as any).agentPrompt.findUnique({
          where: { tokenId: id },
        });
        if (sourceAgentPrompt?.encryptedPrompt) {
          sourceEncrypted = sourceAgentPrompt.encryptedPrompt;
          sourceIsOwnerEncrypted = true;
        }
      }

      let sealedKey = '0x';
      let proof: string;
      let newEncryptedPrompt: string | undefined;

      if (sourceEncrypted) {
        try {
          // If source is owner-encrypted (AgentPrompt), decrypt first then re-encrypt for recipient
          let encryptedForReencrypt = sourceEncrypted;
          if (sourceIsOwnerEncrypted) {
            const plaintext = decryptForOwner(sourceEncrypted, verifiedWallet);
            // Re-encrypt with oracle key so reencryptForTransfer can process it
            encryptedForReencrypt = encryptAndSerialize(plaintext);
          }

          const reencrypted = await reencryptForTransfer({
            tokenId: id,
            challengeAddress: metadata.challengeAddress,
            newOwner: to,
            currentEncryptedPrompt: encryptedForReencrypt,
          });

          proof = reencrypted.proof;
          sealedKey = reencrypted.newSealedKey;
          newEncryptedPrompt = reencrypted.newEncryptedPrompt;

          console.log(`[Agent] Re-encrypted prompt for clone: token=${id}, recipient=${to}`);
        } catch (err) {
          console.error('[Agent] Clone re-encryption failed, falling back to direct encrypt:', (err as Error).message);
          // Fallback: if we have the source, decrypt and re-encrypt directly for the new owner
          try {
            let plaintext: string;
            if (sourceIsOwnerEncrypted) {
              plaintext = decryptForOwner(sourceEncrypted!, verifiedWallet);
            } else {
              plaintext = deserializeAndDecrypt(sourceEncrypted!);
            }
            newEncryptedPrompt = encryptForOwner(plaintext, to.toLowerCase());
          } catch (innerErr) {
            console.error('[Agent] Direct re-encryption also failed:', (innerErr as Error).message);
          }
          const metadataHash = await chain.getMetadataHash(id);
          const sig = chain.signProof(metadataHash);
          proof = ethers.hexlify(ethers.concat([metadataHash, sig]));
        }
      } else {
        console.warn(`[Agent] No encrypted prompt found for token ${id}, clone will have no prompt`);
        const metadataHash = await chain.getMetadataHash(id);
        const sig = chain.signProof(metadataHash);
        proof = ethers.hexlify(ethers.concat([metadataHash, sig]));
      }

      const result = await chain.cloneAgent(to, id, sealedKey, proof);

      // Store re-encrypted prompt in AgentPrompt table for the new clone
      if (newEncryptedPrompt) {
        await (prismaQuery as any).agentPrompt.upsert({
          where: { tokenId: result.newTokenId },
          create: {
            tokenId: result.newTokenId,
            encryptedPrompt: newEncryptedPrompt,
            ownerAddress: to.toLowerCase(),
            sourceTokenId: id,
            sourceChallengeAddress: metadata.challengeAddress,
          },
          update: {
            encryptedPrompt: newEncryptedPrompt,
            ownerAddress: to.toLowerCase(),
          },
        });
      }

      // Archive clone event (fire-and-forget)
      if (challenge?.systemPromptEncrypted) {
        storage.archiveData(
          JSON.stringify({
            type: 'clone-reencryption',
            originalTokenId: id,
            newTokenId: result.newTokenId,
            recipient: to,
            challengeAddress: metadata.challengeAddress,
            txHash: result.txHash,
            timestamp: Date.now(),
          }),
          `injectme:clone:${metadata.challengeAddress}:${id}:${result.newTokenId}`
        ).catch((err: Error) => console.error('[Agent] Clone archive failed (non-fatal):', err));
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          txHash: result.txHash,
          originalTokenId: id,
          newTokenId: result.newTokenId,
          to,
          reencrypted: !!challenge?.systemPromptEncrypted,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              AUTHORIZE USAGE
  // ============================================================

  /** Grant usage rights to an executor address */
  app.post('/:tokenId/authorize', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);
      const body = request.body as Record<string, unknown>;

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const validation = await validateRequiredFields(body, ['executor', 'permissions'], reply);
      if (validation !== true) return;

      const { executor, permissions } = body as { executor: string; permissions: string };

      if (!ethers.isAddress(executor)) {
        return handleError(reply, 400, 'Valid executor address required', 'INVALID_ADDRESS');
      }

      if (typeof permissions !== 'string' || permissions.length > 1000) {
        return handleError(reply, 400, 'Permissions must be a string (max 1000 chars)', 'INVALID_PERMISSIONS');
      }

      // Verify caller owns the token
      const verifiedWallet = (request as any).verifiedWallet as string;
      const owner = await chain.getAgentOwner(id);
      if (owner.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the token owner can authorize usage', 'NOT_OWNER');
      }

      const result = await chain.authorizeAgent(id, executor, permissions);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          txHash: result.txHash,
          tokenId: id,
          executor,
          permissions,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              REVOKE USAGE
  // ============================================================

  /** Revoke usage rights from an executor address */
  app.post('/:tokenId/revoke', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);
      const body = request.body as Record<string, unknown>;

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const validation = await validateRequiredFields(body, ['executor'], reply);
      if (validation !== true) return;

      const { executor } = body as { executor: string };

      if (!ethers.isAddress(executor)) {
        return handleError(reply, 400, 'Valid executor address required', 'INVALID_ADDRESS');
      }

      // Verify caller owns the token
      const verifiedWallet = (request as any).verifiedWallet as string;
      const owner = await chain.getAgentOwner(id);
      if (owner.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the token owner can revoke usage', 'NOT_OWNER');
      }

      const result = await chain.revokeAgent(id, executor);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          txHash: result.txHash,
          tokenId: id,
          executor,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              LIST AUTHORIZED EXECUTORS
  // ============================================================

  /** Get all currently authorized executors for an iNFT */
  app.get('/:tokenId/executors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const executors = await chain.getAuthorizedExecutors(id);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { tokenId: id, executors },
      });
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              SECURITY SCORE
  // ============================================================

  /** Get security score for an iNFT */
  app.get('/:tokenId/score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const score = await chain.getAgentSecurityScore(id);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { tokenId: id, securityScore: score },
      });
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              ATTESTATION HISTORY
  // ============================================================

  /** Get attestation hash history for an iNFT */
  app.get('/:tokenId/attestations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const attestations = await chain.getAgentAttestations(id);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          tokenId: id,
          count: attestations.length,
          attestationHashes: attestations,
        },
      });
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              DEPLOY AGENT TO CHALLENGE
  // ============================================================

  /**
   * Deploy a cloned/transferred agent's encrypted prompt as a new challenge.
   *
   * Flow:
   * 1. Verify caller owns the iNFT
   * 2. Retrieve the agent's encrypted prompt from AgentPrompt table
   * 3. Decrypt (owner-key), re-encrypt (oracle-key) for challenge storage
   * 4. Compute keccak256 prompt hash for on-chain verification
   * 5. Upsert Challenge record with linkedTokenId
   * 6. Stub on-chain linkage (deferred until contract upgrade)
   */
  app.post('/:tokenId/deploy', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params as { tokenId: string };
      const id = Number(tokenId);

      if (isNaN(id) || id < 0 || !Number.isInteger(id)) {
        return handleError(reply, 400, 'Valid tokenId required', 'INVALID_TOKEN_ID');
      }

      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(body, ['contractAddress', 'name'], reply);
      if (validation !== true) return;

      const {
        contractAddress, name, description, visibility, difficulty, challengeLabel
      } = body as {
        contractAddress: string;
        name: string;
        description?: string;
        visibility?: string;
        difficulty?: string;
        challengeLabel?: string;
      };

      // Validate contract address format
      if (!ethers.isAddress(contractAddress)) {
        return handleError(reply, 400, 'Valid contract address required', 'INVALID_ADDRESS');
      }

      // Validate optional enum fields
      const allowedVisibility = ['public', 'unlisted'];
      if (visibility && !allowedVisibility.includes(visibility)) {
        return handleError(reply, 400, 'Visibility must be "public" or "unlisted"', 'INVALID_VISIBILITY');
      }

      const allowedDifficulty = ['beginner', 'intermediate', 'advanced', 'expert'];
      if (difficulty && !allowedDifficulty.includes(difficulty)) {
        return handleError(reply, 400, 'Invalid difficulty level', 'INVALID_DIFFICULTY');
      }

      const allowedLabels = [
        'secret_extraction', 'function_abuse', 'persona_break',
        'logic_manipulation', 'indirect_injection', 'multi_turn_erosion', 'agent_escape'
      ];
      if (challengeLabel && !allowedLabels.includes(challengeLabel)) {
        return handleError(reply, 400, 'Invalid challenge label', 'INVALID_CHALLENGE_LABEL');
      }

      // Sanitize name length
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return handleError(reply, 400, 'Name must be between 1 and 200 characters', 'INVALID_NAME');
      }

      // Verify caller owns the token
      const verifiedWallet = (request as any).verifiedWallet as string;
      const owner = await chain.getAgentOwner(id);
      if (owner.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the token owner can deploy an agent as a challenge', 'NOT_OWNER');
      }

      // Check agent is not already linked to a challenge in DB
      const existingLink = await (prismaQuery as any).challenge.findFirst({
        where: { linkedTokenId: id },
      });
      if (existingLink) {
        return handleError(
          reply, 409,
          'This agent is already deployed as a challenge',
          'AGENT_ALREADY_DEPLOYED'
        );
      }

      // Get the agent's encrypted prompt from AgentPrompt table
      const agentPrompt = await (prismaQuery as any).agentPrompt.findUnique({
        where: { tokenId: id },
      });

      if (!agentPrompt?.encryptedPrompt) {
        return handleError(reply, 404, 'No encrypted prompt found for this agent', 'PROMPT_NOT_FOUND');
      }

      // Decrypt with owner-specific key
      const plaintext = decryptForOwner(agentPrompt.encryptedPrompt, agentPrompt.ownerAddress);

      // Re-encrypt with the backend oracle key for challenge storage
      const encryptedPrompt = encryptAndSerialize(plaintext);

      // Compute prompt hash for on-chain verification
      const promptHash = ethers.keccak256(ethers.toUtf8Bytes(plaintext));

      // Get agent metadata for model field
      const metadata = await chain.getAgentMetadata(id);

      // Upsert the Challenge record
      const challenge = await (prismaQuery as any).challenge.upsert({
        where: { contractAddress },
        create: {
          contractAddress,
          name,
          model: metadata.model,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          defender: verifiedWallet,
          description: description || '',
          visibility: visibility || 'public',
          difficulty: difficulty || 'intermediate',
          challengeLabel: challengeLabel || 'secret_extraction',
          linkedTokenId: id,
        },
        update: {
          name,
          systemPromptEncrypted: encryptedPrompt,
          systemPromptHash: promptHash,
          linkedTokenId: id,
        },
      });

      // Stub on-chain linkage (deferred until contract upgrade)
      await chain.linkAgentToChallenge(id, contractAddress);

      console.log(`[Agent] Deployed agent ${id} as challenge at ${contractAddress} by ${verifiedWallet}`);

      return reply.code(201).send({
        success: true,
        error: null,
        data: {
          challengeId: challenge.id,
          contractAddress,
          tokenId: id,
          model: metadata.model,
          promptHash,
        },
      });
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.includes('ERC721NonexistentToken') || msg.includes('invalid token')) {
        return handleNotFoundError(reply, 'Agent iNFT');
      }
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
