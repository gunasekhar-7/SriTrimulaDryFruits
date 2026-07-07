import sqlite3

db_name = 'dryfruits_v3.db'

def reset_db():
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    
    print(f"⚠️  WARNING: This will wipe ALL data from {db_name}!")
    confirm = input("Type 'yes' to confirm delete and reset: ")
    
    if confirm.lower() != 'yes':
        print("❌ Operation cancelled.")
        return

    print("---------------------------------------")
    
    # 1. DROP OLD TABLES (Clear everything)
    tables = ['sales', 'bills', 'products', 'users']
    for table in tables:
        cursor.execute(f"DROP TABLE IF EXISTS {table}")
        print(f"🗑️  Dropped table: {table}")

    # 2. CREATE FRESH TABLES
    
    # Users Table
    cursor.execute('''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')
    print("✅ Created table: users")

    # Products Table (Includes MRP and Barcode)
    cursor.execute('''
        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            barcode TEXT UNIQUE NOT NULL,
            total_qty REAL NOT NULL,
            sold_qty REAL DEFAULT 0,
            cost_price REAL NOT NULL,
            selling_price REAL NOT NULL,
            mrp REAL DEFAULT 0
        )
    ''')
    print("✅ Created table: products")

    # Bills Table
    cursor.execute('''
        CREATE TABLE bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_date TEXT NOT NULL,
            bill_time TEXT NOT NULL,
            total_amount REAL NOT NULL
        )
    ''')
    print("✅ Created table: bills")

    # Sales Table (Links Items to Bills)
    cursor.execute('''
        CREATE TABLE sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            qty_sold REAL NOT NULL,
            profit_made REAL NOT NULL,
            FOREIGN KEY(bill_id) REFERENCES bills(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
    ''')
    print("✅ Created table: sales")

    # 3. CREATE DEFAULT ADMIN USER
    # Username: admin | Password: 123
    cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                   ('admin', '123', 'admin'))
    
    # Create a Staff user for testing
    cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                   ('staff', '123', 'staff'))
    
    print("👤 Created default users: 'admin' & 'staff' (Password: 123)")

    conn.commit()
    conn.close()
    print("---------------------------------------")
    print("✨ DATABASE SUCCESSFULLY RESET! ✨")

if __name__ == "__main__":
    reset_db()