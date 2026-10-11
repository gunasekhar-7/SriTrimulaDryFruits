import db from '../database.js';

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

export class IdempotencyService {
  execute<T>(
    key: string,
    resourceType: string,
    action: () => IdempotentResult<T>
  ): IdempotentResult<T> {
    // We must execute this safely. Since SQLite executes synchronously and better-sqlite3 throws on constraints.
    // However, what if a request is already processed? We just return it.
    
    // Begin transaction for safety, though we'll use a specific logic.
    // 1. Try to insert. If it fails with UNIQUE constraint, we already saw it.
    try {
      db.prepare(`
        INSERT INTO idempotency_keys (key, resource_type) VALUES (?, ?)
      `).run(key, resourceType);
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        // Already exists. Let's fetch the result.
        const existing = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`).get(key) as any;
        if (existing.response_status === null) {
          throw new Error('Concurrent request in progress'); // Or 409 Conflict
        }
        return {
          status: existing.response_status,
          body: JSON.parse(existing.response_body)
        };
      }
      throw err;
    }

    // 2. We successfully claimed the key. Now execute the action.
    let result: IdempotentResult<T>;
    try {
      result = action();
      
      // 3. Save the result
      db.prepare(`
        UPDATE idempotency_keys 
        SET response_status = ?, response_body = ? 
        WHERE key = ?
      `).run(result.status, JSON.stringify(result.body), key);
      
      return result;
    } catch (err: any) {
      // If the action fails, we delete the key so it can be retried, 
      // or we could save the error. Let's delete it so the user can retry.
      db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
      throw err;
    }
  }

  async executeAsync<T>(
    key: string,
    resourceType: string,
    action: () => Promise<IdempotentResult<T>>
  ): Promise<IdempotentResult<T>> {
    try {
      db.prepare(`
        INSERT INTO idempotency_keys (key, resource_type) VALUES (?, ?)
      `).run(key, resourceType);
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        const existing = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`).get(key) as any;
        if (existing.response_status === null) {
          throw new Error('Concurrent request in progress');
        }
        return {
          status: existing.response_status,
          body: JSON.parse(existing.response_body)
        };
      }
      throw err;
    }

    let result: IdempotentResult<T>;
    try {
      result = await action();
      
      db.prepare(`
        UPDATE idempotency_keys 
        SET response_status = ?, response_body = ? 
        WHERE key = ?
      `).run(result.status, JSON.stringify(result.body), key);
      
      return result;
    } catch (err: any) {
      db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
      throw err;
    }
  }

  isProcessed(key: string): boolean {
    const existing = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`).get(key) as any;
    return !!existing;
  }
}

export const idempotencyService = new IdempotencyService();
