import fs from 'fs';
import path from 'path';

/**
 * Static Application Security Testing (SAST) & Secret Scanner
 * Inspects source code, configurations, and git tracking for
 * credentials, secret leaks, and security anti-patterns.
 */

const rootDir = process.cwd();
console.log('🛡️ Starting Static Security & Secret Scan...\n');

let issues = 0;

function reportIssue(severity, message, file = '') {
  console.error(`[${severity}] ${message} ${file ? `at ${file}` : ''}`);
  issues++;
}

// 1. High-risk Secret Leak Patterns
const secretPatterns = [
  { name: 'AWS Access Key ID', regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g },
  { name: 'Generic Private Key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g },
  { name: 'Hardcoded JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'Hardcoded Secret Assignment', regex: /(?:app_secret|client_secret|api_key|private_key)\s*[:=]\s*['"][A-Za-z0-9!@#$%^&*()_+]{16,}['"]/gi }
];

// 2. Dangerous Code Antipatterns
const dangerousCodePatterns = [
  { name: 'Dangerous eval() invocation', regex: /\beval\s*\(/g },
  { name: 'Dangerous Function constructor', regex: /new\s+Function\s*\(/g },
  { name: 'Unsafe child_process.exec', regex: /child_process\s*\.\s*exec\s*\(/g }
];

function scanFile(filePath) {
  const relPath = path.relative(rootDir, filePath);
  // Exclude test mocks from secret scans, but still scan them if needed
  const isTestFile = relPath.startsWith('tests') || relPath.includes('.test.') || relPath.includes('.spec.');

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Secret scans on source and config files (exclude test mock fixtures)
    if (!isTestFile) {
      for (const pattern of secretPatterns) {
        lines.forEach((line, idx) => {
          // Skip comments or explicit placeholder strings in example configs
          if (line.includes('replace_with_') || line.includes('example') || line.trim().startsWith('//') || line.trim().startsWith('#')) {
            return;
          }
          if (pattern.regex.test(line)) {
            reportIssue('CRITICAL', `Detected potential ${pattern.name} on line ${idx + 1}`, relPath);
          }
        });
      }
    }

    // Dangerous code scans (source code and server)
    if (relPath.startsWith('src') || relPath === 'server.ts') {
      for (const pattern of dangerousCodePatterns) {
        lines.forEach((line, idx) => {
          if (pattern.regex.test(line)) {
            reportIssue('HIGH', `Security Antipattern: ${pattern.name} on line ${idx + 1}`, relPath);
          }
        });
      }
    }
  } catch {
    // Ignore unreadable binary files
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'coverage', 'legacy_archive', 'data', 'backups', 'logs'].includes(entry)) continue;
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.js') || entry.endsWith('.json') || entry.endsWith('.env.example'))) {
      scanFile(fullPath);
    }
  }
}

// Execute scan on source trees
walk(rootDir);

// 3. Verify .gitignore ignores sensitive files
const gitignore = path.join(rootDir, '.gitignore');
if (fs.existsSync(gitignore)) {
  const content = fs.readFileSync(gitignore, 'utf8');
  if (!content.includes('.env')) {
    reportIssue('CRITICAL', '.gitignore does not contain .env!');
  }
  if (!content.includes('*.db')) {
    reportIssue('HIGH', '.gitignore does not contain *.db!');
  }
} else {
  reportIssue('CRITICAL', '.gitignore file is missing!');
}

console.log('\n--- SCAN SUMMARY ---');
if (issues > 0) {
  console.error(`❌ Security scan found ${issues} issue(s). Please review and resolve before deploying.`);
  process.exit(1);
} else {
  console.log('✅ Static security and secret scanning completed with 0 violations.\n');
  process.exit(0);
}
