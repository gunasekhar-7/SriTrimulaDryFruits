import { Job, JobHandler, EnqueueOptions, QueueStats } from './types.js';
import { queueRepository } from './queue.repository.js';
import { withSpan, metricsAggregator } from '../observability/index.js';
import logger from '../logger.js';

export class QueueService {
  private handlers = new Map<string, JobHandler>();
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.handlers = new Map();
  }

  registerHandler<T = any>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler);
  }

  enqueue<T = any>(options: EnqueueOptions<T>): Job<T> {
    const job = queueRepository.enqueueJob(options);
    logger.info(`[Queue] Enqueued job #${job.id} (${job.name})`, {
      idempotencyKey: job.idempotency_key,
      runAt: job.run_at
    });

    // If worker is running, trigger an immediate cycle if idle (only for PENDING jobs)
    if (this.isRunning && !this.isProcessing && job.status === 'PENDING') {
      setImmediate(() => this.processNextBatch().catch(() => {}));
    }

    return job;
  }

  calculateBackoff(attempts: number, baseDelaySec = 2, maxDelaySec = 3600): number {
    // Exponential backoff: baseDelay * 2^(attempts - 1)
    const exponential = baseDelaySec * Math.pow(2, Math.max(0, attempts - 1));
    // Add 10-25% jitter to prevent thundering herds on recovered external APIs
    const jitter = exponential * (0.1 + Math.random() * 0.15);
    return Math.min(maxDelaySec, Number((exponential + jitter).toFixed(1)));
  }

  async processNextBatch(limit = 10): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const jobs = queueRepository.claimNextBatch(limit, 60);
      if (jobs.length === 0) return 0;

      for (const job of jobs) {
        await this.executeJob(job);
      }

      return jobs.length;
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const startHr = process.hrtime();
    const handler = this.handlers.get(job.name);

    await withSpan(`job.process:${job.name}`, {
      attributes: {
        'job.id': job.id,
        'job.name': job.name,
        'job.attempt': job.attempts + 1,
        'job.max_retries': job.max_retries,
        'job.idempotency_key': job.idempotency_key || 'none'
      }
    }, async () => {
      if (!handler) {
        const errorMsg = `No handler registered for job type: ${job.name}`;
        logger.error(`[Queue] ${errorMsg} (Job #${job.id})`);
        queueRepository.markJobFailed(job.id, errorMsg, 300, job.max_retries, job.attempts);
        metricsAggregator.recordBackgroundJobRun(job.name, 0, false, 'unhandled_job_type');
        return;
      }

      try {
        await handler(job.payload, job);

        const diff = process.hrtime(startHr);
        const durationSec = diff[0] + diff[1] / 1e9;

        queueRepository.markJobCompleted(job.id);
        metricsAggregator.recordBackgroundJobRun(job.name, durationSec, true);
        logger.info(`[Queue] ✅ Job #${job.id} (${job.name}) completed successfully in ${(durationSec * 1000).toFixed(1)}ms`);
      } catch (error: any) {
        const diff = process.hrtime(startHr);
        const durationSec = diff[0] + diff[1] / 1e9;
        const errorMsg = error?.message || 'Unknown job execution error';

        const isNonRetryable = error?.isRetryable === false ||
          error?.name === 'MissingReferencedRecordError' ||
          error?.name === 'InvalidPayloadError' ||
          error?.name === 'NonRetryableJobError' ||
          error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
          (typeof error?.message === 'string' && error.message.includes('FOREIGN KEY constraint failed'));

        const backoffSec = this.calculateBackoff(job.attempts + 1);
        const willRetry = !isNonRetryable && (job.attempts + 1 < job.max_retries);

        queueRepository.markJobFailed(job.id, errorMsg, backoffSec, job.max_retries, job.attempts, !isNonRetryable);
        metricsAggregator.recordBackgroundJobRun(job.name, durationSec, false, errorMsg);

        if (willRetry) {
          logger.warn(`[Queue] ⚠️ Job #${job.id} (${job.name}) failed (Attempt ${job.attempts + 1}/${job.max_retries}). Retrying in ${backoffSec}s. Error: ${errorMsg}`);
        } else {
          logger.error(`[Queue] ❌ Job #${job.id} (${job.name}) permanently FAILED (${isNonRetryable ? 'Non-retryable error' : `after ${job.max_retries} attempts`}). Error: ${errorMsg}`);
        }
      }
    });
  }

  startWorker(pollIntervalMs = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`[Queue] Background job worker started (polling every ${pollIntervalMs}ms)`);

    const scheduleNext = () => {
      if (!this.isRunning) return;

      this.pollTimer = setTimeout(async () => {
        try {
          const processedCount = await this.processNextBatch();
          // If jobs were found, poll immediately for more without waiting full interval
          if (processedCount > 0 && this.isRunning) {
            setImmediate(scheduleNext);
            return;
          }
        } catch (err: any) {
          logger.error(`[Queue] Error in worker polling cycle: ${err.message}`);
        }

        scheduleNext();
      }, pollIntervalMs);
    };

    scheduleNext();
  }

  stopWorker(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('[Queue] Background job worker stopped.');
  }

  manualRetry(jobId: number): boolean {
    const job = queueRepository.getJobById(jobId);
    if (!job) return false;

    const success = queueRepository.manualRetry(jobId);
    if (success) {
      logger.info(`[Queue] Manual retry triggered for Job #${jobId} (${job.name})`);
      if (this.isRunning && !this.isProcessing) {
        setImmediate(() => this.processNextBatch().catch(() => {}));
      }
    }
    return success;
  }

  cancelJob(jobId: number): boolean {
    const job = queueRepository.getJobById(jobId);
    if (!job) return false;

    const success = queueRepository.cancelJob(jobId);
    if (success) {
      logger.info(`[Queue] Job #${jobId} (${job.name}) cancelled by administrator`);
    }
    return success;
  }

  getJobById(id: number): Job | undefined {
    return queueRepository.getJobById(id);
  }

  getJobs(filter: { status?: any; name?: string; limit?: number; offset?: number } = {}): Job[] {
    return queueRepository.getJobs(filter);
  }

  getStats(): QueueStats {
    return queueRepository.getStats();
  }
}

export const queueService = new QueueService();
