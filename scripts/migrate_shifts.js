import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/store.db');

const db = new Database(dbPath);

console.log('Starting shifts migration...');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      opening_time TEXT NOT NULL,
      closing_time TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      expected_closing_cash REAL,
      actual_closing_cash REAL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
    );
  `);
  console.log('Created shifts table.');

  // Add shift_id to bills if it doesn't exist
  try {
    db.exec("ALTER TABLE bills ADD COLUMN shift_id INTEGER REFERENCES shifts(id)");
    console.log("Added shift_id column to bills table.");
  } catch (e) {
    if (e.message.includes('duplicate column name')) {
      console.log("Column shift_id already exists in bills.");
    } else {
      throw e;
    }
  }

  console.log('Migration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
