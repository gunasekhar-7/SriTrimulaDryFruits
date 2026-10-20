import { Request, Response } from 'express';
import { queueService } from '../queue/index.js';
import { Job } from '../queue/types.js';
import logger from '../logger.js';

/**
 * Sanitizes sensitive fields from background job payloads to prevent
 * accidental data leakage (PII, customer phone numbers, auth tokens).
 */
export function sanitizeJob(job: Job): Job {
  if (!job) return job;
  const sanitized: Job = { ...job };

  if (sanitized.payload && typeof sanitized.payload === 'object') {
    const payloadCopy = { ...sanitized.payload };

    // Mask phone numbers if present
    if (typeof payloadCopy.phone === 'string' && payloadCopy.phone.length >= 7) {
      const p = payloadCopy.phone.trim();
      payloadCopy.phone = '***' + p.slice(-4);
    }

    // Redact credential keys
    for (const key of ['token', 'accessToken', 'access_token', 'secret', 'password', 'apiKey', 'api_key', 'otp']) {
      if (key in payloadCopy) {
        payloadCopy[key] = '[REDACTED]';
      }
    }

    sanitized.payload = payloadCopy;
  }

  return sanitized;
}

export class JobController {
  getStats(req: Request, res: Response) {
    const stats = queueService.getStats();
    res.json({
      success: true,
      status: 'ok',
      stats
    });
  }

  getJobs(req: Request, res: Response) {
    const { status, name, limit, offset } = req.query;

    const parsedLimit = limit ? Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50)) : 50;
    const parsedOffset = offset ? Math.max(0, parseInt(offset as string, 10) || 0) : 0;

    const rawJobs = queueService.getJobs({
      status: status as any,
      name: name as string,
      limit: parsedLimit,
      offset: parsedOffset
    });

    const jobs = rawJobs.map(sanitizeJob);

    res.json({
      success: true,
      total: jobs.length,
      jobs
    });
  }

  getJobById(req: Request, res: Response) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JOB_ID', message: 'Job ID must be a valid positive integer' }
      });
    }

    const job = queueService.getJobById(id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'JOB_NOT_FOUND', message: 'Job not found' }
      });
    }

    const sanitized = sanitizeJob(job);
    res.json({
      success: true,
      job: sanitized,
      ...sanitized // Maintain backward compatibility for direct field access
    });
  }

  retryJob(req: Request, res: Response) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JOB_ID', message: 'Job ID must be a valid positive integer' }
      });
    }

    const job = queueService.getJobById(id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'JOB_NOT_FOUND', message: 'Job not found' }
      });
    }

    const success = queueService.manualRetry(id);
    if (!success) {
      return res.status(400).json({
        success: false,
        error: { code: 'RETRY_FAILED', message: 'Failed to trigger retry for job' }
      });
    }

    const actor = req.session?.user || 'internal_service';
    logger.info(`[AUDIT] JOB_RETRY on JOB:${id} (${job.name}) by ${actor}`, {
      event: 'job.manual_retry',
      jobId: id,
      jobName: job.name,
      actor
    });

    const updatedJob = queueService.getJobById(id);
    const sanitized = updatedJob ? sanitizeJob(updatedJob) : null;

    res.json({
      success: true,
      message: `Job #${id} re-armed for retry`,
      job: sanitized
    });
  }

  cancelJob(req: Request, res: Response) {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JOB_ID', message: 'Job ID must be a valid positive integer' }
      });
    }

    const job = queueService.getJobById(id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'JOB_NOT_FOUND', message: 'Job not found' }
      });
    }

    const success = queueService.cancelJob(id);
    if (!success) {
      return res.status(400).json({
        success: false,
        error: { code: 'CANCEL_FAILED', message: 'Job cannot be cancelled (must be in PENDING or RUNNING status)' }
      });
    }

    const actor = req.session?.user || 'internal_service';
    logger.info(`[AUDIT] JOB_CANCEL on JOB:${id} (${job.name}) by ${actor}`, {
      event: 'job.manual_cancel',
      jobId: id,
      jobName: job.name,
      actor
    });

    const updatedJob = queueService.getJobById(id);
    const sanitized = updatedJob ? sanitizeJob(updatedJob) : null;

    res.json({
      success: true,
      message: `Job #${id} cancelled`,
      job: sanitized
    });
  }
}

export const jobController = new JobController();
