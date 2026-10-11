import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { BackupService } from '../src/services/backup.service.js';
import db from '../src/database.js';

describe('Disaster Recovery & Backup Reliability Suite', () => {
  const testBackupDir = path.join(process.cwd(), 'data', 'test_backups');
  let testBackupService: BackupService;
  let createdBackupPath: string;

  beforeAll(() => {
    if (!fs.existsSync(testBackupDir)) {
      fs.mkdirSync(testBackupDir, { recursive: true });
    }
    testBackupService = new BackupService(testBackupDir);
  });

  afterAll(() => {
    // Clean up test backup directory
    try {
      if (fs.existsSync(testBackupDir)) {
        fs.rmSync(testBackupDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. Backup Creation: should create atomic SQLite backup with valid SHA-256 and history entry', async () => {
    const record = await testBackupService.createBackup({
      destinationDir: testBackupDir,
      skipUpload: true,
      skipRestoreVerification: false
    });

    createdBackupPath = record.filepath;

    expect(fs.existsSync(record.filepath)).toBe(true);
    expect(record.size_bytes).toBeGreaterThan(0);
    expect(record.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.integrity_status).toBe('PASSED');
    expect(record.restore_verified).toBe(1);
    expect(record.restore_tested_at).toBeDefined();

    // Verify written to database audit table
    const dbRecord = db.prepare('SELECT * FROM backup_history WHERE filename = ?').get(record.filename) as any;
    expect(dbRecord).toBeDefined();
    expect(dbRecord.checksum_sha256).toBe(record.checksum_sha256);
    expect(dbRecord.integrity_status).toBe('PASSED');
  });

  it('2. Backup Integrity Check: should validate healthy backup and detect corrupted files', () => {
    // A. Healthy backup verification
    const healthyCheck = testBackupService.verifyIntegrity(createdBackupPath);
    expect(healthyCheck.ok).toBe(true);
    expect(healthyCheck.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(healthyCheck.userCount).toBeGreaterThanOrEqual(0);

    // B. Corrupted file detection (tampered bytes)
    const corruptPath = path.join(testBackupDir, 'corrupt_test.db');
    fs.writeFileSync(corruptPath, 'CORRUPTED_GARBAGE_HEADER_NOT_A_VALID_SQLITE_DATABASE');

    const corruptCheck = testBackupService.verifyIntegrity(corruptPath);
    expect(corruptCheck.ok).toBe(false);
    expect(corruptCheck.error).toBeDefined();

    // Cleanup corrupt file
    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
  });

  it('3. Restore Verification (Sandbox Drill): should prove backup can be restored and written to', () => {
    const restoreResult = testBackupService.verifyRestore(createdBackupPath);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.drillTimestamp).toBeDefined();

    // Verify sandbox temp files were cleaned up
    const remainingSandboxes = fs.readdirSync(testBackupDir).filter(f => f.startsWith('sandbox_restore_'));
    expect(remainingSandboxes.length).toBe(0);
  });

  it('4. Disaster Recovery: should safely restore corrupted database with pre-restore forensic snapshot', async () => {
    const mockLiveDbPath = path.join(testBackupDir, 'mock_live_store.db');

    // 1. Initialize mock live database
    if (fs.existsSync(mockLiveDbPath)) fs.unlinkSync(mockLiveDbPath);
    const liveDb = new Database(mockLiveDbPath);
    liveDb.exec("CREATE TABLE IF NOT EXISTS test_data (val TEXT); INSERT INTO test_data VALUES ('before_crash');");
    liveDb.close();

    // 2. Simulate catastrophic corruption (overwrite live file with garbage)
    fs.writeFileSync(mockLiveDbPath, 'SIMULATED_DISK_FAILURE_CORRUPTION_DATA');

    // Verify it is indeed corrupt
    let corruptDb: Database.Database | null = null;
    try {
      corruptDb = new Database(mockLiveDbPath, { readonly: true });
      corruptDb.pragma('integrity_check');
    } catch {
      // Expected corruption error
    } finally {
      if (corruptDb) {
        try { corruptDb.close(); } catch {}
      }
    }

    // 3. Execute disaster recovery restore
    const restoreOp = await testBackupService.restoreDatabase(createdBackupPath, mockLiveDbPath);
    expect(restoreOp.success).toBe(true);
    expect(restoreOp.preRestoreSnapshot).toBeDefined();
    expect(fs.existsSync(restoreOp.preRestoreSnapshot!)).toBe(true);

    // 4. Validate that restored database is fully functional and valid SQLite
    const restoredDb = new Database(mockLiveDbPath, { readonly: true });
    const check = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(check[0].integrity_check).toBe('ok');
    restoredDb.close();

    // Clean up mock live db
    try {
      if (fs.existsSync(mockLiveDbPath)) fs.unlinkSync(mockLiveDbPath);
    } catch {}
  });

  it('5. Retention Policy Enforcement: should prune expired backups while preserving safe baseline', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Create 6 mock backup files: 3 old (40, 50, 60 days ago) and 3 new (1, 2, 3 days ago)
    const oldFiles = ['backup_2026-08-01_12-00-00.db', 'backup_2026-08-02_12-00-00.db', 'backup_2026-08-03_12-00-00.db'];
    const newFiles = ['backup_2026-10-06_12-00-00.db', 'backup_2026-10-07_12-00-00.db', 'backup_2026-10-08_12-00-00.db'];

    for (const f of oldFiles) {
      const p = path.join(testBackupDir, f);
      fs.writeFileSync(p, 'mock_old_backup');
      // Set modification time to 45 days ago
      const oldTime = new Date(now - (45 * dayMs));
      fs.utimesSync(p, oldTime, oldTime);
    }

    for (const f of newFiles) {
      const p = path.join(testBackupDir, f);
      fs.writeFileSync(p, 'mock_new_backup');
    }

    // Run retention enforcement with maxDays = 30 and minRetainCount = 3
    const retention = testBackupService.enforceRetention(30, 3);
    expect(retention.deletedCount).toBeGreaterThanOrEqual(1);

    // Assert new files still exist
    for (const f of newFiles) {
      expect(fs.existsSync(path.join(testBackupDir, f))).toBe(true);
    }
  });

  it('6. Failure Detection & Health Audit: should report accurate DR health metrics and alerts', () => {
    const health = testBackupService.getDisasterRecoveryHealth();
    expect(health.isHealthy).toBe(true);
    expect(health.totalBackupsCount).toBeGreaterThan(0);
    expect(health.lastIntegrityPassed).toBe(true);
    expect(health.lastRestoreVerified).toBe(true);
    expect(health.alerts.length).toBe(0);
  });
});
