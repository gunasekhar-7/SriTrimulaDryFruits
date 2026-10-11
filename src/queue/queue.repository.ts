import db from '../database.js';
import { Job, RawJobRow, EnqueueOptions, QueueStats, JobStatus } from './types.js';

function parseJobRow(row: RawJobRow): Job {
  let parsedPayload = null;
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch {
    parsedPayload = row.payload;
  }

  return {
    id: row.id,
    name: row.name,
    payload: parsedPayload,
    idempotency_key: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    max_retries: row.max_retries,
    run_at: row.run_at,
    locked_until: row.locked_until,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  };
}

export class QueueRepository {
  enqueueJob<T = any>(options: EnqueueOptions<T>): Job<T> {
    const { name, payload, idempotencyKey, maxRetries = 5, runAt, delayMs = 0 } = options;
    const payloadStr = JSON.stringify(payload);

    // Idempotency check: if key provided and already exists, return existing job
    if (idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM background_jobs WHERE idempotency_key = ?')
        .get(idempotencyKey) as RawJobRow | undefined;

      if (existing) {
        return parseJobRow(existing) as Job<T>;
      }
    }

    let targetRunAtIso: string;
    if (runAt) {
      targetRunAtIso = runAt instanceof Date ? runAt.toISOString() : new Date(runAt).toISOString();
    } else if (delayMs > 0) {
      targetRunAtIso = new Date(Date.now() + delayMs).toISOString();
    } else {
      targetRunAtIso = new Date().toISOString();
    }

    // Format ISO to SQLite datetime format YYYY-MM-DD HH:MM:SS
    const sqliteRunAt = targetRunAtIso.replace('T', ' ').replace(/\..+/, '');

    const initialStatus = options.status || 'PENDING';
    const isCompleted = initialStatus === 'COMPLETED';
    const attempts = (isCompleted || initialStatus === 'FAILED') ? 1 : 0;
    const completedAt = isCompleted ? new Date().toISOString().replace('T', ' ').replace(/\..+/, '') : null;

    const stmt = db.prepare(`
      INSERT INTO background_jobs (
        name,
        payload,
        idempotency_key,
        status,
        attempts,
        max_retries,
        run_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime(?), ?)
    `);

    try {
      const result = stmt.run(name, payloadStr, idempotencyKey || null, initialStatus, attempts, maxRetries, sqliteRunAt, completedAt);
      const insertedId = result.lastInsertRowid as number;
      return this.getJobById(insertedId)! as Job<T>;
    } catch (err: any) {
      // Catch race condition if another thread inserted the same idempotency_key simultaneously
      if (idempotencyKey && err.message && err.message.includes('UNIQUE constraint failed')) {
        const existing = db
          .prepare('SELECT * FROM background_jobs WHERE idempotency_key = ?')
          .get(idempotencyKey) as RawJobRow | undefined;
        if (existing) return parseJobRow(existing) as Job<T>;
      }
      throw err;
    }
  }

  claimNextBatch(limit = 10, lockDurationSeconds = 60): Job[] {
    const claimTx = db.transaction(() => {
      // Find candidate jobs ready for processing
      const candidates = db
        .prepare(`
          SELECT * FROM background_jobs
          WHERE status = 'PENDING'
            AND datetime(run_at) <= datetime('now')
            AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))
          ORDER BY datetime(run_at) ASC, id ASC
          LIMIT ?
        `)
        .all(limit) as RawJobRow[];

      if (candidates.length === 0) return [];

      const ids = candidates.map((c) => c.id);
      const placeholders = ids.map(() => '?').join(',');

      db.prepare(`
        UPDATE background_jobs
        SET status = 'RUNNING',
            locked_until = datetime('now', '+' || ? || ' seconds'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders})
      `).run(lockDurationSeconds, ...ids);

      // Return refreshed claimed jobs
      const claimed = db
        .prepare(`SELECT * FROM background_jobs WHERE id IN (${placeholders})`)
        .all(...ids) as RawJobRow[];

      return claimed.map(parseJobRow);
    });

    return claimTx();
  }

  markJobCompleted(id: number): void {
    db.prepare(`
      UPDATE background_jobs
      SET status = 'COMPLETED',
          locked_until = NULL,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
  }

  markJobFailed(
    id: number,
    errorMessage: string,
    backoffSeconds: number,
    maxRetries: number,
    currentAttempts: number,
    isRetryable: boolean = true
  ): void {
    const newAttempts = currentAttempts + 1;

    if (!isRetryable || newAttempts >= maxRetries) {
      // Transition immediately to terminal FAILED status (Dead Letter state)
      db.prepare(`
        UPDATE background_jobs
        SET status = 'FAILED',
            attempts = ?,
            locked_until = NULL,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newAttempts, errorMessage, id);
    } else {
      // Re-schedule for retry with exponential backoff
      db.prepare(`
        UPDATE background_jobs
        SET status = 'PENDING',
            attempts = ?,
            run_at = datetime('now', '+' || ? || ' seconds'),
            locked_until = NULL,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newAttempts, Math.max(1, Math.floor(backoffSeconds)), errorMessage, id);
    }
  }

  manualRetry(id: number): boolean {
    const result = db.prepare(`
      UPDATE background_jobs
      SET status = 'PENDING',
          run_at = datetime('now'),
          locked_until = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return result.changes > 0;
  }

  cancelJob(id: number): boolean {
    const result = db.prepare(`
      UPDATE background_jobs
      SET status = 'FAILED',
          locked_until = NULL,
          last_error = 'Cancelled by administrator',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('PENDING', 'RUNNING')
    `).run(id);

    return result.changes > 0;
  }

  getJobById(id: number): Job | undefined {
    const row = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(id) as RawJobRow | undefined;
    return row ? parseJobRow(row) : undefined;
  }

  getJobs(filter: { status?: JobStatus; name?: string; limit?: number; offset?: number } = {}): Job[] {
    const { status, name, limit = 50, offset = 0 } = filter;
    let query = 'SELECT * FROM background_jobs WHERE 1=1';
    const params: any[] = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (name) {
      query += ' AND name = ?';
      params.push(name);
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as RawJobRow[];
    return rows.map(parseJobRow);
  }

  getStats(): QueueStats {
    const rows = db
      .prepare(`
        SELECT status, COUNT(*) as count
        FROM background_jobs
        GROUP BY status
      `)
      .all() as Array<{ status: JobStatus; count: number }>;

    const counts: Record<string, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    };

    let total = 0;
    for (const r of rows) {
      const key = r.status.toLowerCase();
      counts[key] = r.count;
      total += r.count;
    }

    return {
      pending: counts.pending,
      running: counts.running,
      completed: counts.completed,
      failed: counts.failed,
      total
    };
  }
}

export const queueRepository = new QueueRepository();
