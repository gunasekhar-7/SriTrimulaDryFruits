import { Request, Response } from 'express';
import { billingService } from '../services/billing.service.js';
import { productService } from '../services/product.service.js';
import { userService } from '../services/user.service.js';
import { analyticsService } from '../services/analytics.service.js';
import { FinancialCalculator } from '../utils/financial.js';
import { billRepository } from '../repositories/bill.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { auditService } from '../services/audit.service.js';
import logger from '../logger.js';

export class AdminController {
  getSearchBill(req: Request, res: Response) {
    const billIdStr = req.query.bill_id as string;
    if (billIdStr) {
      const billId = parseInt(billIdStr);
      const bill = billRepository.getBillById(billId);
      if (bill) {
        const sales = saleRepository.getSalesByBillId(billId);
        const items = sales.map(sale => {
          const prod = productService.getProductById(sale.product_id);
          return {
            sale_id: sale.id, product_id: sale.product_id,
            name: prod ? prod.name : 'Unknown Product',
            qty: sale.qty_sold, price: sale.unit_price,
            mrp: prod ? prod.mrp : sale.unit_price,
            tax_rate: prod ? (prod.tax_rate || 0) : 0,
            total: sale.qty_sold * sale.unit_price
          };
        });
        return res.render('bill', {
          items, total: bill.total_amount,
          subtotal: bill.total_amount + (bill.discount_amount || 0),
          discount_amount: bill.discount_amount || 0,
          customer_name: bill.customer_name || '',
          customer_phone: bill.customer_phone || '',
          date: bill.bill_date, time: bill.bill_time,
          sale_id: bill.id, allow_return: true,
          csrfToken: res.locals.csrfToken
        });
      } else {
        return res.render('search', { error: '❌ Bill Number Not Found', csrfToken: res.locals.csrfToken });
      }
    }
    res.render('search', { error: null, csrfToken: res.locals.csrfToken });
  }

  postSearchBill(req: Request, res: Response) {
    res.redirect(`/search_bill?bill_id=${req.body.bill_id}`);
  }

  returnItem(req: Request, res: Response) {
    try {
      const bill_id = parseInt(req.body.bill_id);
      const sale_id = parseInt(req.body.sale_id);
      const product_id = parseInt(req.body.product_id);
      const return_qty = parseFloat(req.body.return_qty);

      const product = productService.getProductById(product_id);
      const actor = auditService.extractActor(req);
      const source = auditService.extractSource(req, 'POS_RETURN');
      const success = billingService.returnItem(bill_id, sale_id, product_id, return_qty, actor, source);

      if (success && product) {
        logger.info(`Return: ${return_qty} x ${product.name} for Bill #${bill_id} by ${req.session.user}`);
        req.flash('info', `✅ Returned ${return_qty} x ${product.name}`);
      } else {
        req.flash('info', '❌ Invalid Return Quantity!');
      }
      res.redirect(`/search_bill?bill_id=${bill_id}`);
    } catch (e: any) {
      req.flash('info', `Error: ${e.message}`);
      res.redirect('/search_bill');
    }
  }

  getProfit(req: Request, res: Response) {
    const bills = billRepository.getBills();
    const grouped_data: Record<string, { daily_profit: number; daily_sales: number; bills: any[]; revenue_by_method: Record<string, number> }> = {};

    for (const bill of bills) {
      const sales = saleRepository.getSalesByBillId(bill.id);
      const billProfit = sales.reduce((sum, s) => sum + s.profit_made, 0);
      if (!grouped_data[bill.bill_date]) {
        grouped_data[bill.bill_date] = { daily_profit: 0, daily_sales: 0, bills: [], revenue_by_method: { Cash: 0, UPI: 0, Card: 0 } };
      }
      const method = bill.payment_method || 'Cash';
      if (!grouped_data[bill.bill_date].revenue_by_method[method]) {
        grouped_data[bill.bill_date].revenue_by_method[method] = 0;
      }
      grouped_data[bill.bill_date].revenue_by_method[method] += bill.total_amount;

      grouped_data[bill.bill_date].bills.push({ bill_id: bill.id, bill_date: bill.bill_date, bill_time: bill.bill_time, bill_total: bill.total_amount, bill_profit: billProfit, payment_method: method });
      grouped_data[bill.bill_date].daily_profit += billProfit;
      grouped_data[bill.bill_date].daily_sales += bill.total_amount;
    }
    let grand_total_sales = 0;
    let grand_total_profit = 0;
    let total_bills_count = 0;
    const overall_revenue_by_method: Record<string, number> = { Cash: 0, UPI: 0, Card: 0 };

    Object.keys(grouped_data).forEach(date => {
      grand_total_sales += grouped_data[date].daily_sales;
      grand_total_profit += grouped_data[date].daily_profit;
      total_bills_count += grouped_data[date].bills.length;
      Object.keys(grouped_data[date].revenue_by_method).forEach(method => {
        overall_revenue_by_method[method] = (overall_revenue_by_method[method] || 0) + grouped_data[date].revenue_by_method[method];
      });
      grouped_data[date].bills.sort((a, b) => b.bill_id - a.bill_id);
    });

    grand_total_sales = FinancialCalculator.roundCurrency(grand_total_sales);
    grand_total_profit = FinancialCalculator.roundCurrency(grand_total_profit);
    const profit_margin = FinancialCalculator.calculateProfitMargin(grand_total_profit, grand_total_sales);

    res.render('profit', {
      data: grouped_data,
      grand_total_sales,
      grand_total_profit,
      total_bills_count,
      profit_margin,
      overall_revenue_by_method,
      csrfToken: res.locals.csrfToken
    });
  }

