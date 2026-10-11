import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Job } from '../types.js';
import { billRepository } from '../../repositories/bill.repository.js';
import { saleRepository } from '../../repositories/sale.repository.js';
import { productService } from '../../services/product.service.js';
import logger from '../../logger.js';

export interface PdfJobPayload {
  type: 'bill' | 'invoice' | 'report';
  billId?: number;
  outputPath?: string;
}

const pdfStorageDir = path.join(process.cwd(), 'data', 'generated_pdfs');
if (!fs.existsSync(pdfStorageDir)) {
  fs.mkdirSync(pdfStorageDir, { recursive: true });
}

export async function processPdfGeneration(payload: PdfJobPayload, job: Job<PdfJobPayload>): Promise<{ filePath: string }> {
  const { type, billId } = payload;
  logger.info(`[Queue] Processing PDF generation for ${type} #${billId} (Job #${job.id})`);

  if (type === 'bill' || type === 'invoice') {
    if (!billId) throw new Error('Missing billId in PDF generation payload');
    const bill = billRepository.getBillById(billId);
    if (!bill) throw new Error(`Bill #${billId} not found`);

    const sales = saleRepository.getSalesByBillId(billId);
    const items = sales.map((sale) => {
      const prod = productService.getProductById(sale.product_id);
      return {
        name: prod ? prod.name : 'Unknown Product',
        qty: sale.qty_sold,
        price: sale.unit_price,
        total: sale.qty_sold * sale.unit_price
      };
    });

    const targetFile = payload.outputPath || path.join(pdfStorageDir, `bill_${billId}.pdf`);

    return new Promise((resolve, reject) => {
      const docHeight = 350 + items.length * 25;
      const doc = new PDFDocument({ margin: 10, size: [226, docHeight] });
      const stream = fs.createWriteStream(targetFile);

      doc.pipe(stream);

      doc.fontSize(14).font('Helvetica-Bold').text('Sri Tirumala Dryfruits', { align: 'center', width: 206 });
      doc.fontSize(8).font('Helvetica').text('Opp. RTC Complex, Tekkali, AP-532201', { align: 'center', width: 206 });
      doc.text('Ph: +91 9133133931', { align: 'center', width: 206 });
      doc.moveDown(0.5);

      doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
      doc.moveDown(0.3);

      doc.fontSize(9).font('Helvetica-Bold').text(`Bill No: #${bill.id}`, { continued: true });
      doc.font('Helvetica').text(`Date: ${bill.bill_date}`, { align: 'right' });

      if (bill.customer_name) {
        doc.text(`Cust: ${bill.customer_name}`);
      }

      doc.moveDown(0.5);
      doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
      doc.moveDown(0.3);

      doc.fontSize(8).font('Helvetica-Bold');
      const thY = doc.y;
      doc.text('Item', 10, thY, { width: 95 });
      doc.text('Qty', 105, thY, { width: 30, align: 'right' });
      doc.text('Rate', 135, thY, { width: 35, align: 'right' });
      doc.text('Amt', 170, thY, { width: 46, align: 'right' });
      doc.moveDown(0.2);
      doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(8);
      items.forEach((item) => {
        const y = doc.y;
        doc.text(item.name, 10, y, { width: 95 });
        doc.text(item.qty.toFixed(2), 105, y, { width: 30, align: 'right' });
        doc.text(item.price.toFixed(2), 135, y, { width: 35, align: 'right' });
        doc.text(item.total.toFixed(2), 170, y, { width: 46, align: 'right' });
        doc.moveDown(0.2);
      });

      doc.moveTo(10, doc.y).lineTo(216, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Grand Total:', 10, doc.y, { continued: true });
      doc.text(`INR ${bill.total_amount.toFixed(2)}`, { align: 'right' });

      doc.end();

      stream.on('finish', () => {
        logger.info(`[Queue] PDF generated successfully at ${targetFile}`);
        resolve({ filePath: targetFile });
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  throw new Error(`Unsupported PDF type: ${type}`);
}
