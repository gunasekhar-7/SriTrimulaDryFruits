import { cartRepository } from '../repositories/cart.repository.js';
import { getProductById } from '../repository.js';
import { metricsAggregator } from '../observability/index.js';

export class CartService {
  getCart(customerId: number) {
    let cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) {
      cart = cartRepository.createCart(customerId);
    }
    
    const items = cartRepository.getCartItems(cart.id);
    
    let subtotal = 0;
    const validatedItems = items.map((item: any) => {
      const stock = item.total_qty - (item.sold_qty || 0);
      let qty = item.quantity;
      let available = true;
      let message = '';
      
      if (stock <= 0) {
        qty = 0;
        available = false;
        message = 'Out of stock';
      } else if (qty > stock) {
        qty = stock;
        message = `Only ${stock} left in stock`;
        cartRepository.updateCartItemQuantity(cart.id, item.product_id, qty);
      }
      
      if (qty > 0) {
        subtotal += qty * item.price;
      }
      
      return {
        id: item.product_id, // Map product_id to id for client side
        cart_item_id: item.id,
        name: item.name,
        price: item.price,
        mrp: item.mrp,
        image_url: item.image_url,
        stock: stock,
        qty: qty,
        available,
        message
      };
    });
    
    return {
      cart,
      items: validatedItems,
      subtotal
    };
  }

  addItem(customerId: number, productId: number, quantity: number) {
    let cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) {
      cart = cartRepository.createCart(customerId);
    }
    
    const product = getProductById(productId);
    if (!product) throw new Error('Product not found');
    
    const stock = product.total_qty - (product.sold_qty || 0);
    if (stock <= 0) {
      metricsAggregator.recordStockOut(product.name, 'online');
      throw new Error('Product is out of stock');
    }
    
    const existingItem = cartRepository.getCartItem(cart.id, productId) as any;
    let newQty = quantity;
    
    if (existingItem) {
      newQty += existingItem.quantity;
    }
    
    if (newQty > stock) {
      metricsAggregator.recordStockOut(product.name, 'online');
      throw new Error(`Cannot add more than available stock (${stock})`);
    }
    if (newQty <= 0) throw new Error('Invalid quantity');
    
    if (existingItem) {
      cartRepository.updateCartItemQuantity(cart.id, productId, newQty);
    } else {
      cartRepository.addCartItem(cart.id, productId, quantity);
    }
    
    return this.getCart(customerId);
  }

  updateItemQuantity(customerId: number, productId: number, quantity: number) {
    const cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) throw new Error('Cart not found');
    
    if (quantity <= 0) {
      cartRepository.removeCartItem(cart.id, productId);
      return this.getCart(customerId);
    }
    
    const product = getProductById(productId);
    if (!product) throw new Error('Product not found');
    
    const stock = product.total_qty - (product.sold_qty || 0);
    if (quantity > stock) {
      metricsAggregator.recordStockOut(product.name, 'online');
      throw new Error(`Only ${stock} items available`);
    }
    
    const existingItem = cartRepository.getCartItem(cart.id, productId);
    if (!existingItem) throw new Error('Item not in cart');

    cartRepository.updateCartItemQuantity(cart.id, productId, quantity);
    return this.getCart(customerId);
  }

  removeItem(customerId: number, productId: number) {
    const cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) return null;
    cartRepository.removeCartItem(cart.id, productId);
    return this.getCart(customerId);
  }

  updateItem(customerId: number, productId: number, quantity: number) {
    let cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) return null;
    cartRepository.updateCartItemQuantity(cart.id, productId, quantity);
    return this.getCart(customerId);
  }

  clearCart(customerId: number) {
    const cart = cartRepository.getCartByCustomerId(customerId) as any;
    if (!cart) return null;
    cartRepository.clearCart(cart.id);
    return this.getCart(customerId);
  }

  validateSessionCart(sessionCart: any[]) {
    let subtotal = 0;
    const validatedItems = sessionCart.map(item => {
      const product = getProductById(item.id);
      if (!product) {
        return { ...item, available: false, message: 'Product not found', qty: 0 };
      }
      const stock = product.total_qty - (product.sold_qty || 0);
      let qty = item.qty;
      let available = true;
      let message = '';
      
      if (stock <= 0) {
        qty = 0;
        available = false;
        message = 'Out of stock';
      } else if (qty > stock) {
        qty = stock;
        message = `Only ${stock} left in stock`;
      }
      
      if (qty > 0) {
        subtotal += qty * product.selling_price;
      }
      
      return {
        id: product.id,
        name: product.name,
        price: product.selling_price,
        mrp: product.mrp,
        image_url: product.image_url,
        stock,
        qty,
        available,
        message
      };
    });
    
    return {
      items: validatedItems.filter(i => i.qty > 0), // Maybe keep unavailable to show message, but frontend might expect all
      subtotal
    };
  }
}

export const cartService = new CartService();