  updateProfit(req: Request, res: Response) {
    const bill_id = parseInt(req.body.bill_id);
    const new_profit = parseFloat(req.body.new_profit);
    if (!isNaN(bill_id) && !isNaN(new_profit)) {
      const success = billingService.updateProfitForBill(bill_id, new_profit);
      if (success) req.flash('info', `✅ Profit updated for Bill #${bill_id}`);
    }
    res.redirect('/profit');
  }

  getAnalytics(req: Request, res: Response) {
    const filter: any = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      preset: req.query.preset as any,
      category: req.query.category as string,
      productId: req.query.productId ? parseInt(req.query.productId as string, 10) : undefined,
      channel: req.query.channel as any,
      status: req.query.status as any
    };

    const analytics = analyticsService.getAnalyticsSummary(filter);
    const categories = productService.getCategories();
    const products = productService.getProducts();

    res.render('analytics', {
      analytics,
      categories,
      products,
      filter: analytics.filter,
      labels: analytics.bestSellingProducts.map(p => p.name),
      values: analytics.bestSellingProducts.map(p => p.quantitySold)
    });
  }

  getAnalyticsApi(req: Request, res: Response) {
    const filter: any = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      preset: req.query.preset as any,
      category: req.query.category as string,
      productId: req.query.productId ? parseInt(req.query.productId as string, 10) : undefined,
      channel: req.query.channel as any,
      status: req.query.status as any
    };

    const analytics = analyticsService.getAnalyticsSummary(filter);
    res.json({
      success: true,
      data: analytics
    });
  }

  getSettings(req: Request, res: Response) {
    const users = userService.getUsers();
    res.render('settings', { users, csrfToken: res.locals.csrfToken });
  }

  updateUser(req: Request, res: Response) {
    const user_id = parseInt(req.body.user_id);
    const { username, password, role } = req.body;
    if (!username) {
      req.flash('info', '❌ Username is required.');
      return res.redirect('/settings');
    }
    try {
      const actor = auditService.extractActor(req);
      const source = auditService.extractSource(req, 'ADMIN_SETTINGS');
      userService.updateUser(user_id, username, password, role, actor, source);
      logger.info(`User updated: id=${user_id} by ${req.session.user}`);
      req.flash('info', `✅ Details updated for user: ${username}`);
    } catch (e: any) {
      req.flash('info', `❌ Error: ${e.message}`);
    }
    res.redirect('/settings');
  }

  getAuditLogs(req: Request, res: Response) {
    const pageNum = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;
    const limitNum = req.query.limit ? Math.min(100, Math.max(10, parseInt(req.query.limit as string, 10))) : 50;
    const offset = (pageNum - 1) * limitNum;

    const filter: any = {
      action: req.query.action as any,
      entity: req.query.entity as any,
      actor: req.query.actor as string,
      entityId: req.query.entityId as string,
      source: req.query.source as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      search: req.query.search as string,
      limit: limitNum,
      offset
    };

    const result = auditService.queryAuditLogs(filter);
    const stats = auditService.getAuditStats();
    const integrity = auditService.verifyLedgerIntegrity();

    res.render('audit_logs', {
      logs: result.logs,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      limit: result.limit,
      stats,
      integrity,
      filter: {
        action: filter.action || 'ALL',
        entity: filter.entity || 'ALL',
        actor: filter.actor || '',
        entityId: filter.entityId || '',
        source: filter.source || '',
        startDate: filter.startDate || '',
        endDate: filter.endDate || '',
        search: filter.search || ''
      },
      csrfToken: res.locals.csrfToken
    });
  }

  getAuditLogsApi(req: Request, res: Response) {
    const pageNum = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;
    const limitNum = req.query.limit ? Math.min(100, Math.max(10, parseInt(req.query.limit as string, 10))) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : (pageNum - 1) * limitNum;

    const filter: any = {
      action: req.query.action as any,
      entity: req.query.entity as any,
      actor: req.query.actor as string,
      entityId: req.query.entityId as string,
      source: req.query.source as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      search: req.query.search as string,
      limit: limitNum,
      offset
    };

    const result = auditService.queryAuditLogs(filter);
    const stats = auditService.getAuditStats();
    const integrity = auditService.verifyLedgerIntegrity();

    res.json({
      success: true,
      data: {
        ...result,
        stats,
        integrity
      }
    });
  }

  verifyAuditLedgerApi(req: Request, res: Response) {
    const integrity = auditService.verifyLedgerIntegrity();
    res.json({
      success: true,
      data: integrity
    });
  }
}

export const adminController = new AdminController();
