import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import logger from './logger.js';
import { backupService } from './services/backup.service.js';
import { queueService } from './queue/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backupDir = path.join(__dirname, '../data/backups');

export function initBackupCron() {
    // ─── 1. Hourly Business Hours Backup & WAL Checkpoint (RPO ≤ 1 Hour) ─────
    // Runs at minute 0 every hour between 09:00 AM and 10:00 PM IST
    cron.schedule('0 9-22 * * *', async () => {
        logger.info('[BackupCron] Executing hourly business-hours backup (RPO guarantee)...');
        try {
            const record = await backupService.createBackup({ skipUpload: true });
            logger.info(`[BackupCron] ✅ Hourly backup created: ${record.filename}`);
        } catch (err: any) {
            logger.error(`[BackupCron] ❌ Hourly backup failed: ${err.message}`, { event: 'backup.failed' });
        }
    });

    // ─── 2. End-of-Day Consolidated Archive & Cloud Sync (11:30 PM) ───────────
    cron.schedule('30 23 * * *', async () => {
        logger.info('[BackupCron] Starting daily consolidated database backup and offsite sync...');
        try {
            const record = await backupService.createBackup();
            logger.info(`[BackupCron] ✅ Daily backup completed and verified: ${record.filename}`);

            // Enqueue durable background job for continuous verification audit
            queueService.enqueue({
                name: 'backup_verification',
                payload: { backupPath: record.filepath },
                idempotencyKey: `verify_${record.filename}`
            });
        } catch (err: any) {
            logger.error(`[BackupCron] ❌ Daily backup failed: ${err.message}`, { event: 'backup.failed' });
        }
    });

    logger.info('Automated database backups initialized (Hourly RPO 9am-10pm + Daily 11:30pm offsite sync).');
}

/**
 * Execute on-demand manual backup with full integrity and restore verification
 */
export async function executeManualBackup() {
    return await backupService.createBackup();
}
