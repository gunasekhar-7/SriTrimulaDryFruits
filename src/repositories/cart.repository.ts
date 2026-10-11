import db from '../database.js';

export class CartRepository {
  getCartByCustomerId(customerId: number) {
    return db.prepare('SELECT * FROM customer_carts WHERE customer_id = ?').get(customerId);
  }
  
  createCart(customerId: number) {
    const res = db.prepare('INSERT INTO customer_carts (customer_id) VALUES (?)').run(customerId);
    return this.getCartById(res.lastInsertRowid as number);
  }

  getCartById(cartId: number) {
    return db.prepare('SELECT * FROM customer_carts WHERE id = ?').get(cartId);
  }

  getCartItems(cartId: number) {
    return db.prepare(`
      SELECT ci.id, ci.cart_id, ci.product_id, ci.quantity, ci.added_at, 
             p.name, p.selling_price as price, p.total_qty, p.sold_qty, p.image_url, p.mrp
      FROM customer_cart_items ci
      JOIN product_variants p ON ci.product_id = p.id
      WHERE ci.cart_id = ?
    `).all(cartId);
  }

  getCartItem(cartId: number, productId: number) {
    return db.prepare('SELECT * FROM customer_cart_items WHERE cart_id = ? AND product_id = ?').get(cartId, productId);
  }

  addCartItem(cartId: number, productId: number, quantity: number) {
    db.prepare('INSERT INTO customer_cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').run(cartId, productId, quantity);
  }

  updateCartItemQuantity(cartId: number, productId: number, quantity: number) {
    db.prepare('UPDATE customer_cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').run(quantity, cartId, productId);
  }

  removeCartItem(cartId: number, productId: number) {
    db.prepare('DELETE FROM customer_cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId);
  }

  clearCart(cartId: number) {
    db.prepare('DELETE FROM customer_cart_items WHERE cart_id = ?').run(cartId);
  }
}

export const cartRepository = new CartRepository();
