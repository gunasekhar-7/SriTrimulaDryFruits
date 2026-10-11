export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export class NonRetryableJobError extends Error {
  public readonly isRetryable: boolean = false;
  constructor(message: string, public readonly details?: Record<string, any>) {
    super(message);
    this.name = 'NonRetryableJobError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MissingReferencedRecordError extends NonRetryableJobError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, details);
    this.name = 'MissingReferencedRecordError';
  }
}

export class InvalidPayloadError extends NonRetryableJobError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, details);
    this.name = 'InvalidPayloadError';
  }
}

export interface Job<T = any> {
  id: number;
  name: string;
  payload: T;
  idempotency_key?: string | null;
  status: JobStatus;
  attempts: number;
  max_retries: number;
  run_at: string;
  locked_until?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface RawJobRow {
  id: number;
  name: string;
  payload: string;
  idempotency_key: string | null;
  status: JobStatus;
  attempts: number;
  max_retries: number;
  run_at: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface EnqueueOptions<T = any> {
  name: string;
  payload: T;
  idempotencyKey?: string;
  maxRetries?: number;
  runAt?: Date | string;
  delayMs?: number;
  status?: JobStatus;
}

export type JobHandler<T = any> = (payload: T, job: Job<T>) => Promise<any> | any;

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}
