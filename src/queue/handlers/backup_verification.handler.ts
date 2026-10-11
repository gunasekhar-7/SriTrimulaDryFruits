import { Job } from '../types.js';
import { backupService } from '../../services/backup.service.js';
import { metricsAggregator } from '../../observability/index.js';
import logger from '../../logger.js';

export interface BackupVerificationJobPayload {
  backupPath: string;
}

export async function processBackupVerification(
  payload: BackupVerificationJobPayload,
  job: Job<BackupVerificationJobPayload>
): Promise<void> {
  const { backupPath } = payload;
  const startHr = process.hrtime();
  logger.info(`[Queue] Running comprehensive backup verification for ${backupPath} (Job #${job.id})`);

  try {
    // 1. Run full SQLite B-Tree and table integrity check
    const integrity = backupService.verifyIntegrity(backupPath);
    if (!integrity.ok) {
      throw new Error(`Backup integrity check failed: ${integrity.error}`);
    }

    // 2. Run restore sandbox drill (validating read-write restorable state)
    const restore = backupService.verifyRestore(backupPath);
    if (!restore.ok) {
      throw new Error(`Restore sandbox drill failed: ${restore.error}`);
    }

    const diff = process.hrtime(startHr);
    const durationSec = diff[0] + diff[1] / 1e9;

    metricsAggregator.recordBackgroundJobRun('backup_verification', durationSec, true);
    logger.info(`[Queue] ✅ Backup verification & sandbox restore drill PASSED for ${backupPath} (Users: ${integrity.userCount}, Products: ${integrity.productCount})`);
  } catch (error: any) {
    const diff = process.hrtime(startHr);
    const durationSec = diff[0] + diff[1] / 1e9;

    metricsAggregator.recordBackgroundJobRun('backup_verification', durationSec, false, error.message);
    logger.error(`[Queue] ❌ Backup verification failed for ${backupPath}: ${error.message}`);
    throw error;
  }
}
