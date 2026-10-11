# FILE: setup_db.py
import sqlite3

connection = sqlite3.connect('dryfruits_v3.db')
cursor = connection.cursor()

# Create Products Table
cursor.execute('''
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    barcode TEXT UNIQUE NOT NULL,
    total_qty INTEGER NOT NULL,
    sold_qty INTEGER DEFAULT 0,
    cost_price REAL,
    selling_price REAL
)
''')

# Create Sales Table
cursor.execute('''
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    qty_sold INTEGER,
    profit_made REAL,
    sale_date DATE DEFAULT CURRENT_DATE
)
''')

connection.commit()
connection.close()
print("Database created successfully! You can now run app.py")