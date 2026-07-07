from flask import Flask, render_template, request, redirect, session, url_for, flash, jsonify
import sqlite3
from datetime import date, datetime

app = Flask(__name__)
app.secret_key = 'super_secret_key'

def get_db_connection():
    conn = sqlite3.connect('dryfruits_v3.db')
    conn.row_factory = sqlite3.Row
    return conn
# --- ADD THIS TO CREATE TABLES AUTOMATICALLY ---
def init_db():
    conn = get_db_connection()
    # Users Table
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    role TEXT DEFAULT 'staff')''')
    # Products Table
    conn.execute('''CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    barcode TEXT UNIQUE NOT NULL,
                    cost_price REAL NOT NULL,
                    selling_price REAL NOT NULL,
                    mrp REAL,
                    total_qty REAL,
                    sold_qty REAL DEFAULT 0)''')
    # Bills Table (For the main invoice)
    conn.execute('''CREATE TABLE IF NOT EXISTS bills (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bill_date TEXT,
                    bill_time TEXT,
                    total_amount REAL)''')
    # Sales Table (For individual items sold)
    conn.execute('''CREATE TABLE IF NOT EXISTS sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bill_id INTEGER,
                    product_id INTEGER,
                    qty_sold REAL,
                    profit_made REAL,
                    sale_date TEXT,
                    FOREIGN KEY(bill_id) REFERENCES bills(id))''')
    conn.commit()
    conn.close()

# Run this once on startup
init_db()
# --- PUBLIC HOME PAGE ---
@app.route('/')
def home():
    conn = get_db_connection()
    products = conn.execute('SELECT * FROM products ORDER BY RANDOM() LIMIT 8').fetchall()
    conn.close()
    return render_template('home.html', products=products)


# --- UPDATE: LOGOUT ROUTE ---
@app.route('/logout', methods=['GET', 'POST'])
def logout():
    session.clear()
    return redirect('/')

# --- UPDATE: LOGIN ROUTE (Ensure Session is NOT Permanent) ---
# Find your existing login function and add "session.permanent = False"
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ? AND password = ?', (username, password)).fetchone()
        conn.close()
        
        if user:
            session.permanent = False  # <--- ADD THIS LINE (Forces session to be temporary)
            session['user'] = user['username']
            session['role'] = user['role']
            flash(f"Welcome back, {user['username']}!")
            return redirect('/sell')
        else:
            return render_template('login.html', error="Invalid Username or Password")
            
    return render_template('login.html')

# --- BILLING (Accessible by Both) ---
# --- 1. UPDATE THE SELL ROUTE (To save MRP in Cart) ---
# --- UPDATE THIS: SELL ROUTE (Allows editing Name/Price/MRP) ---
@app.route('/sell', methods=('GET', 'POST'))
def sell():
    if 'user' not in session: return redirect('/login')
    
    if 'cart' not in session: session['cart'] = []
    if 'held_bills' not in session: session['held_bills'] = []
    
    error = None
    cart = session['cart']

    if request.method == 'POST':
        # Get the barcode from the form
        barcode = request.form.get('barcode')
        
        # Get the EDITABLE fields from the form
        # We use .get() to avoid errors if they are missing
        custom_name = request.form.get('name')
        custom_mrp = request.form.get('mrp')
        custom_price = request.form.get('price')
        
        try:
            input_qty = float(request.form.get('qty', 1))
        except ValueError:
            input_qty = 1.0
        
        conn = get_db_connection()
        # We still need to look up the product to get the ID and Cost Price
        product = conn.execute('SELECT *, (total_qty - IFNULL(sold_qty, 0)) as available FROM products WHERE barcode = ?', (barcode,)).fetchone()
        conn.close()

        if product:
            available_stock = product['available']
            
            # --- LOGIC: Use Form Data if exists, otherwise Database Data ---
            final_name = custom_name if custom_name else product['name']
            
            try:
                final_mrp = float(custom_mrp) if custom_mrp else (product['mrp'] or 0)
                final_price = float(custom_price) if custom_price else product['selling_price']
            except ValueError:
                # Fallback if user typed bad text
                final_mrp = product['mrp'] or 0
                final_price = product['selling_price']

            # Check stock limits
            # Check if item is already in cart to sum quantities
            current_cart_qty = sum(item['qty'] for item in cart if item['id'] == product['id'])
            
            if (current_cart_qty + input_qty) > available_stock:
                 error = f"❌ Stock Limit: Only {available_stock} available."
            else:
                # Add item with the CUSTOM details
                item = {
                    'id': product['id'],
                    'name': final_name,       # Uses the edited name
                    'qty': input_qty,
                    'price': final_price,     # Uses the edited price
                    'mrp': final_mrp,         # Uses the edited MRP
                    'cost': product['cost_price'], # Cost is hidden/internal
                    'total': final_price * input_qty
                }
                
                # We append as a new item (even if same ID) if details changed, 
                # or you can merge logic. For simplicity, we append.
                cart.append(item)
                session['cart'] = cart
                session.modified = True 
        else:
            error = "❌ Product not found! (Cannot add non-existent item)"

    grand_total = sum(item['total'] for item in session['cart'])
    return render_template('sell.html', cart=session['cart'], total=grand_total, error=error, held_bills=session['held_bills'])
# --- 2. UPDATE THE SEARCH ROUTE (To fetch MRP for old bills) ---
# --- UPDATE THIS: SEARCH BILL ROUTE (Handles GET & POST now) ---
# @app.route('/search_bill', methods=['GET', 'POST'])
# def search_bill():
#     if 'user' not in session: return redirect('/login')
    
#     bill_id = None
#     # Support both Form Submit (POST) and URL Click (GET)
#     if request.method == 'POST':
#         bill_id = request.form.get('bill_id')
#     elif request.args.get('bill_id'):
#         bill_id = request.args.get('bill_id')
        
#     if bill_id:
#         conn = get_db_connection()
#         bill = conn.execute('SELECT * FROM bills WHERE id = ?', (bill_id,)).fetchone()
        
#         if bill:
#             # We fetch 's.id as sale_id' to identify the specific row to return
#             items = conn.execute('''
#                 SELECT s.id as sale_id, p.id as product_id, p.name, s.qty_sold as qty, 
#                        p.selling_price as price, p.mrp, 
#                        (s.qty_sold * p.selling_price) as total 
#                 FROM sales s 
#                 JOIN products p ON s.product_id = p.id 
#                 WHERE s.bill_id = ?
#             ''', (bill_id,)).fetchall()
            
