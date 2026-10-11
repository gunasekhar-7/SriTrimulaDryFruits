import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pdfController } from '../controllers/pdf.controller.js';

const router = express.Router();

router.get('/bill/pdf/:id', requireAuth, pdfController.downloadBillPdf.bind(pdfController));

export default router;
