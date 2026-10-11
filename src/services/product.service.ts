import { productRepository, StorefrontCategoryInfo } from '../repositories/product.repository.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import { Product } from '../types/index.js';

export class ProductService {
  getProducts(): Product[] {
    return productRepository.getProducts();
  }

  getProductById(id: number): Product | undefined {
    return productRepository.getProductById(id);
  }

  getCategories(): string[] {
    return productRepository.getCategories();
  }

  getStorefrontCategories(): StorefrontCategoryInfo[] {
    return productRepository.getStorefrontCategories();
  }

  getRelatedProducts(currentProduct: Product, limit: number = 4): Product[] {
    const allProducts = this.getProducts().filter(p => 
      p.id !== currentProduct.id && 
      (p.active === undefined || p.active === 1) &&
      (!p.category || !p.category.toLowerCase().startsWith('test'))
    );
    if (allProducts.length === 0) return [];

    const currentCat = (currentProduct.category || 'Dry Fruits').trim().toLowerCase();
    
    const stopWords = new Set(['and', 'with', 'in', 'of', 'for', 'the', 'a', 'an', 'g', 'kg', 'unit', 'pcs', 'gm', 'ml']);
    const nameTokens = currentProduct.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    const scored = allProducts.map(candidate => {
      let score = 0;
      const candidateCat = (candidate.category || 'Dry Fruits').trim().toLowerCase();
      
      // 1. Same category is highest priority
      if (candidateCat === currentCat) {
        score += 100;
      }

      // 2. Matching keywords / variety tokens (e.g. Almonds, Cashews, Mamra, Roasted)
      const candidateTokens = new Set(
        candidate.name
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
      );

      for (const token of nameTokens) {
        if (candidateTokens.has(token)) {
          score += 25;
        }
      }

      // 3. Similar unit / pack size
      if (candidate.unit && currentProduct.unit && candidate.unit === currentProduct.unit) {
        score += 5;
      }

      // 4. In-stock items preferred
      const stock = (candidate.total_qty || 0) - (candidate.sold_qty || 0);
      if (stock > 0) {
        score += 10;
      }

      return { product: candidate, score };
    });

    // Deterministic sort: highest score first; tiebreak by id ASC
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.product.id - b.product.id;
    });

    return scored.slice(0, limit).map(s => s.product);
  }

  getProductsByCategory(category: string): Product[] {
    return productRepository.getProductsByCategory(category);
  }

  getProductByBarcode(barcode: string): Product | undefined {
    return productRepository.getProductByBarcode(barcode);
  }

  addProduct(name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0): Product {
    if (productRepository.checkBarcodeExists(barcode)) throw new Error('Barcode already exists');
    const id = productRepository.addProduct({name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate});
    if (total_qty !== 0) {
      inventoryRepository.recordMovement(id, total_qty, 'PURCHASE', 'Admin', 'Product', id.toString(), 'Initial Stock');
    }
    return productRepository.getProductById(id)!;
  }

  updateProduct(id: number, name: string, barcode: string, total_qty: number, cost_price: number, selling_price: number, mrp: number, category = 'Dry Fruits', image_url = '', tax_rate = 0): Product {
    if (productRepository.checkBarcodeExists(barcode, id)) throw new Error('Barcode already exists');
    const oldProduct = productRepository.getProductById(id);
    productRepository.updateProduct(id, {name, barcode, total_qty, cost_price, selling_price, mrp, category, image_url, tax_rate});
    if (oldProduct && oldProduct.total_qty !== total_qty) {
      const delta = total_qty - oldProduct.total_qty;
      inventoryRepository.recordMovement(id, delta, 'ADJUSTMENT', 'Admin', 'Product', id.toString(), 'Manual Edit');
    }
    return productRepository.getProductById(id)!;
  }

  addStock(id: number, qty: number, imageUrl?: string): Product {
    productRepository.addStock(id, qty, imageUrl);
    if (qty !== 0) {
      inventoryRepository.recordMovement(id, qty, 'PURCHASE', 'Admin', 'Product', id.toString(), 'Added Stock');
    }
    return productRepository.getProductById(id)!;
  }

  deleteProduct(id: number): void {
    productRepository.deleteProduct(id);
  }
}

export const productService = new ProductService();