#             conn.close()
#             # We pass 'allow_return=True' to show buttons
#             return render_template('bill.html', items=items, total=bill['total_amount'], 
#                                    date=bill['bill_date'], time=bill['bill_time'], 
#                                    sale_id=bill['id'], allow_return=True)
#         else:
#             conn.close()
#             return render_template('search.html', error="❌ Bill Number Not Found")
            
#     return render_template('search.html')
# --- UPDATE THIS: SEARCH BILL (Reads the Saved Price) ---
@app.route('/search_bill', methods=['GET', 'POST'])
def search_bill():
    if 'user' not in session: return redirect('/login')
    
    bill_id = None
    if request.method == 'POST':
        bill_id = request.form.get('bill_id')
    elif request.args.get('bill_id'):
        bill_id = request.args.get('bill_id')
        
    if bill_id:
        conn = get_db_connection()
        bill = conn.execute('SELECT * FROM bills WHERE id = ?', (bill_id,)).fetchone()
        
        if bill:
            # LOGIC CHANGE: 
            # We use COALESCE(s.unit_price, p.selling_price)
            # This means: "Use the saved price. If it's empty (old bills), use the standard price."
            query = '''
                SELECT s.id as sale_id, 
                       p.id as product_id, 
                       p.name, 
                       s.qty_sold as qty, 
                       COALESCE(s.unit_price, p.selling_price) as price, 
                       p.mrp, 
                       (s.qty_sold * COALESCE(s.unit_price, p.selling_price)) as total 
                FROM sales s 
                JOIN products p ON s.product_id = p.id 
                WHERE s.bill_id = ?
            '''
            items = conn.execute(query, (bill_id,)).fetchall()
            
            conn.close()
            return render_template('bill.html', items=items, total=bill['total_amount'], 
                                   date=bill['bill_date'], time=bill['bill_time'], 
                                   sale_id=bill['id'], allow_return=True)
        else:
            conn.close()
            return render_template('search.html', error="❌ Bill Number Not Found")
            
    return render_template('search.html')

