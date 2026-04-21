import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { handleError, handleNotFoundError, handleServerError, handleForbiddenError } from '../utils/errorHandler.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import * as chain from '../lib/og-chain/index.ts';
import { walletAuthMiddleware } from '../middlewares/walletAuth.ts';
import { ethers } from 'ethers';
import { ORACLE_STAKING_ADDRESS } from '../config/main-config.ts';

/**
 * Oracle Staking endpoints.
 * Provides read access to oracle operator status and staking info,
 * and authenticated write access for judgment submission/confirmation.
 *
 * Requires ORACLE_STAKING_ADDRESS to be configured.
 */
export const oracleRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {

  // ============================================================
  //              STAKING INFO (public, read-only)
  // ============================================================

  /** Get staking contract info (minimum stake, active count, etc.) */
  app.get('/staking/info', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      const info = await chain.getStakingInfo();

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          contractAddress: ORACLE_STAKING_ADDRESS,
          ...info,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              ACTIVE ORACLES (public, read-only)
  // ============================================================

  /** List all active oracle operators */
  app.get('/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      const oracles = await chain.getActiveOracles();

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          oracles,
          count: oracles.length,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              OPERATOR INFO (public, read-only)
  // ============================================================

  /** Get operator details by address */
  app.get('/operator/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!ethers.isAddress(address)) {
        return handleError(reply, 400, 'Invalid operator address', 'INVALID_ADDRESS');
      }

      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      const info = await chain.getOperatorInfo(address);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address,
          stakedAmount: ethers.formatEther(info.stakedAmount),
          isActive: info.isActive,
          judgmentsSubmitted: info.judgmentsSubmitted,
          judgmentsSlashed: info.judgmentsSlashed,
          rewards: ethers.formatEther(info.rewards),
          slashRate: info.judgmentsSubmitted > 0
            ? parseFloat(((info.judgmentsSlashed / info.judgmentsSubmitted) * 100).toFixed(2))
            : 0,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              JUDGMENT SUBMISSION (authenticated)
  // ============================================================

  /**
   * Submit a judgment for a challenge.
   * Only active oracle operators can submit judgments.
   * Starts the multi-sig confirmation flow.
   */
  app.post('/judgment/submit', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const validation = await validateRequiredFields(body, ['challenge', 'winner', 'chatID'], reply);
      if (validation !== true) return;

      const { challenge, winner, chatID } = body as {
        challenge: string;
        winner: string;
        chatID: string;
      };

      if (!ethers.isAddress(challenge)) {
        return handleError(reply, 400, 'Invalid challenge address', 'INVALID_CHALLENGE');
      }
      if (!ethers.isAddress(winner)) {
        return handleError(reply, 400, 'Invalid winner address', 'INVALID_WINNER');
      }
      if (typeof chatID !== 'string' || chatID.length === 0 || chatID.length > 500) {
        return handleError(reply, 400, 'chatID must be 1-500 characters', 'INVALID_CHAT_ID');
      }

      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      // Verify caller is an active oracle operator
      const verifiedWallet = (request as any).verifiedWallet as string;
      const isActive = await chain.isActiveOracle(verifiedWallet);
      if (!isActive) {
        return handleForbiddenError(reply, 'Only active oracle operators can submit judgments');
      }

      const { judgmentId, txHash } = await chain.submitJudgment(challenge, winner, chatID);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          judgmentId,
          txHash,
          challenge,
          winner,
          chatID,
          submittedBy: verifiedWallet,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              JUDGMENT CONFIRMATION (authenticated)
  // ============================================================

  /**
   * Confirm a pending judgment.
   * Multiple oracles must confirm before the judgment is executed.
   */
  app.post('/judgment/:id/confirm', { preHandler: [walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const judgmentId = Number(id);

      if (isNaN(judgmentId) || judgmentId < 0) {
        return handleError(reply, 400, 'Valid judgment ID required', 'INVALID_JUDGMENT_ID');
      }

      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      // Verify caller is an active oracle operator
      const verifiedWallet = (request as any).verifiedWallet as string;
      const isActive = await chain.isActiveOracle(verifiedWallet);
      if (!isActive) {
        return handleForbiddenError(reply, 'Only active oracle operators can confirm judgments');
      }

      const { txHash } = await chain.confirmJudgment(judgmentId);

      // Get updated status after confirmation
      const status = await chain.getJudgmentStatus(judgmentId);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          judgmentId,
          txHash,
          confirmedBy: verifiedWallet,
          confirmations: status.confirmations,
          required: status.required,
          executed: status.executed,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              JUDGMENT STATUS (public, read-only)
  // ============================================================

  /** Get the status of a judgment (confirmations, execution state) */
  app.get('/judgment/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const judgmentId = Number(id);

      if (isNaN(judgmentId) || judgmentId < 0) {
        return handleError(reply, 400, 'Valid judgment ID required', 'INVALID_JUDGMENT_ID');
      }

      if (!ORACLE_STAKING_ADDRESS) {
        return handleError(reply, 503, 'Oracle staking contract not configured', 'STAKING_NOT_CONFIGURED');
      }

      const status = await chain.getJudgmentStatus(judgmentId);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          judgmentId,
          confirmations: status.confirmations,
          required: status.required,
          executed: status.executed,
          progress: `${status.confirmations}/${status.required}`,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
