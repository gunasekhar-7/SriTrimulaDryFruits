import crypto from 'crypto';
import db from '../database.js';
import { AuditLogEntry, AuditLogInput, AuditLogFilter } from '../types/audit.js';

export class AuditRepository {
  /**
   * Inserts an immutable audit log record with cryptographic SHA-256 hash chaining.
   */
  insertAuditLog(input: AuditLogInput): AuditLogEntry {
    const timestamp = input.timestamp || new Date().toISOString();
    const entityIdStr = input.entity_id !== undefined && input.entity_id !== null ? String(input.entity_id) : null;
    const metadataStr = typeof input.metadata === 'object' && input.metadata !== null
      ? JSON.stringify(input.metadata)
      : (typeof input.metadata === 'string' ? input.metadata : null);

    // Retrieve previous hash for blockchain-style tamper-evident chaining
    const lastRow = db.prepare('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
    const prevHash = lastRow ? lastRow.hash : 'GENESIS';

    // Compute canonical cryptographic SHA-256 hash
    const hashPayload = [
      prevHash,
      input.actor,
      input.action,
      input.entity,
      entityIdStr || '',
      timestamp,
      input.source,
      metadataStr || ''
    ].join('|');

    const hash = crypto.createHash('sha256').update(hashPayload).digest('hex');

    const stmt = db.prepare(`
      INSERT INTO audit_logs (
        actor, action, entity, entity_id, timestamp, source, metadata, prev_hash, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.actor,
      input.action,
      input.entity,
      entityIdStr,
      timestamp,
      input.source,
      metadataStr,
      prevHash,
      hash
    );

    const insertedId = Number(result.lastInsertRowid);
    return this.getAuditLogById(insertedId)!;
  }

  /**
   * Fetches an audit log entry by its primary key.
   */
  getAuditLogById(id: number): AuditLogEntry | undefined {
    return db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditLogEntry | undefined;
  }

  /**
   * Queries audit logs with multi-dimensional filtering, text search, and pagination.
   */
  searchAuditLogs(filter: AuditLogFilter = {}): AuditLogEntry[] {
    const { conditions, params } = this.buildFilterClauses(filter);

    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 100) : 50;
    const offset = filter.offset && filter.offset >= 0 ? filter.offset : 0;

    let sql = `SELECT * FROM audit_logs`;
    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.prepare(sql).all(...params) as AuditLogEntry[];
  }

  /**
   * Counts the total number of audit logs matching the given filter.
   */
  countAuditLogs(filter: AuditLogFilter = {}): number {
    const { conditions, params } = this.buildFilterClauses(filter);

    let sql = `SELECT COUNT(*) as count FROM audit_logs`;
    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    const row = db.prepare(sql).get(...params) as { count: number };
    return row ? row.count : 0;
  }

  /**
   * Verifies the cryptographic ledger integrity across the entire historical chain.
   * Proves that no records were deleted, inserted out of order, or edited in the raw database.
   */
  verifyLedgerIntegrity(): { isValid: boolean; checkedCount: number; brokenAtId?: number; reason?: string } {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all() as AuditLogEntry[];
    let expectedPrevHash = 'GENESIS';

    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];

      // 1. Verify previous hash chaining
      if (entry.prev_hash !== expectedPrevHash) {
        return {
          isValid: false,
          checkedCount: i,
          brokenAtId: entry.id,
          reason: `Previous hash pointer mismatch at ID ${entry.id}. Expected: ${expectedPrevHash}, Actual: ${entry.prev_hash}`
        };
      }

      // 2. Recompute content hash
      const hashPayload = [
        entry.prev_hash,
        entry.actor,
        entry.action,
        entry.entity,
        entry.entity_id || '',
        entry.timestamp,
        entry.source,
        entry.metadata || ''
      ].join('|');

      const expectedHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

      if (entry.hash !== expectedHash) {
        return {
          isValid: false,
          checkedCount: i,
          brokenAtId: entry.id,
          reason: `Content hash mismatch at ID ${entry.id}. Expected: ${expectedHash}, Actual: ${entry.hash}`
        };
      }

      expectedPrevHash = entry.hash;
    }

    return {
      isValid: true,
      checkedCount: logs.length
    };
  }

  /**
   * Retrieves summary statistics for the audit log dashboard.
   */
  getAuditStats(): {
    totalEvents: number;
    securityEvents: number;
    commercialEvents: number;
    inventoryEvents: number;
  } {
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as { count: number };
    const secRow = db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action IN ('LOGIN', 'FAILED_LOGIN', 'ROLE_CHANGE')
    `).get() as { count: number };
    const commRow = db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action IN ('ORDER_CONFIRM', 'ORDER_CANCEL', 'RETURN', 'REFUND', 'POS_CONVERT')
    `).get() as { count: number };
    const invRow = db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action IN ('PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRICE_MODIFY', 'INVENTORY_ADJUST')
    `).get() as { count: number };

    return {
      totalEvents: totalRow ? totalRow.count : 0,
      securityEvents: secRow ? secRow.count : 0,
      commercialEvents: commRow ? commRow.count : 0,
      inventoryEvents: invRow ? invRow.count : 0
    };
  }

  private buildFilterClauses(filter: AuditLogFilter): { conditions: string[]; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.action && filter.action !== 'ALL') {
      conditions.push('action = ?');
      params.push(filter.action);
    }

    if (filter.entity && filter.entity !== 'ALL') {
      conditions.push('entity = ?');
      params.push(filter.entity);
    }

    if (filter.actor && filter.actor.trim()) {
      conditions.push('actor LIKE ?');
      params.push(`%${filter.actor.trim()}%`);
    }

    if (filter.entityId && filter.entityId.trim()) {
      conditions.push('entity_id = ?');
      params.push(filter.entityId.trim());
    }

    if (filter.source && filter.source.trim()) {
      conditions.push('source LIKE ?');
      params.push(`%${filter.source.trim()}%`);
    }

    if (filter.startDate && filter.startDate.trim()) {
      conditions.push('DATE(timestamp) >= DATE(?)');
      params.push(filter.startDate.trim());
    }

    if (filter.endDate && filter.endDate.trim()) {
      conditions.push('DATE(timestamp) <= DATE(?)');
      params.push(filter.endDate.trim());
    }

    if (filter.search && filter.search.trim()) {
      const searchTerm = `%${filter.search.trim()}%`;
      conditions.push('(actor LIKE ? OR entity_id LIKE ? OR metadata LIKE ? OR source LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    return { conditions, params };
  }
}

export const auditRepository = new AuditRepository();
