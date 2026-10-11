import sqlite3

print("--- 🔧 UPDATING DATABASE FOR BILLING ---")

conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

# Create a 'bills' table to track unique Bill IDs
try:
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_date DATE,
        bill_time TEXT,
        total_amount REAL
    )
    ''')
    print("✅ 'bills' table created successfully.")
except Exception as e:
    print(f"❌ Error creating table: {e}")

conn.commit()
conn.close()
print("🎉 Database updated! You can now run app.py")