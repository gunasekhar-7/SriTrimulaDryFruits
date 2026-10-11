import db from '../src/database.js';

function migrate() {
  console.log('Starting migration for customer accounts and addresses...');

  db.transaction(() => {
    // Check if password_hash exists in customers
    const tableInfo = db.prepare("PRAGMA table_info(customers)").all() as any[];
    const hasPasswordHash = tableInfo.some(col => col.name === 'password_hash');

    if (!hasPasswordHash) {
      console.log('Adding new columns to customers table...');
      db.prepare('ALTER TABLE customers ADD COLUMN password_hash TEXT').run();
      db.prepare("ALTER TABLE customers ADD COLUMN account_status TEXT DEFAULT 'ACTIVE'").run();
      db.prepare("ALTER TABLE customers ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP").run();
      console.log('Columns added.');
    } else {
      console.log('Customers table already migrated.');
    }

    // Ensure customer_addresses table exists (it might have been created by database.ts)
    // database.ts already does CREATE TABLE IF NOT EXISTS
    console.log('Migration completed.');
  })();
}

migrate();
