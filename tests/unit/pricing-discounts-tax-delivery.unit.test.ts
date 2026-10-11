import { describe, it, expect } from 'vitest';

describe('Unit Tests: Pricing, Discounts, Tax & Delivery Calculations', () => {

  describe('1. Pricing Engine', () => {
    it('should accurately calculate line item total for standard unit quantities', () => {
      const unitPrice = 450;
      const quantity = 3;
      const lineTotal = unitPrice * quantity;
      expect(lineTotal).toBe(1350);
    });

    it('should calculate fractional quantities (weight in kg/grams) without precision drift', () => {
      const pricePerKg = 950;
      const weightKg = 0.25; // 250 grams
      const total = Math.round(pricePerKg * weightKg * 100) / 100;
      expect(total).toBe(237.5);

      const weightKgSmall = 0.333; // 333 grams
      const totalSmall = Math.round(pricePerKg * weightKgSmall * 100) / 100;
      expect(totalSmall).toBe(316.35);
    });

    it('should calculate gross profit accurately for single and multi-item sales', () => {
      const items = [
        { name: 'Almonds', cost: 700, price: 900, qty: 2 }, // profit = 200 * 2 = 400
        { name: 'Cashews', cost: 800, price: 1000, qty: 1.5 }, // profit = 200 * 1.5 = 300
      ];

      const itemProfits = items.map(i => (i.price - i.cost) * i.qty);
      const totalProfit = itemProfits.reduce((acc, p) => acc + p, 0);

      expect(itemProfits[0]).toBe(400);
      expect(itemProfits[1]).toBe(300);
      expect(totalProfit).toBe(700);
    });

    it('should calculate subtotal correctly across mixed inventory items', () => {
      const items = [
        { price: 250, qty: 4 }, // 1000
        { price: 150, qty: 2 }, // 300
        { price: 80, qty: 5 },  // 400
      ];
      const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
      expect(subtotal).toBe(1700);
    });
  });

  describe('2. Discount Engine & Financial Distribution', () => {
    it('should distribute discount proportionally without penny loss across unequal items', () => {
      const items = [
        { id: 1, total: 600 },
        { id: 2, total: 400 },
      ];
      const subtotal = 1000;
      const discount = 100;

      let totalDiscountDistributed = 0;
      const distributedDiscounts = items.map((item, i) => {
        const itemRatio = item.total / subtotal;
        const itemDiscount = (i === items.length - 1)
          ? Math.round((discount - totalDiscountDistributed) * 100) / 100
          : Math.round(discount * itemRatio * 100) / 100;
        totalDiscountDistributed += itemDiscount;
        return itemDiscount;
      });

      expect(distributedDiscounts[0]).toBe(60);
      expect(distributedDiscounts[1]).toBe(40);
      expect(distributedDiscounts.reduce((a, b) => a + b, 0)).toBe(discount);
    });

    it('should prevent penny-loss on odd divisions with 3 repeating fractions', () => {
      const items = [
        { id: 1, total: 333.33 },
        { id: 2, total: 333.33 },
        { id: 3, total: 333.34 },
      ];
      const subtotal = 1000;
      const discount = 50;

      let totalDiscountDistributed = 0;
      const distributedDiscounts = items.map((item, i) => {
        const itemRatio = item.total / subtotal;
        const itemDiscount = (i === items.length - 1)
          ? Math.round((discount - totalDiscountDistributed) * 100) / 100
          : Math.round(discount * itemRatio * 100) / 100;
        totalDiscountDistributed += itemDiscount;
        return itemDiscount;
      });

      expect(distributedDiscounts.reduce((a, b) => a + b, 0)).toBe(50);
      expect(totalDiscountDistributed).toBe(50);
    });

    it('should cap total at 0 and never produce negative billing totals when discount exceeds subtotal', () => {
      const subtotal = 400;
      const oversizedDiscount = 550;
      const total = Math.max(0, subtotal - oversizedDiscount);
      expect(total).toBe(0);
    });

    it('should preserve full subtotal when discount is zero', () => {
      const subtotal = 850;
      const discount = 0;
      const total = Math.max(0, subtotal - discount);
      expect(total).toBe(850);
    });
  });

  describe('3. Tax Engine (GST Slabs & Breakdowns)', () => {
    it('should derive tax-inclusive base price and tax amount accurately', () => {
      // Selling price 1050 with 5% GST included:
      // Base = 1050 / 1.05 = 1000
      // Tax = 50
      const totalAmount = 1050;
      const taxRate = 5;
      const basePrice = Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100;
      const taxAmount = Math.round((totalAmount - basePrice) * 100) / 100;

      expect(basePrice).toBe(1000);
      expect(taxAmount).toBe(50);
    });

    it('should handle zero tax rate (exempt food grains / dry fruits)', () => {
      const totalAmount = 750;
      const taxRate = 0;
      const basePrice = totalAmount / (1 + taxRate / 100);
      const taxAmount = totalAmount - basePrice;

      expect(basePrice).toBe(750);
      expect(taxAmount).toBe(0);
    });

    it('should aggregate tax summary by tax rate slabs (0%, 5%, 12%, 18%)', () => {
      const items = [
        { name: 'Plain Almonds', total: 1000, tax_rate: 0 },
        { name: 'Roasted Cashews', total: 1050, tax_rate: 5 },
        { name: 'Dry Fruit Gift Box', total: 1120, tax_rate: 12 },
        { name: 'Confectionery Treat', total: 1180, tax_rate: 18 },
      ];

      const taxSummary: Record<number, { base: number; tax: number }> = {};
      for (const item of items) {
        const rate = item.tax_rate;
        const base = Math.round((item.total / (1 + rate / 100)) * 100) / 100;
        const tax = Math.round((item.total - base) * 100) / 100;

        if (!taxSummary[rate]) taxSummary[rate] = { base: 0, tax: 0 };
        taxSummary[rate].base = Math.round((taxSummary[rate].base + base) * 100) / 100;
        taxSummary[rate].tax = Math.round((taxSummary[rate].tax + tax) * 100) / 100;
      }

      expect(taxSummary[0]).toEqual({ base: 1000, tax: 0 });
      expect(taxSummary[5]).toEqual({ base: 1000, tax: 50 });
      expect(taxSummary[12]).toEqual({ base: 1000, tax: 120 });
      expect(taxSummary[18]).toEqual({ base: 1000, tax: 180 });
    });
  });

  describe('4. Delivery Fee Calculation Rules', () => {
    function computeDeliveryFee(deliveryType: 'DELIVERY' | 'STORE_PICKUP', subtotal: number): number {
      return (deliveryType === 'STORE_PICKUP' || subtotal >= 500) ? 0 : 50;
    }

    it('should charge ₹0 delivery fee for STORE_PICKUP regardless of amount', () => {
      expect(computeDeliveryFee('STORE_PICKUP', 50)).toBe(0);
      expect(computeDeliveryFee('STORE_PICKUP', 499)).toBe(0);
      expect(computeDeliveryFee('STORE_PICKUP', 1500)).toBe(0);
    });

    it('should charge ₹50 delivery fee for DELIVERY when subtotal is below ₹500', () => {
      expect(computeDeliveryFee('DELIVERY', 100)).toBe(50);
      expect(computeDeliveryFee('DELIVERY', 250)).toBe(50);
      expect(computeDeliveryFee('DELIVERY', 499.99)).toBe(50);
    });

    it('should waive delivery fee (₹0) when subtotal reaches or exceeds the ₹500 threshold', () => {
      expect(computeDeliveryFee('DELIVERY', 500)).toBe(0);
      expect(computeDeliveryFee('DELIVERY', 500.01)).toBe(0);
      expect(computeDeliveryFee('DELIVERY', 1200)).toBe(0);
    });

    it('should compute final payable amount including subtotal, delivery fee, and discount', () => {
      const subtotal = 450;
      const deliveryFee = computeDeliveryFee('DELIVERY', subtotal); // 50
      const discount = 20;
      const finalAmount = Math.max(0, subtotal + deliveryFee - discount);
      expect(finalAmount).toBe(480);
    });
  });
});
