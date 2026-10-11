/**
 * ==============================================================================
 * SRI TIRUMALA DRY FRUITS — CENTRALIZED FINANCIAL CALCULATION ENGINE
 * Pure, Deterministic Business Logic for All Revenues, Profits, AOV & Margins
 * ==============================================================================
 */

export class FinancialCalculator {
  /**
   * Rounds a financial currency amount to 2 decimal places, eliminating float rounding artifacts.
   */
  static roundCurrency(amount: number | null | undefined): number {
    if (amount === null || amount === undefined || isNaN(amount)) return 0;
    return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Rounds a percentage value to specified decimal places (default 2).
   */
  static roundPercentage(percent: number | null | undefined, decimals = 2): number {
    if (percent === null || percent === undefined || isNaN(percent) || !isFinite(percent)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((Number(percent) + Number.EPSILON) * factor) / factor;
  }

  /**
   * Calculates gross revenue from an array of sold line items.
   * Formula: Sum(price * quantity)
   */
  static calculateGrossRevenue(items: Array<{ price: number; quantity: number }>): number {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const total = items.reduce((sum, item) => {
      const price = Math.max(0, Number(item.price) || 0);
      const qty = Math.max(0, Number(item.quantity) || 0);
      return sum + (price * qty);
    }, 0);
    return this.roundCurrency(total);
  }

  /**
   * Calculates net revenue after applying discounts and adding delivery charges.
   * Formula: max(0, grossRevenue - discount) + deliveryCharge
   */
  static calculateNetRevenue(grossRevenue: number, discount = 0, deliveryCharge = 0): number {
    const gross = Math.max(0, Number(grossRevenue) || 0);
    const disc = Math.max(0, Number(discount) || 0);
    const delivery = Math.max(0, Number(deliveryCharge) || 0);
    const net = Math.max(0, gross - disc) + delivery;
    return this.roundCurrency(net);
  }

  /**
   * Calculates Cost of Goods Sold (COGS).
   * Formula: Sum(costPrice * quantity)
   */
  static calculateCOGS(items: Array<{ costPrice: number; quantity: number }>): number {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const total = items.reduce((sum, item) => {
      const cost = Math.max(0, Number(item.costPrice) || 0);
      const qty = Math.max(0, Number(item.quantity) || 0);
      return sum + (cost * qty);
    }, 0);
    return this.roundCurrency(total);
  }

  /**
   * Calculates gross profit.
   * Formula: revenue - cogs
   */
  static calculateGrossProfit(revenue: number, cogs: number): number {
    const rev = Number(revenue) || 0;
    const cost = Number(cogs) || 0;
    return this.roundCurrency(rev - cost);
  }

  /**
   * Calculates profit margin percentage.
   * Formula: (profit / revenue) * 100
   * Safely returns 0 when revenue <= 0.
   */
  static calculateProfitMargin(profit: number, revenue: number): number {
    const rev = Number(revenue) || 0;
    const prof = Number(profit) || 0;
    if (rev <= 0) return 0;
    const margin = (prof / rev) * 100;
    return this.roundPercentage(margin, 2);
  }

  /**
   * Calculates Average Order Value (AOV).
   * Formula: totalRevenue / orderCount
   * Safely returns 0 when orderCount <= 0.
   */
  static calculateAOV(totalRevenue: number, orderCount: number): number {
    const rev = Math.max(0, Number(totalRevenue) || 0);
    const count = Math.max(0, Number(orderCount) || 0);
    if (count <= 0) return 0;
    return this.roundCurrency(rev / count);
  }

  /**
   * Calculates repeat customer rate percentage.
   * Formula: (repeatCount / totalCount) * 100
   */
  static calculateRepeatCustomerRate(repeatCount: number, totalCount: number): number {
    const rep = Math.max(0, Number(repeatCount) || 0);
    const tot = Math.max(0, Number(totalCount) || 0);
    if (tot <= 0) return 0;
    return this.roundPercentage((rep / tot) * 100, 2);
  }

  /**
   * Calculates cancellation rate percentage.
   * Formula: (cancelledCount / totalOrders) * 100
   */
  static calculateCancellationRate(cancelledCount: number, totalOrders: number): number {
    const canc = Math.max(0, Number(cancelledCount) || 0);
    const tot = Math.max(0, Number(totalOrders) || 0);
    if (tot <= 0) return 0;
    return this.roundPercentage((canc / tot) * 100, 2);
  }

  /**
   * Calculates WhatsApp conversion rate percentage.
   * Formula: (convertedOrders / totalNotificationsOrAttempts) * 100
   */
  static calculateWhatsAppConversionRate(convertedOrders: number, totalNotifications: number): number {
    const conv = Math.max(0, Number(convertedOrders) || 0);
    const tot = Math.max(0, Number(totalNotifications) || 0);
    if (tot <= 0) return 0;
    return this.roundPercentage((conv / tot) * 100, 2);
  }

  /**
   * Calculates product-level net profit and margin.
   */
  static calculateProductProfit(sellingPrice: number, costPrice: number, quantitySold: number): {
    revenue: number;
    cogs: number;
    profit: number;
    marginPercent: number;
  } {
    const price = Math.max(0, Number(sellingPrice) || 0);
    const cost = Math.max(0, Number(costPrice) || 0);
    const qty = Math.max(0, Number(quantitySold) || 0);

    const revenue = this.roundCurrency(price * qty);
    const cogs = this.roundCurrency(cost * qty);
    const profit = this.roundCurrency(revenue - cogs);
    const marginPercent = this.calculateProfitMargin(profit, revenue);

    return { revenue, cogs, profit, marginPercent };
  }
}
