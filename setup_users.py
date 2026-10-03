import sqlite3

print("--- 👤 SETTING UP USER LOGINS ---")

conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

# 1. Create Users Table
cursor.execute('''
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL  -- 'admin' or 'staff'
)
''')

# 2. Insert Default Users (if they don't exist)
users = [
    ('admin', 'admin', 'admin'),   # Username: admin, Pass: admin
    ('staff', 'staff', 'staff')    # Username: staff, Pass: staff
]

try:
    cursor.executemany('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', users)
    print("✅ Created Default Users:")
    print("   1. Admin (User: admin / Pass: admin)")
    print("   2. Staff (User: staff / Pass: staff)")
except sqlite3.IntegrityError:
    print("ℹ️ Users already exist. Skipping creation.")

conn.commit()
conn.close()
print("🎉 Setup Complete! You can now run app.py")