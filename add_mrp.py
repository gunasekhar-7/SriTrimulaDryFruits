import sqlite3

print("--- 🔧 UPDATING DATABASE FOR MRP ---")

conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

try:
    # Add 'mrp' column (Decimal number)
    cursor.execute("ALTER TABLE products ADD COLUMN mrp REAL DEFAULT 0")
    print("✅ SUCCESS: Added 'mrp' column to products table.")
except Exception as e:
    print(f"ℹ️ Info: {e} (Column might already exist)")

conn.commit()
conn.close()
print("🎉 Database updated! You can now use MRP.")