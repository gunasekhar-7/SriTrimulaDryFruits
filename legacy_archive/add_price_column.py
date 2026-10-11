import sqlite3

# Connect to your database
conn = sqlite3.connect('dryfruits_v3.db')
cursor = conn.cursor()

try:
    # Add a column to remember the price it was actually sold at
    cursor.execute("ALTER TABLE sales ADD COLUMN unit_price REAL")
    print("✅ Successfully added 'unit_price' column.")
except sqlite3.OperationalError:
    print("⚠️ Column 'unit_price' already exists (No changes made).")

conn.commit()
conn.close()