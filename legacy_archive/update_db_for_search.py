import sqlite3

print("--- 🔧 UPDATING DATABASE FOR BILL SEARCH ---")

conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

try:
    # Add a 'bill_id' column to the sales table
    cursor.execute("ALTER TABLE sales ADD COLUMN bill_id INTEGER")
    print("✅ SUCCESS: Added 'bill_id' column to sales table.")
except Exception as e:
    print(f"ℹ️ Info: {e} (Column might already exist)")

conn.commit()
conn.close()
print("🎉 Database updated! You can now use the Search feature.")