# --- NEW ROUTE: PROCESS RETURN ---
@app.route('/return_item', methods=['POST'])
def return_item():
    if 'user' not in session: return redirect('/login')

    try:
        bill_id = request.form['bill_id']
        sale_id = request.form['sale_id']
        product_id = request.form['product_id']
        return_qty = float(request.form['return_qty'])

        conn = get_db_connection()
        
        # 1. Get Product Details (for Price/Cost)
        product = conn.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
        current_sale = conn.execute('SELECT * FROM sales WHERE id = ?', (sale_id,)).fetchone()

        if current_sale and product and return_qty > 0 and return_qty <= current_sale['qty_sold']:
            
            # Calculate Amounts to Deduct
            refund_amount = return_qty * product['selling_price']
            profit_deduction = return_qty * (product['selling_price'] - product['cost_price'])

            # 2. Update Stock (Decrease Sold Qty = Increase Available)
            conn.execute('UPDATE products SET sold_qty = sold_qty - ? WHERE id = ?', 
                         (return_qty, product_id))

            # 3. Update Sales Record (Reduce Qty and Profit)
            new_qty = current_sale['qty_sold'] - return_qty
            if new_qty == 0:
                conn.execute('DELETE FROM sales WHERE id = ?', (sale_id,)) # Remove if fully returned
            else:
                conn.execute('UPDATE sales SET qty_sold = ?, profit_made = profit_made - ? WHERE id = ?', 
                             (new_qty, profit_deduction, sale_id))

            # 4. Update Main Bill Total
            conn.execute('UPDATE bills SET total_amount = total_amount - ? WHERE id = ?', 
                         (refund_amount, bill_id))

            conn.commit()
            flash(f"✅ Returned {return_qty} x {product['name']}")
        else:
            flash("❌ Invalid Return Quantity!")
            
    except Exception as e:
        flash(f"Error: {e}")
    finally:
        if 'conn' in locals(): conn.close()

    # Reload the same bill to show updates
    return redirect(url_for('search_bill', bill_id=bill_id))
# --- CART ACTIONS (Update/Delete/Hold/Clear) ---
@app.route('/update_cart/<int:index>', methods=['POST'])
def update_cart(index):
    if 'cart' in session:
        cart = session['cart']
        if 0 <= index < len(cart):
            try:
                new_qty = int(request.form['qty'])
                if new_qty < 1: new_qty = 1
                conn = get_db_connection()
                prod = conn.execute('SELECT (total_qty - sold_qty) as available FROM products WHERE id = ?', (cart[index]['id'],)).fetchone()
                conn.close()
                if prod and new_qty <= prod['available']:
                    cart[index]['qty'] = new_qty
                    cart[index]['total'] = cart[index]['price'] * new_qty
                    session['cart'] = cart
                    session.modified = True
            except ValueError: pass
    return redirect('/sell')

@app.route('/delete_item/<int:index>')
def delete_item(index):
    if 'cart' in session:
        cart = session['cart']
        if 0 <= index < len(cart):
            cart.pop(index)
            session['cart'] = cart
            session.modified = True
    return redirect('/sell')

@app.route('/clear_cart')
def clear_cart():
    session['cart'] = []
    return redirect('/sell')

@app.route('/hold_bill')
def hold_bill():
    if 'cart' in session and len(session['cart']) > 0:
        held = session.get('held_bills', [])
        held.append({
            'time': datetime.now().strftime("%H:%M"),
            'total': sum(i['total'] for i in session['cart']),
            'cart_items': session['cart']
        })
        session['held_bills'] = held
        session['cart'] = []
        session.modified = True
    return redirect('/sell')

@app.route('/resume_bill/<int:index>')
def resume_bill(index):
    held = session.get('held_bills', [])
    if 0 <= index < len(held):
        if session['cart']: 
            held.append({'time': datetime.now().strftime("%H:%M"), 'total': sum(i['total'] for i in session['cart']), 'cart_items': session['cart']})
        bill = held.pop(index)
        session['cart'] = bill['cart_items']
        session['held_bills'] = held
        session.modified = True
    return redirect('/sell')

@app.route('/discard_held/<int:index>')
def discard_held(index):
    held = session.get('held_bills', [])
    if 0 <= index < len(held):
        held.pop(index)
        session['held_bills'] = held
        session.modified = True
    return redirect('/sell')

