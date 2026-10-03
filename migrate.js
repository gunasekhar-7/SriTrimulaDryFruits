import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'store.db');

const db = new Database(dbPath);

try {
  db.exec("ALTER TABLE bills ADD COLUMN payment_method TEXT DEFAULT 'Cash'");
  console.log("Migration successful: Added payment_method column to bills table.");
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log("Column payment_method already exists.");
  } else {
    console.error("Migration failed:", e);
  }
}
