import sqlite3
import os

db_file = 'dryfruits_v3.db'

if not os.path.exists(db_file):
    print(f"❌ Error: Database file '{db_file}' not found!")
else:
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    print(f"🔧 Connecting to {db_file}...")

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
        print(f"❌ Database Error: {e}")

    conn.commit()
    conn.close()