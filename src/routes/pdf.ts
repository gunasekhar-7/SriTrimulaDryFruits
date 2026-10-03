import express from 'express';
import PDFDocument from 'pdfkit';
import * as repo from '../repository.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /bill/pdf/:id  — Download PDF receipt
router.get('/bill/pdf/:id', requireAuth, (req, res) => {
  const billId = parseInt(req.params.id);
  const bill = repo.getBillById(billId);

  if (!bill) {
    return res.status(404).render('error', { statusCode: 404, title: 'Not Found', message: 'Bill not found.' });
  }

  const sales = repo.getSalesByBillId(billId);
  const items = sales.map(sale => {
    const prod = repo.getProductById(sale.product_id);
    return {
      name: prod ? prod.name : 'Unknown Product',
      qty: sale.qty_sold,
      price: sale.unit_price,
      total: sale.qty_sold * sale.unit_price,
      tax_rate: prod ? (prod.tax_rate || 0) : 0
    };
  });

  // Calculate dynamic height for 80mm roll (226 pts width)
  const uniqueTaxRates = Array.from(new Set(items.map(i => i.tax_rate || 0))).filter(r => r > 0);
  const docHeight = 350 + (items.length * 25) + (uniqueTaxRates.length * 20);
  const doc = new PDFDocument({ margin: 10, size: [226, docHeight] });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Bill-${billId}.pdf"`);
  doc.pipe(res);

  // ─── Header ─────────────────────────────────────────────────────────────
  doc.fontSize(14).font('Helvetica-Bold').text('Sri Tirumala Dryfruits', { align: 'center', width: 206 });
  doc.fontSize(8).font('Helvetica').text('Opp. RTC Complex, Tekkali, AP-532201', { align: 'center', width: 206 });
  doc.text('Ph: +91 9133133931', { align: 'center', width: 206 });
  doc.moveDown(0.5);

  // Divider
  doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.3);

  // ─── Bill Info ──────────────────────────────────────────────────────────
  doc.fontSize(9).font('Helvetica-Bold').text(`Bill No: #${bill.id}`, { continued: true });
  doc.font('Helvetica').text(`Date: ${bill.bill_date}`, { align: 'right' });

  if (bill.customer_name) {
    doc.text(`Cust: ${bill.customer_name}`, { continued: !!bill.customer_phone });
    if (bill.customer_phone) doc.text(` Ph: ${bill.customer_phone}`, { align: 'right' });
  }

  doc.moveDown(0.5);
  doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.3);

  // ─── Items Header ───────────────────────────────────────────────────────
  doc.fontSize(8).font('Helvetica-Bold');
  const thY = doc.y;
  doc.text('Item', 10, thY, { width: 95 });
  doc.text('Qty', 105, thY, { width: 30, align: 'right' });
  doc.text('Rate', 135, thY, { width: 35, align: 'right' });
  doc.text('Amt', 170, thY, { width: 46, align: 'right' });
  doc.moveDown(0.2);
  doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.3);

  // ─── Items ──────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8);
  items.forEach((item, i) => {
    const y = doc.y;
    doc.text(item.name, 10, y, { width: 95 });
    doc.text(item.qty.toFixed(3), 105, y, { width: 30, align: 'right' });
    doc.text(item.price.toFixed(2), 135, y, { width: 35, align: 'right' });
    doc.text(item.total.toFixed(2), 170, y, { width: 46, align: 'right' });
    doc.moveDown(0.3);
  });

  doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.3);

  // ─── Totals ─────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  doc.fontSize(9).font('Helvetica');
  if (bill.discount_amount && bill.discount_amount > 0) {
    doc.text(`Subtotal: Rs.${subtotal.toFixed(2)}`, 10, doc.y, { align: 'right', width: 206 });
    doc.text(`Discount: -Rs.${bill.discount_amount.toFixed(2)}`, 10, doc.y, { align: 'right', width: 206 });
  }
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(`TOTAL: Rs.${bill.total_amount.toFixed(2)}`, 10, doc.y, { align: 'right', width: 206 });

  doc.moveDown();
  doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
  doc.moveDown(0.5);

  // ─── Tax Summary ────────────────────────────────────────────────────────
  let taxSummary: Record<number, { base: number, tax: number }> = {};
  items.forEach(item => {
    const tRate = item.tax_rate || 0;
    const baseP = item.total / (1 + (tRate / 100));
    const taxAmt = item.total - baseP;
    if (!taxSummary[tRate]) taxSummary[tRate] = { base: 0, tax: 0 };
    taxSummary[tRate].base += baseP;
    taxSummary[tRate].tax += taxAmt;
  });

  const taxRates = Object.keys(taxSummary).map(Number).filter(r => r > 0);
  if (taxRates.length > 0) {
    doc.fontSize(8).font('Helvetica-Bold').text('TAX SUMMARY', 10, doc.y, { align: 'center', width: 206 });
    doc.moveDown(0.2);
    
    // Header
    const tY = doc.y;
    doc.fontSize(7);
    doc.text('Rate', 10, tY, { width: 25 });
    doc.text('Base', 35, tY, { width: 55, align: 'right' });
    doc.text('CGST', 90, tY, { width: 63, align: 'right' });
    doc.text('SGST', 153, tY, { width: 63, align: 'right' });
    doc.moveDown(0.2);
    doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
    doc.moveDown(0.2);

    // Rows
    taxRates.forEach(rate => {
      const rowY = doc.y;
      const base = taxSummary[rate].base;
      const halfTax = taxSummary[rate].tax / 2;
      
      doc.font('Helvetica');
      doc.text(`${rate}%`, 10, rowY, { width: 25 });
      doc.text(`${base.toFixed(2)}`, 35, rowY, { width: 55, align: 'right' });
      doc.text(`${halfTax.toFixed(2)}`, 90, rowY, { width: 63, align: 'right' });
      doc.text(`${halfTax.toFixed(2)}`, 153, rowY, { width: 63, align: 'right' });
      doc.moveDown(0.2);
    });

    doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
    doc.moveDown(0.5);
  }

  // ─── Footer ─────────────────────────────────────────────────────────────
  doc.fontSize(8).font('Helvetica').text('Thank you for shopping with us!', 10, doc.y, { align: 'center', width: 206 });
  doc.text('Returns within 24 hours only.', 10, doc.y, { align: 'center', width: 206 });

  doc.end();
});

export default router;
