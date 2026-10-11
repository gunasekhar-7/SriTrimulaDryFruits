import fs from 'fs';
import path from 'path';

/**
 * Production Build Artifact Sanitization Verifier
 * Ensures built artifacts do not contain .env files, test secrets,
 * database files, or development leftovers.
 */

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

console.log('🔍 Starting Production Artifact Sanitization Audit...\n');

let violations = 0;

function reportViolation(message) {
  console.error(`❌ VIOLATION: ${message}`);
  violations++;
}

function reportSuccess(message) {
  console.log(`✅ ${message}`);
}

// 1. Verify dist directory exists and contains server entrypoint
if (!fs.existsSync(distDir)) {
  reportViolation('dist/ directory does not exist! Run "npm run build" first.');
} else {
  reportSuccess('dist/ directory exists.');
  const serverJs = path.join(distDir, 'server.js');
  if (fs.existsSync(serverJs)) {
    reportSuccess('dist/server.js compiled entrypoint found.');
  } else {
    reportViolation('dist/server.js entrypoint missing!');
  }
}

// Helper to recursively walk a directory
function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, callback);
    } else {
      callback(fullPath, file);
    }
  }
}

// 2. Scan dist for forbidden files (.env, test files, db files)
const forbiddenExtensions = ['.db', '.db-shm', '.db-wal', '.sqlite', '.log'];
const forbiddenFileNames = ['.env', '.env.local', '.env.development', '.env.staging', '.env.production'];
const forbiddenPatterns = [/\.test\.(js|ts|d\.ts)$/, /\.spec\.(js|ts|d\.ts)$/];

if (fs.existsSync(distDir)) {
  walkDir(distDir, (filePath, fileName) => {
    const relPath = path.relative(rootDir, filePath);

    // Check file names
    if (forbiddenFileNames.includes(fileName) || fileName.startsWith('.env')) {
      reportViolation(`Found environment file in build output: ${relPath}`);
    }

    // Check extensions
    const ext = path.extname(fileName);
    if (forbiddenExtensions.includes(ext)) {
      reportViolation(`Found runtime database or log file in build output: ${relPath}`);
    }

    // Check test file patterns
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(fileName)) {
        reportViolation(`Found test artifact in production output: ${relPath}`);
      }
    }

    // Check content for leaked test secrets or development credentials
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('test_session_secret_for_ci_pipeline_only')) {
        reportViolation(`Found CI test secret hardcoded in ${relPath}`);
      }
      if (content.includes('replace_with_64_character_hex_string')) {
        reportViolation(`Found template credential placeholder in ${relPath}`);
      }
    } catch {
      // Ignore binary files
    }
  });
}

// 3. Verify .dockerignore exists and covers sensitive files
const dockerignorePath = path.join(rootDir, '.dockerignore');
if (!fs.existsSync(dockerignorePath)) {
  reportViolation('.dockerignore is missing!');
} else {
  const content = fs.readFileSync(dockerignorePath, 'utf8');
  const requiredExclusions = ['.env', 'tests', 'data', '*.db', 'node_modules'];
  for (const exclusion of requiredExclusions) {
    if (content.includes(exclusion)) {
      reportSuccess(`.dockerignore properly excludes "${exclusion}"`);
    } else {
      reportViolation(`.dockerignore does not exclude critical pattern "${exclusion}"`);
    }
  }
}

// 4. Verify package.json doesn't bundle test/dev dependencies in production mode
if (process.env.CHECK_PRODUCTION_DEPENDENCIES === 'true') {
  const nodeModulesDir = path.join(rootDir, 'node_modules');
  const forbiddenDevPackages = ['vitest', 'tsx', 'typescript'];
  for (const pkg of forbiddenDevPackages) {
    if (fs.existsSync(path.join(nodeModulesDir, pkg))) {
      reportViolation(`Unnecessary devDependency "${pkg}" found in production node_modules!`);
    } else {
      reportSuccess(`Verified devDependency "${pkg}" is absent.`);
    }
  }
}

console.log('\n--- AUDIT SUMMARY ---');
if (violations > 0) {
  console.error(`💥 Sanitization audit failed with ${violations} violation(s).`);
  process.exit(1);
} else {
  console.log('🎉 All artifact sanitization and hygiene checks passed cleanly!\n');
  process.exit(0);
}
