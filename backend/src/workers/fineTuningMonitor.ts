import cron from 'node-cron';
import { prismaQuery } from '../lib/prisma.ts';
import { FINE_TUNING_ENABLED } from '../config/main-config.ts';
import * as fineTuning from '../lib/og-compute/fineTuning.ts';

/**
 * Fine-Tuning Monitor Worker
 *
 * Polls every 60 seconds for jobs with TRAINING or PENDING status.
 * Checks 0G Compute for progress updates and transitions:
 * - PENDING with taskId: check if training has started
 * - TRAINING: check if completed, failed, or still in progress
 * - On completion: store the fine-tuned model ID
 * - On failure: record error message
 *
 * Based on 0G task progress states:
 * Init -> SettingUp -> SetUp -> Training -> Trained -> Delivering ->
 * Delivered -> UserAcknowledged -> Finished
 */

let isRunning = false;

async function pollFineTuningJobs(): Promise<void> {
  if (isRunning) {
    console.log('[FineTuningMonitor] Previous run still active, skipping...');
    return;
  }

  if (!FINE_TUNING_ENABLED) {
    return;
  }

  isRunning = true;

  try {
    // Find all active jobs (PENDING with taskId, or TRAINING)
    const activeJobs = await (prismaQuery as any).fineTuningJob.findMany({
      where: {
        status: { in: ['PENDING', 'TRAINING'] },
        taskId: { not: null },
      },
    }) as Array<{
      id: string;
      taskId: string;
      providerAddress: string;
      status: string;
      baseModel: string;
    }>;

    if (activeJobs.length === 0) {
      return;
    }

    console.log(`[FineTuningMonitor] Checking ${activeJobs.length} active job(s)...`);

    for (const job of activeJobs) {
      try {
        await checkJobProgress(job);
      } catch (err) {
        // Don't let one failed check block others
        console.error(`[FineTuningMonitor] Error checking job ${job.id}:`, (err as Error).message);
      }
    }
  } catch (error) {
    console.error('[FineTuningMonitor] Error:', error);
  } finally {
    isRunning = false;
  }
}

async function checkJobProgress(job: {
  id: string;
  taskId: string;
  providerAddress: string;
  status: string;
  baseModel: string;
}): Promise<void> {
  // Fetch live status from 0G Compute
  let taskStatus;
  try {
    taskStatus = await fineTuning.getFineTuningJobStatus(job.providerAddress, job.taskId);
  } catch (err) {
    console.error(`[FineTuningMonitor] Status fetch failed for ${job.taskId}:`, (err as Error).message);
    return;
  }

  const newStatus = fineTuning.mapProgressToStatus(taskStatus.progress);

  // No change, skip update
  if (newStatus === job.status) {
    return;
  }

  console.log(`[FineTuningMonitor] Job ${job.id} (${job.taskId}): ${job.status} -> ${newStatus} (progress: ${taskStatus.progress})`);

  const updateData: Record<string, unknown> = { status: newStatus };

  if (newStatus === 'COMPLETED') {
    // The fine-tuned model identifier is the task ID in 0G's system
    // The actual LoRA adapter needs to be downloaded separately
    updateData.fineTunedModel = `${job.baseModel}:lora:${job.taskId}`;
    console.log(`[FineTuningMonitor] Job ${job.id} completed. Model: ${updateData.fineTunedModel}`);
  }

  if (newStatus === 'FAILED') {
    // Try to get logs for error details
    let errorMessage = 'Training failed';
    try {
      const logs = await fineTuning.getFineTuningLogs(job.providerAddress, job.taskId);
      // Take last 500 chars of logs as error message
      errorMessage = logs.substring(Math.max(0, logs.length - 500));
    } catch {
      errorMessage = `Task progress: ${taskStatus.progress}`;
    }
    updateData.errorMessage = errorMessage;
    console.error(`[FineTuningMonitor] Job ${job.id} failed: ${errorMessage.substring(0, 100)}`);
  }

  await (prismaQuery as any).fineTuningJob.update({
    where: { id: job.id },
    data: updateData,
  });
}

export const startFineTuningMonitor = (): void => {
  if (!FINE_TUNING_ENABLED) {
    console.log('[FineTuningMonitor] Fine-tuning disabled, worker not started');
    return;
  }

  // Verify CLI is installed on startup
  fineTuning.verifyCliInstalled().catch(() => {});

  console.log('[FineTuningMonitor] Worker scheduled: every 60 seconds');
  cron.schedule('* * * * *', pollFineTuningJobs); // Every minute

  // Initial check after 15s (give CLI time to be verified)
  setTimeout(pollFineTuningJobs, 15000);
};
