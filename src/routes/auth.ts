import express from 'express';
import rateLimit from 'express-rate-limit';
import { csrfProtection } from '../middleware/auth.js';
import { authController } from '../controllers/auth.controller.js';

const router = express.Router();

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', csrfProtection, authController.getLogin.bind(authController));
router.post('/login', loginLimiter, csrfProtection, authController.postLogin.bind(authController));
router.get('/logout', authController.logout.bind(authController));
router.post('/logout', authController.logout.bind(authController));

router.get('/shift/open', csrfProtection, authController.getShiftOpen.bind(authController));
router.post('/shift/open', csrfProtection, authController.postShiftOpen.bind(authController));
router.get('/shift/close', csrfProtection, authController.getShiftClose.bind(authController));
router.post('/shift/close', csrfProtection, authController.postShiftClose.bind(authController));

export default router;
