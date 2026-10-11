import fs from 'fs';
import path from 'path';
import logger from '../src/logger.js';
import { backupService } from '../src/services/backup.service.js';

const defaultBackupDir = path.join(process.cwd(), 'data', 'backups');

export async function syncLatestBackupOffsite(customFilePath?: string): Promise<{
  success: boolean;
  file?: string;
  error?: string;
  uploadProof?: any;
}> {
  let targetFile: string;

  if (customFilePath) {
    targetFile = path.resolve(process.cwd(), customFilePath);
  } else {
    if (!fs.existsSync(defaultBackupDir)) {
      return { success: false, error: `Backup directory does not exist: ${defaultBackupDir}` };
    }
    const files = fs.readdirSync(defaultBackupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return { success: false, error: `No backup files found in ${defaultBackupDir}` };
    }
    targetFile = path.join(defaultBackupDir, files[0]);
  }

  if (!fs.existsSync(targetFile)) {
    return { success: false, error: `Target backup file does not exist: ${targetFile}` };
  }

  const filename = path.basename(targetFile);
  logger.info(`[Offsite] Initiating verified upload for: ${targetFile}`);

  try {
    const result = await backupService.verifyUpload(targetFile);
    if (result.ok) {
      logger.info(`✅ [Offsite] Upload verification passed for ${filename}`);
      return { success: true, file: filename, uploadProof: result.uploadProof };
    } else {
      logger.error(`❌ [Offsite] Upload verification failed: ${result.error}`);
      return { success: false, file: filename, error: result.error };
    }
  } catch (err: any) {
    logger.error(`❌ [Offsite] Upload sync error: ${err.message}`);
    return { success: false, file: filename, error: err.message };
  }
}

// ─── Direct CLI Execution Support ─────────────────────────────────────────────
const isCli = process.argv[1] && (
  process.argv[1].endsWith('backup_offsite.ts') ||
  process.argv[1].endsWith('backup_offsite.js')
);

if (isCli) {
  const argFile = process.argv[2];
  syncLatestBackupOffsite(argFile)
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
