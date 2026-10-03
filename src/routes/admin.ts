import express from 'express';
import * as repo from '../repository.js';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';
import logger from '../logger.js';

const router = express.Router();

// GET /search_bill
router.get('/search_bill', requireAuth, csrfProtection, (req, res) => {
  const billIdStr = req.query.bill_id as string;
  if (billIdStr) {
    const billId = parseInt(billIdStr);
    const bill = repo.getBillById(billId);
    if (bill) {
      const sales = repo.getSalesByBillId(billId);
      const items = sales.map(sale => {
        const prod = repo.getProductById(sale.product_id);
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
});

// POST /search_bill
router.post('/search_bill', requireAuth, csrfProtection, (req, res) => {
  res.redirect(`/search_bill?bill_id=${req.body.bill_id}`);
});

// POST /return_item
router.post('/return_item', requireAuth, csrfProtection, (req, res) => {
  try {
    const bill_id = parseInt(req.body.bill_id);
    const sale_id = parseInt(req.body.sale_id);
    const product_id = parseInt(req.body.product_id);
    const return_qty = parseFloat(req.body.return_qty);

    const product = repo.getProductById(product_id);
    const success = repo.returnItem(bill_id, sale_id, product_id, return_qty);

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
});

// GET /profit
router.get('/profit', requireAdmin, (req, res) => {
  const bills = repo.getBills();
  const grouped_data: Record<string, { daily_profit: number; daily_sales: number; bills: any[]; revenue_by_method: Record<string, number> }> = {};

  for (const bill of bills) {
    const sales = repo.getSalesByBillId(bill.id);
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
  Object.keys(grouped_data).forEach(date => {
    grouped_data[date].bills.sort((a, b) => b.bill_id - a.bill_id);
  });
  res.render('profit', { data: grouped_data });
});

// POST /update_profit
router.post('/update_profit', requireAdmin, csrfProtection, (req, res) => {
  const bill_id = parseInt(req.body.bill_id);
  const new_profit = parseFloat(req.body.new_profit);
  if (!isNaN(bill_id) && !isNaN(new_profit)) {
    const success = repo.updateProfitForBill(bill_id, new_profit);
    if (success) req.flash('info', `✅ Profit updated for Bill #${bill_id}`);
  }
  res.redirect('/profit');
});

// GET /analytics
router.get('/analytics', requireAdmin, (req, res) => {
  const sales = repo.getSales();
  const productQuantities: Record<number, number> = {};
  for (const s of sales) {
    productQuantities[s.product_id] = (productQuantities[s.product_id] || 0) + s.qty_sold;
  }
  const sortedProducts = Object.keys(productQuantities)
    .map(idStr => {
      const id = parseInt(idStr);
      const prod = repo.getProductById(id);
      return { name: prod ? prod.name : 'Unknown', qty: productQuantities[id] };
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  res.render('analytics', { labels: sortedProducts.map(p => p.name), values: sortedProducts.map(p => p.qty) });
});

// GET /settings
router.get('/settings', requireAdmin, csrfProtection, (req, res) => {
  const users = repo.getUsers();
  res.render('settings', { users, csrfToken: res.locals.csrfToken });
});

// POST /update_user
router.post('/update_user', requireAdmin, csrfProtection, (req, res) => {
  const user_id = parseInt(req.body.user_id);
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('info', '❌ Username and password are required.');
    return res.redirect('/settings');
  }
  try {
    repo.updateUser(user_id, username, password);
    logger.info(`User credentials updated: id=${user_id} by ${req.session.user}`);
    req.flash('info', `✅ Credentials updated for user: ${username}`);
  } catch (e: any) {
    req.flash('info', `❌ Error: ${e.message}`);
  }
  res.redirect('/settings');
});

export default router;
