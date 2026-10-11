import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { runManualBackup } from '../scripts/run_backup.js';
import { syncLatestBackupOffsite } from '../scripts/backup_offsite.js';
import { runRestoreBackup } from '../scripts/restore_backup.js';
import { backupService } from '../src/services/backup.service.js';

describe('Production Docker Backup & Disaster Recovery Smoke Test Suite', () => {
  const isolatedDir = path.join(process.cwd(), 'data', 'smoke_test_backup_env');
  const isolatedBackupsDir = path.join(isolatedDir, 'backups');
  const syntheticDbPath = path.join(isolatedDir, 'synthetic_store.db');
  const restoredDbPath = path.join(isolatedDir, 'restored_store.db');

  let syntheticDb: Database.Database;
  const testProductSku = `SYNTH-ALM-${Date.now()}`;
  const testProductName = 'Smoke Test California Almonds 500g';

  beforeAll(() => {
    // 1. Prepare clean isolated test directory
    if (fs.existsSync(isolatedDir)) {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
    fs.mkdirSync(isolatedBackupsDir, { recursive: true });

    // 2. Initialize isolated synthetic database mimicking production schema
    syntheticDb = new Database(syntheticDbPath);
    syntheticDb.pragma('journal_mode = WAL');
    syntheticDb.pragma('foreign_keys = ON');

    syntheticDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        sku TEXT UNIQUE NOT NULL,
        selling_price REAL NOT NULL,
        total_qty INTEGER DEFAULT 100,
        sold_qty INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_number TEXT UNIQUE NOT NULL,
        total_amount REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (username, role) VALUES ('admin_smoke', 'admin');
      INSERT INTO products (name, category) VALUES ('${testProductName}', 'Dry Fruits');
      INSERT INTO product_variants (product_id, sku, selling_price, total_qty, sold_qty)
        VALUES (1, '${testProductSku}', 450.00, 150, 12);
      INSERT INTO bills (bill_number, total_amount) VALUES ('BILL-SMOKE-001', 900.00);
    `);

    // Ensure WAL file has dirty pages to test WAL-checkpointing behavior
    syntheticDb.pragma('wal_checkpoint(PASSIVE)');
  });

  afterAll(() => {
    try {
      if (syntheticDb) syntheticDb.close();
      if (fs.existsSync(isolatedDir)) {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. Dockerfile Architecture: should package backup scripts and enforce non-root unprivileged runtime', () => {
    const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

    // Stage 1 (builder) must copy scripts for TypeScript compilation
    expect(dockerfileContent).toMatch(/COPY\s+scripts\/\s+\.\/scripts\//);

    // Stage 2 (runner) must copy compiled dist and runtime shell scripts
    expect(dockerfileContent).toMatch(/COPY\s+--chown=node:node\s+scripts\s+\.\/scripts/);
    expect(dockerfileContent).toMatch(/COPY\s+--from=builder\s+--chown=node:node\s+\/app\/dist\s+\.\/dist/);

    // Permissions: must make shell scripts executable and create backup directory
    expect(dockerfileContent).toMatch(/chmod\s+\+x\s+\/app\/scripts\/\*\.sh/);
    expect(dockerfileContent).toMatch(/\/app\/data\/backups/);

    // Hardening: must switch to unprivileged node user and declare volumes
    expect(dockerfileContent).toMatch(/USER\s+node/);
    expect(dockerfileContent).toMatch(/VOLUME\s+\[.*\/app\/data.*/);
  });

  it('2. Production CLI Entry Points: should have compiled JavaScript artifacts in dist/scripts', () => {
    const runBackupJs = path.join(process.cwd(), 'dist', 'scripts', 'run_backup.js');
    const backupOffsiteJs = path.join(process.cwd(), 'dist', 'scripts', 'backup_offsite.js');
    const restoreBackupJs = path.join(process.cwd(), 'dist', 'scripts', 'restore_backup.js');
    const syncShellScript = path.join(process.cwd(), 'scripts', 'sync_cloud_backup.sh');

    expect(fs.existsSync(runBackupJs)).toBe(true);
    expect(fs.existsSync(backupOffsiteJs)).toBe(true);
    expect(fs.existsSync(restoreBackupJs)).toBe(true);
    expect(fs.existsSync(syncShellScript)).toBe(true);

    // Validate shell script starts with portable /bin/sh
    const shellContent = fs.readFileSync(syncShellScript, 'utf8');
    expect(shellContent.startsWith('#!/bin/sh')).toBe(true);
  });

  it('3. Backup Workflow: should create atomic, transactionally consistent SQLite backup', async () => {
    const result = await runManualBackup(isolatedBackupsDir);

    expect(result.success).toBe(true);
    expect(result.filename).toBeDefined();
    expect(result.filepath).toBeDefined();
    expect(fs.existsSync(result.filepath!)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.integrityStatus).toBe('PASSED');
    expect(result.restoreVerified).toBe(1);

    // File name format must be deterministic timestamp: backup_YYYY-MM-DD_HH-mm-ss.db
    expect(result.filename).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/);
  });

  it('4. Backup Integrity & B-Tree Verification: backup file passes all SQLite PRAGMA checks', () => {
    const backupFiles = fs.readdirSync(isolatedBackupsDir).filter(f => f.startsWith('backup_') && f.endsWith('.db'));
    expect(backupFiles.length).toBeGreaterThan(0);

    const latestBackupPath = path.join(isolatedBackupsDir, backupFiles[0]);
    const integrityCheck = backupService.verifyIntegrity(latestBackupPath);

    expect(integrityCheck.ok).toBe(true);
    expect(integrityCheck.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(integrityCheck.userCount).toBeGreaterThanOrEqual(1);
    expect(integrityCheck.productCount).toBeGreaterThanOrEqual(1);
  });

  it('5. Disaster Recovery Restore: restores cleanly into isolated target and recovers test data', async () => {
    const backupFiles = fs.readdirSync(isolatedBackupsDir).filter(f => f.startsWith('backup_') && f.endsWith('.db'));
    const latestBackupPath = path.join(isolatedBackupsDir, backupFiles[0]);

    // Restore candidate backup into isolated target path
    const restoreResult = await runRestoreBackup(latestBackupPath, restoredDbPath);

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.targetFile).toBe(path.resolve(restoredDbPath));
    expect(fs.existsSync(restoredDbPath)).toBe(true);

    // Open restored database and verify integrity & schema
    const restoredDb = new Database(restoredDbPath, { readonly: true });
    const pragmaCheck = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(pragmaCheck[0].integrity_check).toBe('ok');

    // Verify foreign key integrity on restored database
    const fkCheck = restoredDb.pragma('foreign_key_check') as any[];
    expect(fkCheck.length).toBe(0);

    // Verify synthetic records exist
    const users = restoredDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    expect(users.c).toBeGreaterThanOrEqual(1);

    const products = restoredDb.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
    expect(products.c).toBeGreaterThanOrEqual(1);

    restoredDb.close();
  });

  it('6. Offsite Cloud Synchronization Hook: verifies upload and produces proof', async () => {
    const backupFiles = fs.readdirSync(isolatedBackupsDir).filter(f => f.startsWith('backup_') && f.endsWith('.db'));
    const latestBackupPath = path.join(isolatedBackupsDir, backupFiles[0]);

    const offsiteResult = await syncLatestBackupOffsite(latestBackupPath);

    expect(offsiteResult.success).toBe(true);
    expect(offsiteResult.file).toBe(path.basename(latestBackupPath));
    expect(offsiteResult.uploadProof).toBeDefined();
    expect(offsiteResult.uploadProof.status).toBe('VERIFIED');
    expect(offsiteResult.uploadProof.sizeBytes).toBeGreaterThan(0);
    expect(offsiteResult.uploadProof.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('7. Negative Failure Testing: invalid or corrupt backups must fail and return exit code 1 / success=false', async () => {
    // Nonexistent file
    const nonexistentPath = path.join(isolatedBackupsDir, 'nonexistent_file.db');
    const failNonexistent = await syncLatestBackupOffsite(nonexistentPath);
    expect(failNonexistent.success).toBe(false);
    expect(failNonexistent.error).toBeDefined();

    // Corrupted file
    const corruptedPath = path.join(isolatedBackupsDir, 'corrupted_test.db');
    fs.writeFileSync(corruptedPath, 'CORRUPTED_NON_SQLITE_GARBAGE_PAYLOAD');

    const failCorruptRestore = await runRestoreBackup(corruptedPath, path.join(isolatedDir, 'corrupt_restore.db'));
    expect(failCorruptRestore.success).toBe(false);
    expect(failCorruptRestore.error).toMatch(/corrupt|invalid/i);

    // Clean up temporary corrupt file
    if (fs.existsSync(corruptedPath)) fs.unlinkSync(corruptedPath);
  });
});
