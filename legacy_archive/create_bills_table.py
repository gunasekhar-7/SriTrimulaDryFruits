import sqlite3

# Connect to your existing database
conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

print("Attempting to fix database...")

try:
    # Create the missing 'bills' table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_date DATE,
        bill_time TEXT,
        total_amount REAL
    )
    ''')
    print("✅ SUCCESS: 'bills' table created successfully!")
except Exception as e:
    print(f"❌ Error: {e}")

conn.commit()
conn.close()