import path from 'path';
import logger from '../src/logger.js';
import { backupService } from '../src/services/backup.service.js';

/**
 * Production CLI Entry Point: Disaster Recovery Database Restore.
 * Validates candidate backup integrity, captures a pre-restore forensic snapshot
 * of the live database, purges active WAL/SHM journal files, and atomically restores.
 */
export async function runRestoreBackup(backupFilePath: string, targetDbPath?: string) {
  if (!backupFilePath) {
    throw new Error('Missing required argument: backup file path must be specified.');
  }

  const resolvedBackup = path.resolve(process.cwd(), backupFilePath);
  const resolvedTarget = targetDbPath ? path.resolve(process.cwd(), targetDbPath) : undefined;

  logger.info(`[CLI Restore] Starting database restore from ${resolvedBackup}...`);

  const result = await backupService.restoreDatabase(resolvedBackup, resolvedTarget);

  if (result.success) {
    logger.info(`[CLI Restore] ✅ Database successfully restored from ${resolvedBackup}`);
    return {
      success: true,
      backupFile: resolvedBackup,
      targetFile: resolvedTarget || path.join(process.cwd(), 'data', 'store.db'),
      preRestoreSnapshot: result.preRestoreSnapshot
    };
  } else {
    logger.error(`[CLI Restore] ❌ Database restore failed: ${result.error}`);
    return {
      success: false,
      backupFile: resolvedBackup,
      error: result.error,
      preRestoreSnapshot: result.preRestoreSnapshot
    };
  }
}

// ─── Direct CLI Execution Support ─────────────────────────────────────────────
const isCli = process.argv[1] && (
  process.argv[1].endsWith('restore_backup.ts') ||
  process.argv[1].endsWith('restore_backup.js')
);

if (isCli) {
  const backupPath = process.argv[2];
  const targetPath = process.argv[3];

  if (!backupPath) {
    console.error('Usage: node dist/scripts/restore_backup.js <path-to-backup.db> [optional-target-db-path]');
    process.exit(1);
  }

  runRestoreBackup(backupPath, targetPath)
    .then((result) => {
      if (result.success) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      } else {
        console.error(JSON.stringify(result, null, 2));
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(JSON.stringify({ success: false, error: err.message }));
      process.exit(1);
    });
}
