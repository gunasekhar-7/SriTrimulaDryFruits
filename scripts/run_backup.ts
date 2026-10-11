import path from 'path';
import logger from '../src/logger.js';
import { backupService } from '../src/services/backup.service.js';

/**
 * Production CLI Entry Point: Creates a verified atomic SQLite backup.
 * Flushes active WAL journal, creates backup, verifies B-tree integrity,
 * performs sandbox restore drill, replicates offsite (if configured), and records audit history.
 */
export async function runManualBackup(destinationDir?: string) {
  logger.info('[CLI Backup] Initiating database backup operation...');
  try {
    const record = await backupService.createBackup({
      destinationDir: destinationDir ? path.resolve(process.cwd(), destinationDir) : undefined
    });

    logger.info(`[CLI Backup] ✅ Backup successfully created and verified: ${record.filename}`);
    return {
      success: true,
      filename: record.filename,
      filepath: record.filepath,
      sizeBytes: record.size_bytes,
      checksumSha256: record.checksum_sha256,
      integrityStatus: record.integrity_status,
      uploadStatus: record.upload_status,
      restoreVerified: record.restore_verified,
      durationMs: record.duration_ms
    };
  } catch (err: any) {
    logger.error(`[CLI Backup] ❌ Backup operation failed: ${err.message}`, { error: err.message });
    return {
      success: false,
      error: err.message
    };
  }
}

// ─── Direct CLI Execution Support ─────────────────────────────────────────────
const isCli = process.argv[1] && (
  process.argv[1].endsWith('run_backup.ts') ||
  process.argv[1].endsWith('run_backup.js')
);

if (isCli) {
  const destDir = process.argv[2];
  runManualBackup(destDir)
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
