import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './database.js';
import zlib from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import logger from './logger.js';
const pipe = promisify(pipeline);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupDir = path.join(__dirname, '../backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}
async function performBackup() {
    logger.info('Starting daily automated database backup...');
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const dbBackupPath = path.join(backupDir, `store-backup-${dateStr}.db`);
        const gzBackupPath = path.join(backupDir, `backup-${dateStr}.db.gz`);
        // 1. Safely backup the SQLite database using better-sqlite3's built-in .backup() method
        await db.backup(dbBackupPath);
        logger.info(`SQLite backup created at ${dbBackupPath}`);
        // 2. Compress the backup to a .gz file
        const gzip = zlib.createGzip();
        const source = fs.createReadStream(dbBackupPath);
        const destination = fs.createWriteStream(gzBackupPath);
        await pipe(source, gzip, destination);
        logger.info(`Backup compressed to ${gzBackupPath}`);
        // 3. Remove the uncompressed .db file to save space
        fs.unlinkSync(dbBackupPath);
        // 4. Cleanup old backups (older than 30 days)
        const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const files = fs.readdirSync(backupDir);
        for (const file of files) {
            if (file.endsWith('.gz') || file.endsWith('.zip')) {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    logger.info(`Deleted old backup: ${file}`);
                }
            }
        }
        logger.info('Daily backup process completed successfully.');
    }
    catch (err) {
        logger.error(`Backup process failed: ${err.message}`);
    }
}
export function initBackupCron() {
    // Check every minute if it's 23:30 (11:30 PM)
    let lastRanDate = null;
    setInterval(() => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDate = now.toISOString().split('T')[0];
        // If it's exactly 23:30 and hasn't run today yet
        if (currentHour === 23 && currentMinute === 30 && lastRanDate !== currentDate) {
            lastRanDate = currentDate;
            performBackup();
        }
    }, 60 * 1000); // 1 minute interval
    logger.info('Backup interval initialized. Scheduled to run daily at 11:30 PM.');
}
