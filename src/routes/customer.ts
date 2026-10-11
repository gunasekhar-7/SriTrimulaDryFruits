import express from 'express';
import { requireCustomerAuth, csrfProtection } from '../middleware/auth.js';
import { customerController } from '../controllers/customer.controller.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100 : 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

const customerRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTest ? 100 : 5,
  message: 'Too many registration attempts. Please try again later.',
});

const customerOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100 : 5,
  message: { success: false, message: 'Too many OTP requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', csrfProtection, customerController.getLogin.bind(customerController));
router.post('/login', customerLoginLimiter, csrfProtection, customerController.postLogin.bind(customerController));
router.get('/register', csrfProtection, customerController.getRegister.bind(customerController));
router.post('/send-otp', customerOtpLimiter, csrfProtection, customerController.postSendOtp.bind(customerController));
router.post('/register', customerRegisterLimiter, csrfProtection, customerController.postRegister.bind(customerController));
router.post('/logout', csrfProtection, customerController.logout.bind(customerController));

router.get('/dashboard', (req, res) => res.redirect('/account'));

export default router;
