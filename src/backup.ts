import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import logger from './logger.js';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/store.db');
const backupDir = path.join(__dirname, '../data/backups');

// Ensure backups directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

export function initBackupCron() {
    // Schedule backup for 11:30 PM every night
    cron.schedule('30 23 * * *', async () => {
        logger.info('Starting automated database backup...');
        
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
        const backupPath = path.join(backupDir, `backup_${timestamp}.db`);

        try {
            // Using better-sqlite3 built-in backup API which is safe and locks correctly
            await db.backup(backupPath);
            logger.info(`✅ Database backed up successfully to ${backupPath}`);
            
            // Clean up old backups (keep last 30 days)
            cleanOldBackups();
        } catch (err: any) {
            logger.error(`❌ Automated database backup failed: ${err.message}`);
        }
    });

    logger.info('Automated database backups initialized (Runs at 11:30 PM daily).');
}

function cleanOldBackups() {
    try {
        const files = fs.readdirSync(backupDir);
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        let deletedCount = 0;
        for (const file of files) {
            if (!file.startsWith('backup_') || !file.endsWith('.db')) continue;

            const filePath = path.join(backupDir, file);
            const stats = fs.statSync(filePath);

            if (stats.mtimeMs < thirtyDaysAgo) {
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            logger.info(`Cleaned up ${deletedCount} old backup(s) older than 30 days.`);
        }
    } catch (err: any) {
        logger.error(`Failed to clean old backups: ${err.message}`);
    }
}
