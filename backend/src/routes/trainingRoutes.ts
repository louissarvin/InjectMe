import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { handleError, handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import { walletAuthMiddleware } from '../middlewares/walletAuth.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { ethers } from 'ethers';
import {
  FINE_TUNING_ENABLED,
  FINE_TUNING_MAX_SAMPLES,
  FINE_TUNING_MAX_EPOCHS,
  OG_COMPUTE_PROVIDER,
} from '../config/main-config.ts';
import * as fineTuning from '../lib/og-compute/fineTuning.ts';

/**
 * Agent Training / Fine-Tuning Routes
 *
 * Allows defenders to fine-tune AI models using 0G Compute to build
 * models that resist prompt injection attacks. Training data consists
 * of adversarial examples the model should learn to REJECT.
 *
 * All mutation endpoints require wallet authentication.
 * Feature-gated behind FINE_TUNING_ENABLED env var.
 */

/** Middleware: check if fine-tuning feature is enabled */
function requireFineTuning(_request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (!FINE_TUNING_ENABLED) {
    reply.code(503).send({
      success: false,
      error: { code: 'FEATURE_DISABLED', message: 'Fine-tuning is not enabled on this server' },
      data: null,
    });
    return;
  }
  done();
}

export const trainingRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {

  // ============================================================
  //              SUBMIT FINE-TUNING JOB
  // ============================================================

  /**
   * Submit a fine-tuning job.
   * Body: { baseModel, trainingData: [{prompt, response, label}...], epochs?, learningRate?, providerAddress? }
   */
  app.post('/submit', { preHandler: [requireFineTuning, walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const verifiedWallet = (request as any).verifiedWallet as string;

      const validation = await validateRequiredFields(body, ['baseModel', 'trainingData'], reply);
      if (validation !== true) return;

      const {
        baseModel,
        trainingData,
        epochs,
        learningRate,
        providerAddress,
      } = body as {
        baseModel: string;
        trainingData: Array<{ prompt: string; response: string; label: string }>;
        epochs?: number;
        learningRate?: number;
        providerAddress?: string;
      };

      // Validate baseModel is a non-empty string
      if (typeof baseModel !== 'string' || baseModel.length === 0 || baseModel.length > 200) {
        return handleError(reply, 400, 'baseModel must be a non-empty string (max 200 chars)', 'INVALID_BASE_MODEL');
      }

      // Validate training data
      if (!Array.isArray(trainingData) || trainingData.length === 0) {
        return handleError(reply, 400, 'trainingData must be a non-empty array', 'INVALID_TRAINING_DATA');
      }

      if (trainingData.length < 10) {
        return handleError(reply, 400, 'Minimum 10 training examples required (0G requirement)', 'INSUFFICIENT_TRAINING_DATA');
      }

      if (trainingData.length > FINE_TUNING_MAX_SAMPLES) {
        return handleError(reply, 400, `Maximum ${FINE_TUNING_MAX_SAMPLES} training samples per job`, 'TOO_MANY_SAMPLES');
      }

      // Validate each training pair
      for (let i = 0; i < trainingData.length; i++) {
        const pair = trainingData[i];
        if (!pair.prompt || typeof pair.prompt !== 'string') {
          return handleError(reply, 400, `trainingData[${i}].prompt is required and must be a string`, 'INVALID_TRAINING_PAIR');
        }
        if (!pair.response || typeof pair.response !== 'string') {
          return handleError(reply, 400, `trainingData[${i}].response is required and must be a string`, 'INVALID_TRAINING_PAIR');
        }
        if (!['REJECT', 'SAFE'].includes(pair.label)) {
          return handleError(reply, 400, `trainingData[${i}].label must be "REJECT" or "SAFE"`, 'INVALID_TRAINING_PAIR');
        }
        // Bound individual prompt/response sizes
        if (pair.prompt.length > 4000) {
          return handleError(reply, 400, `trainingData[${i}].prompt exceeds 4000 char limit`, 'TRAINING_DATA_TOO_LARGE');
        }
        if (pair.response.length > 4000) {
          return handleError(reply, 400, `trainingData[${i}].response exceeds 4000 char limit`, 'TRAINING_DATA_TOO_LARGE');
        }
      }

      // Validate epochs
      const finalEpochs = epochs || 3;
      if (finalEpochs < 1 || finalEpochs > FINE_TUNING_MAX_EPOCHS) {
        return handleError(reply, 400, `epochs must be between 1 and ${FINE_TUNING_MAX_EPOCHS}`, 'INVALID_EPOCHS');
      }

      // Validate learning rate
      const finalLearningRate = learningRate || 0.0002;
      if (finalLearningRate < 0.00001 || finalLearningRate > 0.001) {
        return handleError(reply, 400, 'learningRate must be between 0.00001 and 0.001', 'INVALID_LEARNING_RATE');
      }

      // Hash training data for integrity verification
      const trainingDataHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(trainingData))
      );

      const targetProvider = providerAddress || OG_COMPUTE_PROVIDER;
      if (!targetProvider) {
        return handleError(reply, 400, 'providerAddress required (no default provider configured)', 'NO_PROVIDER');
      }

      // Create DB record first (PENDING status)
      const job = await (prismaQuery as any).fineTuningJob.create({
        data: {
          defender: verifiedWallet,
          providerAddress: targetProvider,
          baseModel,
          status: 'PENDING',
          trainingDataHash,
          hyperparameters: JSON.stringify({
            neftune_noise_alpha: 5,
            num_train_epochs: finalEpochs,
            per_device_train_batch_size: 2,
            learning_rate: finalLearningRate,
            max_steps: -1,
          }),
          epochs: finalEpochs,
          trainingPairs: trainingData.length,
        },
      });

      // Submit to 0G Compute (async, update DB on result)
      (async () => {
        try {
          const result = await fineTuning.submitFineTuningJob({
            baseModel,
            trainingData: trainingData as Array<{ prompt: string; response: string; label: 'REJECT' | 'SAFE' }>,
            epochs: finalEpochs,
            learningRate: finalLearningRate,
            providerAddress: targetProvider,
          });

          await (prismaQuery as any).fineTuningJob.update({
            where: { id: job.id },
            data: {
              taskId: result.taskId,
              datasetHash: result.datasetHash,
              status: 'TRAINING',
            },
          });

          console.log(`[Training] Job ${job.id} submitted to 0G Compute: taskId=${result.taskId}`);
        } catch (err) {
          console.error(`[Training] Job ${job.id} submission failed:`, err);
          await (prismaQuery as any).fineTuningJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: (err as Error).message?.substring(0, 500) || 'Submission failed',
            },
          }).catch(() => {});
        }
      })();

      return reply.code(202).send({
        success: true,
        error: null,
        data: {
          jobId: job.id,
          status: 'PENDING',
          message: 'Fine-tuning job submitted. Check status with GET /training/jobs/' + job.id,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              LIST CALLER'S FINE-TUNING JOBS
  // ============================================================

  app.get('/jobs', { preHandler: [requireFineTuning, walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const verifiedWallet = (request as any).verifiedWallet as string;
      const query = request.query as { page?: string; limit?: string };

      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      const [jobs, total] = await Promise.all([
        (prismaQuery as any).fineTuningJob.findMany({
          where: { defender: verifiedWallet },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            baseModel: true,
            taskId: true,
            status: true,
            fineTunedModel: true,
            epochs: true,
            trainingPairs: true,
            providerAddress: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        (prismaQuery as any).fineTuningJob.count({
          where: { defender: verifiedWallet },
        }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          jobs,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              GET JOB STATUS
  // ============================================================

  app.get('/jobs/:jobId', { preHandler: [requireFineTuning, walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { jobId } = request.params as { jobId: string };
      const verifiedWallet = (request as any).verifiedWallet as string;

      const job = await (prismaQuery as any).fineTuningJob.findFirst({
        where: { id: jobId, defender: verifiedWallet },
      });

      if (!job) {
        return handleNotFoundError(reply, 'Fine-tuning job');
      }

      // If job is TRAINING and has a taskId, fetch live status from 0G
      let liveStatus = null;
      if (job.status === 'TRAINING' && job.taskId) {
        try {
          liveStatus = await fineTuning.getFineTuningJobStatus(job.providerAddress, job.taskId);
        } catch (err) {
          console.error(`[Training] Live status fetch failed for ${job.taskId}:`, (err as Error).message);
        }
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          ...job,
          hyperparameters: job.hyperparameters ? JSON.parse(job.hyperparameters) : null,
          liveStatus,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              CANCEL JOB
  // ============================================================

  app.post('/jobs/:jobId/cancel', { preHandler: [requireFineTuning, walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { jobId } = request.params as { jobId: string };
      const verifiedWallet = (request as any).verifiedWallet as string;

      const job = await (prismaQuery as any).fineTuningJob.findFirst({
        where: { id: jobId, defender: verifiedWallet },
      });

      if (!job) {
        return handleNotFoundError(reply, 'Fine-tuning job');
      }

      if (!['PENDING', 'TRAINING'].includes(job.status)) {
        return handleError(reply, 400, `Cannot cancel job with status: ${job.status}`, 'INVALID_STATUS');
      }

      // Cancel on 0G Compute if taskId exists
      if (job.taskId) {
        try {
          await fineTuning.cancelFineTuningJob(job.providerAddress, job.taskId);
        } catch (err) {
          console.error(`[Training] 0G cancel failed for ${job.taskId}:`, (err as Error).message);
          // Still mark as cancelled locally even if 0G cancel fails
        }
      }

      await (prismaQuery as any).fineTuningJob.update({
        where: { id: job.id },
        data: { status: 'CANCELLED' },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: { jobId: job.id, status: 'CANCELLED' },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              LIST AVAILABLE FINE-TUNED MODELS (public)
  // ============================================================

  app.get('/models', { preHandler: [requireFineTuning] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // List completed jobs with fine-tuned models
      const completedJobs = await (prismaQuery as any).fineTuningJob.findMany({
        where: {
          status: 'COMPLETED',
          fineTunedModel: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          baseModel: true,
          fineTunedModel: true,
          epochs: true,
          trainingPairs: true,
          defender: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Also fetch available base models from 0G
      let availableModels = { standard: [] as string[], customized: [] as string[] };
      try {
        availableModels = await fineTuning.listFineTuningModels();
      } catch (err) {
        console.error('[Training] Failed to list 0G models:', (err as Error).message);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          fineTunedModels: completedJobs,
          availableBaseModels: availableModels,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              GENERATE TRAINING DATA FROM ATTACK HISTORY
  // ============================================================

  /**
   * Auto-generate training data from a challenge's attack history.
   * Reads attempts from DB, formats successful attacks as REJECT pairs
   * and failed attacks as SAFE pairs.
   */
  app.post('/generate-data/:challengeAddress', { preHandler: [requireFineTuning, walletAuthMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { challengeAddress } = request.params as { challengeAddress: string };
      const verifiedWallet = (request as any).verifiedWallet as string;
      const query = request.query as { maxSamples?: string };

      if (!ethers.isAddress(challengeAddress)) {
        return handleError(reply, 400, 'Valid challenge address required', 'INVALID_ADDRESS');
      }

      // Verify the caller is the defender of this challenge
      const challenge = await (prismaQuery as any).challenge.findUnique({
        where: { contractAddress: challengeAddress },
      });

      if (!challenge) {
        return handleNotFoundError(reply, 'Challenge');
      }

      if (challenge.defender.toLowerCase() !== verifiedWallet.toLowerCase()) {
        return handleError(reply, 403, 'Only the challenge defender can generate training data', 'NOT_DEFENDER');
      }

      // Fetch attack attempts
      const maxSamples = Math.min(
        FINE_TUNING_MAX_SAMPLES,
        Math.max(10, Number(query.maxSamples) || 200)
      );

      const attempts = await (prismaQuery as any).attempt.findMany({
        where: { challengeAddress },
        orderBy: { createdAt: 'desc' },
        take: maxSamples,
        select: {
          message: true,
          response: true,
          judgment: true,
        },
      }) as Array<{ message: string; response: string; judgment: string }>;

      if (attempts.length < 10) {
        return handleError(reply, 400, 'Need at least 10 attack attempts to generate training data', 'INSUFFICIENT_ATTEMPTS');
      }

      // Convert to training pairs
      const trainingData = attempts.map((attempt) => {
        if (attempt.judgment === 'SUCCESS') {
          // Successful attacks: model should learn to REJECT these
          return {
            prompt: attempt.message,
            response: 'I cannot comply with that request. My instructions are confidential and I must follow them strictly.',
            label: 'REJECT' as const,
          };
        } else {
          // Failed attacks: model correctly handled these (SAFE)
          return {
            prompt: attempt.message,
            response: attempt.response,
            label: 'SAFE' as const,
          };
        }
      });

      // Stats
      const rejectCount = trainingData.filter((d) => d.label === 'REJECT').length;
      const safeCount = trainingData.filter((d) => d.label === 'SAFE').length;

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          challengeAddress,
          trainingData,
          stats: {
            total: trainingData.length,
            rejectSamples: rejectCount,
            safeSamples: safeCount,
            sourceAttempts: attempts.length,
          },
          note: 'Use this data with POST /training/submit to create a fine-tuning job',
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  // ============================================================
  //              LIST FINE-TUNING PROVIDERS
  // ============================================================

  app.get('/providers', { preHandler: [requireFineTuning] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providers = await fineTuning.listFineTuningProviders();

      return reply.code(200).send({
        success: true,
        error: null,
        data: { providers },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