# @app.route('/finalize_bill')
# def finalize_bill():
#     if 'user' not in session: return redirect('/login')
#     if 'cart' in session and len(session['cart']) > 0:
#         conn = get_db_connection()
#         today, now_time = date.today(), datetime.now().strftime("%I:%M %p")
#         items = session['cart']
#         total = sum(i['total'] for i in items)
        
#         cur = conn.execute('INSERT INTO bills (bill_date, bill_time, total_amount) VALUES (?, ?, ?)', (today, now_time, total))
#         new_id = cur.lastrowid
        
#         for i in items:
#             conn.execute('UPDATE products SET sold_qty = sold_qty + ? WHERE id = ?', (i['qty'], i['id']))
#             profit = (i['price'] - i['cost']) * i['qty']
#             conn.execute('INSERT INTO sales (product_id, qty_sold, profit_made, sale_date, bill_id) VALUES (?, ?, ?, ?, ?)',
#                          (i['id'], i['qty'], profit, today, new_id))
#         conn.commit()
#         conn.close()
#         session['cart'] = []
#         session.modified = True
#         return render_template('bill.html', items=items, total=total, date=today, time=now_time, sale_id=new_id)
#     return redirect('/sell')


# --- UPDATE THIS: FINALIZE BILL (Saves the Custom Price) ---
@app.route('/finalize_bill')
def finalize_bill():
    if 'user' not in session: return redirect('/login')
    
    if 'cart' in session and len(session['cart']) > 0:
        conn = get_db_connection()
        today = date.today()
        now_time = datetime.now().strftime("%I:%M %p")
        items = session['cart']
        
        # Calculate Bill Total
        total = sum(i['total'] for i in items)
        
        # 1. Create the Main Bill Record
        cur = conn.execute('INSERT INTO bills (bill_date, bill_time, total_amount) VALUES (?, ?, ?)', 
                           (today, now_time, total))
        new_id = cur.lastrowid
        
        # 2. Save Each Item with its SPECIFIC Price
        for i in items:
            # Deduct Stock
            conn.execute('UPDATE products SET sold_qty = IFNULL(sold_qty, 0) + ? WHERE id = ?', 
                         (i['qty'], i['id']))
            
            # Calculate Profit: (Sold Price - Cost) * Qty
            profit = (i['price'] - i['cost']) * i['qty']
            
            # INSERT into Sales (Now including unit_price)
            conn.execute('''
                INSERT INTO sales 
                (bill_id, product_id, qty_sold, profit_made, sale_date, unit_price) 
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (new_id, i['id'], i['qty'], profit, today, i['price']))
            
        conn.commit()
        conn.close()
        
        session['cart'] = []
        session.modified = True
        return render_template('bill.html', items=items, total=total, date=today, time=now_time, sale_id=new_id)
    
    return redirect('/sell')

# --- STOCK MANAGEMENT (Both can access per requirement) ---
# --- UPDATE THIS: ADD PRODUCT ROUTE ---
# --- SECURE: ADD NEW PRODUCT (Admin Only) ---
@app.route('/add', methods=('GET', 'POST'))
def add_product():
    if 'user' not in session: return redirect('/login')
    
    # SECURITY: Only Admin can create new items
    if session.get('role') != 'admin':
        flash("⛔ Access Denied: Only Admins can create new items.")
        return redirect('/stock')

    if request.method == 'POST':
        conn = get_db_connection()
        try:
            conn.execute('INSERT INTO products (name, barcode, total_qty, cost_price, selling_price, mrp) VALUES (?, ?, ?, ?, ?, ?)',
                         (request.form['name'], 
                          request.form['barcode'], 
                          float(request.form['qty']), 
                          float(request.form['cost']), 
                          float(request.form['sell']), 
                          float(request.form['mrp']) ))
            conn.commit()
            flash("✅ Product added successfully!")
        except sqlite3.IntegrityError:
            flash("❌ Error: Barcode already exists!")
        except Exception as e:
            flash(f"❌ Error: {e}")
        finally:
            conn.close()
        return redirect('/stock')
    return render_template('add_product.html')

# --- UPDATE THIS: STOCK ROUTE ---
@app.route('/stock')
def stock():
    if 'user' not in session: return redirect('/login')
    conn = get_db_connection()
    # Added 'mrp' to the SELECT statement
    products = conn.execute('SELECT id, name, barcode, total_qty, IFNULL(sold_qty, 0) as sold_qty, (total_qty - IFNULL(sold_qty, 0)) as remaining, cost_price, selling_price, mrp FROM products').fetchall()
    conn.close()
    return render_template('stock.html', products=products)

# --- UPDATE THIS: EDIT PRODUCT ROUTE ---
# --- SECURE: FULL EDIT (Admin Only) ---
@app.route('/edit/<int:id>', methods=('GET', 'POST'))
def edit_product(id):
    if 'user' not in session: return redirect('/login')
    
    # SECURITY: Only Admin can edit Cost/Prices
    if session.get('role') != 'admin':
        flash("⛔ Access Denied: Only Admins can edit prices.")
        return redirect('/stock')

    conn = get_db_connection()
    product = conn.execute('SELECT * FROM products WHERE id = ?', (id,)).fetchone()
    
    if request.method == 'POST':
        # Admin sets the EXACT new stock quantity
        new_remaining_stock = float(request.form['qty'])
        current_sold = product['sold_qty'] if product['sold_qty'] else 0
        new_total_qty = new_remaining_stock + current_sold

        conn.execute('UPDATE products SET name=?, barcode=?, total_qty=?, cost_price=?, selling_price=?, mrp=? WHERE id=?', 
                     (request.form['name'], 
                      request.form['barcode'], 
                      new_total_qty, 
                      float(request.form['cost']), 
                      float(request.form['sell']), 
                      float(request.form['mrp']),
                      id))
        conn.commit()
        conn.close()
        flash("✅ Product details updated!")
        return redirect('/stock')

    conn.close()
    current_sold = product['sold_qty'] if product['sold_qty'] else 0
    current_stock_on_shelf = product['total_qty'] - current_sold
    return render_template('edit_product.html', product=product, current_stock=current_stock_on_shelf)

# --- NEW: ADD STOCK (Available to Staff & Admin) ---
@app.route('/add_stock/<int:id>', methods=['GET', 'POST'])
def add_stock(id):
    if 'user' not in session: return redirect('/login')
    
    conn = get_db_connection()
    product = conn.execute('SELECT * FROM products WHERE id = ?', (id,)).fetchone()

    if request.method == 'POST':
        try:
            added_qty = float(request.form['added_qty'])
            # Simply ADD to the existing total
            conn.execute('UPDATE products SET total_qty = total_qty + ? WHERE id = ?', (added_qty, id))
            conn.commit()
            flash(f"✅ Added {added_qty} to {product['name']}")
            return redirect('/stock')
        except Exception as e:
            flash(f"Error: {e}")
        finally:
            conn.close()
            
    conn.close()
    return render_template('add_stock.html', product=product)

# --- SECURE: DELETE (Admin Only) ---
@app.route('/delete/<int:id>')
def delete_product(id):
    if 'user' not in session: return redirect('/login')
    if session.get('role') != 'admin':
        flash("⛔ Admin Only!")
        return redirect('/stock')
        
    conn = get_db_connection()
    conn.execute('DELETE FROM products WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect('/stock')

# --- UPDATE: PROFIT DASHBOARD (Admin Only) ---
@app.route('/profit')
def profit():
    # SECURITY: Only Admin allowed
    if 'user' not in session or session.get('role') != 'admin':
        flash("⛔ Access Denied: Admin Only!")
        return redirect('/sell')
        
    conn = get_db_connection()
    
    # 1. Fetch detailed bill data instead of just totals
    query = '''
        SELECT 
            b.id as bill_id,
            b.bill_date,
            b.bill_time,
            b.total_amount as bill_total,
            SUM(s.profit_made) as bill_profit
        FROM bills b
        JOIN sales s ON b.id = s.bill_id
        GROUP BY b.id
        ORDER BY b.bill_date DESC, b.bill_time DESC
    '''
    raw_data = conn.execute(query).fetchall()
    conn.close()

    # 2. CONVERT LIST TO DICTIONARY (Fixes the error)
    # The HTML expects data.items(), so we must create a dictionary here.
    grouped_data = {}
    
    for row in raw_data:
        date_str = str(row['bill_date'])
        
        if date_str not in grouped_data:
            grouped_data[date_str] = {'daily_profit': 0, 'daily_sales': 0, 'bills': []}
        
        # Add the row to the specific date group
        grouped_data[date_str]['bills'].append(row)
        
        # Calculate totals for that day
        grouped_data[date_str]['daily_profit'] += row['bill_profit']
        grouped_data[date_str]['daily_sales'] += row['bill_total']

    # 3. Pass the dictionary 'grouped_data' to the template
    return render_template('profit.html', data=grouped_data)

# --- NEW: EDIT PROFIT ROUTE ---
@app.route('/update_profit', methods=['POST'])
def update_profit():
    if 'user' not in session or session.get('role') != 'admin':
        return redirect('/')

    bill_id = request.form['bill_id']
    new_profit_total = float(request.form['new_profit'])
    
    conn = get_db_connection()
    try:
        # Calculate difference and update
        current_sum = conn.execute('SELECT SUM(profit_made) FROM sales WHERE bill_id = ?', (bill_id,)).fetchone()[0]
        if current_sum is None: current_sum = 0
        
        diff = new_profit_total - current_sum
        
        first_sale = conn.execute('SELECT id FROM sales WHERE bill_id = ? LIMIT 1', (bill_id,)).fetchone()
        
        if first_sale:
            conn.execute('UPDATE sales SET profit_made = profit_made + ? WHERE id = ?', (diff, first_sale['id']))
            conn.commit()
            flash(f"✅ Profit updated for Bill #{bill_id}")
            
    except Exception as e:
        flash(f"Error: {e}")
    finally:
        conn.close()
        
    return redirect('/profit')

@app.route('/analytics')
def analytics():
    # SECURITY CHECK: Only Admin allowed
    if 'user' not in session or session.get('role') != 'admin':
        flash("⛔ Access Denied: Admin Only!")
        return redirect('/sell')

    conn = get_db_connection()
    top = conn.execute('SELECT p.name, SUM(s.qty_sold) as total FROM sales s JOIN products p ON s.product_id = p.id GROUP BY s.product_id ORDER BY total DESC LIMIT 5').fetchall()
    conn.close()
    return render_template('analytics.html', labels=[r['name'] for r in top], values=[r['total'] for r in top])

# --- ADMIN SETTINGS (User Management) ---
@app.route('/settings')
def settings():
    # SECURITY: Only Admin can access
    if 'user' not in session or session.get('role') != 'admin':
        flash("⛔ Access Denied: Admin Only!")
        return redirect('/sell')
    
    conn = get_db_connection()
    users = conn.execute('SELECT * FROM users').fetchall()
    conn.close()
    return render_template('settings.html', users=users)

@app.route('/update_user', methods=['POST'])
def update_user():
    # SECURITY: Only Admin can update
    if 'user' not in session or session.get('role') != 'admin':
        return redirect('/')

    user_id = request.form['user_id']
    new_username = request.form['username']
    new_password = request.form['password']
    
    conn = get_db_connection()
    try:
        conn.execute('UPDATE users SET username = ?, password = ? WHERE id = ?', 
                     (new_username, new_password, user_id))
        conn.commit()
        flash(f"✅ Credentials updated for user: {new_username}")
    except sqlite3.IntegrityError:
        flash("❌ Error: Username already taken!")
    finally:
        conn.close()
        
    return redirect('/settings')

# --- NEW ROUTE: PRINT BARCODE LABEL ---
@app.route('/print_label/<int:id>')
def print_label(id):
    if 'user' not in session: return redirect('/login')
    
    conn = get_db_connection()
    product = conn.execute('SELECT * FROM products WHERE id = ?', (id,)).fetchone()
    conn.close()
    
    if product:
        return render_template('barcode_label.html', product=product)
    else:
        return "Product Not Found"
    # --- NEW: API TO FETCH PRODUCT DETAILS ---
@app.route('/get_product_details/<barcode>')
def get_product_details(barcode):
    if 'user' not in session: 
        return jsonify({'error': 'Unauthorized'}), 401

    conn = get_db_connection()
    product = conn.execute('SELECT *, (total_qty - sold_qty) as available FROM products WHERE barcode = ?', (barcode,)).fetchone()
    conn.close()
    
    if product:
        return jsonify({
            'success': True,
            'id': product['id'],
            'name': product['name'],
            'mrp': product['mrp'],
            'selling_price': product['selling_price'],
            'available': product['available']
        })
    else:
        return jsonify({'success': False})
if __name__ == '__main__':
    app.run(debug=True)