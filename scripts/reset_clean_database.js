import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const storeDbPath = path.join(dataDir, 'store.db');
const sessionsDbPath = path.join(dataDir, 'sessions.db');
const backupsDir = path.join(dataDir, 'backups');

console.log('================================================================');
console.log('🧹 SRI TIRUMALA DRY FRUITS — PRODUCTION DATABASE PURGE & RESET');
console.log('================================================================\n');

// 1. Pre-reset Forensic Backup
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}
const backupFilename = `pre_clean_reset_${Date.now()}.db`;
const backupPath = path.join(backupsDir, backupFilename);

if (fs.existsSync(storeDbPath)) {
  console.log(`📦 Creating safety snapshot at data/backups/${backupFilename}...`);
  fs.copyFileSync(storeDbPath, backupPath);
  console.log('✅ Safety backup created successfully.\n');
}

// 2. Open Store Database
const db = new Database(storeDbPath);
db.pragma('foreign_keys = OFF');
db.pragma('journal_mode = WAL');

console.log('🧹 Truncating transactional, customer, inventory, and order data...');

const tablesToPurge = [
  'audit_logs',
  'background_jobs',
  'backup_history',
  'bills',
  'customer_addresses',
  'customer_cart_items',
  'customer_carts',
  'customers',
  'daily_analytics_snapshots',
  'idempotency_keys',
  'online_order_items',
  'online_orders',
  'order_status_logs',
  'phone_verifications',
  'price_history',
  'product_images',
  'product_variants',
  'products',
  'sales',
  'scheduler_locks',
  'shifts',
  'stock_movements',
  'stock_reservations',
  'whatsapp_notifications'
];

db.transaction(() => {
  // Handle audit_logs with tamper-proof trigger
  try {
    db.prepare('DROP TRIGGER IF EXISTS prevent_audit_log_delete').run();
    db.prepare('DELETE FROM audit_logs').run();
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
      BEFORE DELETE ON audit_logs
      BEGIN
        SELECT RAISE(FAIL, 'Immutable audit log: DELETE operations are strictly prohibited.');
      END;
    `);
    console.log('  • Cleared table: audit_logs (tamper-proof trigger re-enabled)');
  } catch (err) {
    console.warn(`  ⚠️ Could not clear audit_logs: ${err.message}`);
  }

  for (const table of tablesToPurge.filter(t => t !== 'audit_logs')) {
    try {
      db.prepare(`DELETE FROM "${table}"`).run();
      console.log(`  • Cleared table: ${table}`);
    } catch (err) {
      console.warn(`  ⚠️ Table ${table} could not be cleared: ${err.message}`);
    }
  }

  // 3. Purge Test Users & Retain Basic Staff/Admin Logins
  console.log('\n👤 Resetting users table to standard administrative accounts...');
  db.prepare("DELETE FROM users WHERE username NOT IN ('admin', 'staff')").run();

  const adminHash = bcrypt.hashSync('admin123', 10);
  const staffHash = bcrypt.hashSync('staff123', 10);

  // Upsert admin
  const hasAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (hasAdmin) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = 'admin'").run(adminHash);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')").run(adminHash);
  }

  // Upsert staff
  const hasStaff = db.prepare("SELECT id FROM users WHERE username = 'staff'").get();
  if (hasStaff) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'staff' WHERE username = 'staff'").run(staffHash);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('staff', ?, 'staff')").run(staffHash);
  }

  // 4. Ensure Storefront Categories are Initialized
  console.log('\n🏷️ Ensuring standard categories are initialized...');
  const seedCategories = [
    ['Dry Fruits', 'Premium California almonds, cashews, pistachios, raisins, and walnuts.'],
    ['Millets', 'Nutritious unpolished foxtail, barnyard, kodo, little, and pearl millets.'],
    ['Seeds', 'Superfood chia, pumpkin, flax, sunflower, and watermelon seeds.'],
    ['Spices', 'Handpicked Kashmiri saffron, cardamom, cloves, cinnamon, and black pepper.'],
    ['Nuts', 'Gourmet macadamias, hazelnuts, Brazil nuts, and pine nuts.'],
    ['Sweets', 'Traditional artisanal dry fruit laddoos, halwa, and festive gift boxes.']
  ];
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)');
  for (const [name, desc] of seedCategories) {
    insertCat.run(name, desc);
  }

  // 5. Reset SQLite autoincrement sequence counters
  try {
    db.prepare("DELETE FROM sqlite_sequence WHERE name != 'users' AND name != 'categories'").run();
  } catch {
    // sqlite_sequence may not exist if no autoincrement was triggered yet
  }
})();

db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)');
db.exec('VACUUM;');

const remainingUsers = db.prepare('SELECT id, username, role FROM users').all();
console.log('\nRetained Users in Database:');
console.table(remainingUsers);

const finalVariants = db.prepare('SELECT count(*) as c FROM product_variants').get().c;
const finalProducts = db.prepare('SELECT count(*) as c FROM products').get().c;
const finalBills = db.prepare('SELECT count(*) as c FROM bills').get().c;
const finalOrders = db.prepare('SELECT count(*) as c FROM online_orders').get().c;
const finalAudits = db.prepare('SELECT count(*) as c FROM audit_logs').get().c;

console.log('\nFinal Counts:');
console.log(`  • Products: ${finalProducts}`);
console.log(`  • Product Variants: ${finalVariants}`);
console.log(`  • Bills / POS Sales: ${finalBills}`);
console.log(`  • Online Orders: ${finalOrders}`);
console.log(`  • Audit Logs: ${finalAudits}`);

db.close();

// 6. Reset Sessions Database
if (fs.existsSync(sessionsDbPath)) {
  try {
    const sdb = new Database(sessionsDbPath);
    sdb.exec("DELETE FROM sessions;");
    sdb.pragma('wal_checkpoint(TRUNCATE)');
    sdb.exec('VACUUM;');
    sdb.close();
    console.log('\n🔑 Sessions table in data/sessions.db cleared cleanly.');
  } catch (err) {
    console.warn(`  ⚠️ Could not truncate sessions.db: ${err.message}`);
  }
}

console.log('\n🎉 DATABASE RESET COMPLETE: Ready for fresh product & inventory data entry!\n');
