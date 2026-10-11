import { describe, it, expect } from 'vitest';
import { FinancialCalculator } from '../../src/utils/financial.js';

describe('Centralized Financial Calculations Engine (Unit Tests)', () => {

  describe('Currency & Percentage Rounding', () => {
    it('roundCurrency should round correctly to 2 decimal places and eliminate float artifacts', () => {
      expect(FinancialCalculator.roundCurrency(100.456)).toBe(100.46);
      expect(FinancialCalculator.roundCurrency(100.454)).toBe(100.45);
      expect(FinancialCalculator.roundCurrency(0.1 + 0.2)).toBe(0.3);
      expect(FinancialCalculator.roundCurrency(0)).toBe(0);
      expect(FinancialCalculator.roundCurrency(null)).toBe(0);
      expect(FinancialCalculator.roundCurrency(undefined)).toBe(0);
      expect(FinancialCalculator.roundCurrency(NaN)).toBe(0);
    });

    it('roundPercentage should round to specified decimal places and handle edge values', () => {
      expect(FinancialCalculator.roundPercentage(25.6789, 2)).toBe(25.68);
      expect(FinancialCalculator.roundPercentage(25.6789, 1)).toBe(25.7);
      expect(FinancialCalculator.roundPercentage(0)).toBe(0);
      expect(FinancialCalculator.roundPercentage(Infinity)).toBe(0);
      expect(FinancialCalculator.roundPercentage(-Infinity)).toBe(0);
      expect(FinancialCalculator.roundPercentage(NaN)).toBe(0);
    });
  });

  describe('Revenue Calculations', () => {
    it('calculateGrossRevenue should compute sum of price * quantity across all line items', () => {
      const items = [
        { price: 850, quantity: 2 },  // 1700
        { price: 120, quantity: 3 },  // 360
        { price: 450, quantity: 1 }   // 450
      ];
      expect(FinancialCalculator.calculateGrossRevenue(items)).toBe(2510);
    });

    it('calculateGrossRevenue should return 0 for empty or invalid item arrays', () => {
      expect(FinancialCalculator.calculateGrossRevenue([])).toBe(0);
      expect(FinancialCalculator.calculateGrossRevenue(null as any)).toBe(0);
    });

    it('calculateNetRevenue should subtract discount and add delivery charge safely', () => {
      // Gross 1000, Discount 100, Delivery 50 -> 950
      expect(FinancialCalculator.calculateNetRevenue(1000, 100, 50)).toBe(950);

      // Discount exceeds gross -> caps at 0 before delivery
      expect(FinancialCalculator.calculateNetRevenue(100, 200, 50)).toBe(50);

      // Zero discounts and free delivery
      expect(FinancialCalculator.calculateNetRevenue(500, 0, 0)).toBe(500);
    });
  });

  describe('COGS & Gross Profit Calculations', () => {
    it('calculateCOGS should compute total cost of goods sold across items', () => {
      const items = [
        { costPrice: 600, quantity: 2 }, // 1200
        { costPrice: 80, quantity: 3 }   // 240
      ];
      expect(FinancialCalculator.calculateCOGS(items)).toBe(1440);
    });

    it('calculateGrossProfit should compute revenue minus cogs', () => {
      expect(FinancialCalculator.calculateGrossProfit(2500, 1500)).toBe(1000);
      expect(FinancialCalculator.calculateGrossProfit(1500, 1500)).toBe(0); // Breakeven
      expect(FinancialCalculator.calculateGrossProfit(1000, 1500)).toBe(-500); // Loss scenario
    });
  });

  describe('Profit Margin % Calculations', () => {
    it('calculateProfitMargin should compute (profit / revenue) * 100 correctly', () => {
      // Profit 400 on Revenue 1000 -> 40.0%
      expect(FinancialCalculator.calculateProfitMargin(400, 1000)).toBe(40);

      // Profit 250 on Revenue 850 -> 29.41%
      expect(FinancialCalculator.calculateProfitMargin(250, 850)).toBe(29.41);
    });

    it('calculateProfitMargin should safely return 0 when revenue is 0 or negative', () => {
      expect(FinancialCalculator.calculateProfitMargin(0, 0)).toBe(0);
      expect(FinancialCalculator.calculateProfitMargin(100, 0)).toBe(0);
      expect(FinancialCalculator.calculateProfitMargin(100, -50)).toBe(0);
    });

    it('calculateProfitMargin should calculate 100% margin when COGS is 0 (pure digital/gift)', () => {
      expect(FinancialCalculator.calculateProfitMargin(500, 500)).toBe(100);
    });

    it('calculateProfitMargin should calculate negative margin on net loss', () => {
      // Loss of 200 on Revenue 1000 -> -20%
      expect(FinancialCalculator.calculateProfitMargin(-200, 1000)).toBe(-20);
    });
  });

  describe('Average Order Value (AOV) Calculations', () => {
    it('calculateAOV should compute totalRevenue / orderCount correctly', () => {
      expect(FinancialCalculator.calculateAOV(10000, 20)).toBe(500);
      expect(FinancialCalculator.calculateAOV(1550, 3)).toBe(516.67);
    });

    it('calculateAOV should safely return 0 when order count is 0', () => {
      expect(FinancialCalculator.calculateAOV(5000, 0)).toBe(0);
      expect(FinancialCalculator.calculateAOV(0, 0)).toBe(0);
      expect(FinancialCalculator.calculateAOV(0, 10)).toBe(0);
    });
  });

  describe('Customer Retention & Conversion Rates', () => {
    it('calculateRepeatCustomerRate should compute percentage of repeat customers', () => {
      expect(FinancialCalculator.calculateRepeatCustomerRate(25, 100)).toBe(25);
      expect(FinancialCalculator.calculateRepeatCustomerRate(1, 3)).toBe(33.33);
      expect(FinancialCalculator.calculateRepeatCustomerRate(0, 50)).toBe(0);
      expect(FinancialCalculator.calculateRepeatCustomerRate(10, 0)).toBe(0);
    });

    it('calculateCancellationRate should compute percentage of cancelled orders', () => {
      expect(FinancialCalculator.calculateCancellationRate(5, 100)).toBe(5);
      expect(FinancialCalculator.calculateCancellationRate(2, 7)).toBe(28.57);
      expect(FinancialCalculator.calculateCancellationRate(0, 50)).toBe(0);
      expect(FinancialCalculator.calculateCancellationRate(5, 0)).toBe(0);
    });

    it('calculateWhatsAppConversionRate should compute percentage of confirmed orders from notifications', () => {
      expect(FinancialCalculator.calculateWhatsAppConversionRate(40, 100)).toBe(40);
      expect(FinancialCalculator.calculateWhatsAppConversionRate(15, 30)).toBe(50);
      expect(FinancialCalculator.calculateWhatsAppConversionRate(0, 50)).toBe(0);
      expect(FinancialCalculator.calculateWhatsAppConversionRate(5, 0)).toBe(0);
    });
  });

  describe('Product-Level Profitability Bundle', () => {
    it('calculateProductProfit should return accurate financial metrics bundle for a product', () => {
      // Selling price 850, Cost price 600, Sold 10 units
      const result = FinancialCalculator.calculateProductProfit(850, 600, 10);

      expect(result.revenue).toBe(8500);
      expect(result.cogs).toBe(6000);
      expect(result.profit).toBe(2500);
      expect(result.marginPercent).toBe(29.41);
    });

    it('calculateProductProfit should handle 0 units sold cleanly without NaN', () => {
      const result = FinancialCalculator.calculateProductProfit(850, 600, 0);

      expect(result.revenue).toBe(0);
      expect(result.cogs).toBe(0);
      expect(result.profit).toBe(0);
      expect(result.marginPercent).toBe(0);
    });
  });

});
