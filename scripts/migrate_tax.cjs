const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/store.db');
const db = new Database(dbPath);

console.log('Starting tax_rate migration...');

try {
  db.exec("ALTER TABLE products ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0");
  console.log("Added tax_rate column to products table.");
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log("Column tax_rate already exists in products.");
  } else {
    console.error('Migration failed:', e);
    process.exit(1);
  }
}

console.log('Migration completed successfully!');
