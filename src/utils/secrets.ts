import path from 'path';
import fs from 'fs';

/**
 * Resolves a secret from an environment variable, an explicit secret file path,
 * a Docker secret (/run/secrets/<key>), or an optional fallback.
 */
export function resolveSecret(envKey: string, secretFileEnvKey?: string, fallback: string = ''): string {
  if (secretFileEnvKey) {
    const explicitFilePath = process.env[secretFileEnvKey];
    if (explicitFilePath && fs.existsSync(explicitFilePath)) {
      try {
        const content = fs.readFileSync(explicitFilePath, 'utf8').trim();
        if (content) return content;
      } catch {}
    }
  }

  const dockerSecretPath = path.join('/run', 'secrets', envKey.toLowerCase());
  if (fs.existsSync(dockerSecretPath)) {
    try {
      const content = fs.readFileSync(dockerSecretPath, 'utf8').trim();
      if (content) return content;
    } catch {}
  }

  return process.env[envKey] || fallback;
}
