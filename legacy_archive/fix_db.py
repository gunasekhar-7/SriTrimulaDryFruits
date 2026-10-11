import sqlite3

# Connect to your specific database file
conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

try:
    # 1. Add the missing sale_date column
    cursor.execute("ALTER TABLE sales ADD COLUMN sale_date TEXT")
    print("✅ Successfully added 'sale_date' column.")
except sqlite3.OperationalError as e:
    print(f"⚠️ Note: {e}")

try:
    # 2. Add profit_made column if it's missing too (prevent future errors)
    cursor.execute("ALTER TABLE sales ADD COLUMN profit_made REAL DEFAULT 0")
    print("✅ Successfully added 'profit_made' column.")
except sqlite3.OperationalError as e:
    print(f"⚠️ Note: {e}")

conn.commit()
conn.close()
print("🎉 Database fixed! You can restart your app now.")