import { Request, Response } from 'express';
import { z } from 'zod';
import { customerService } from '../services/customer.service.js';
import { otpService } from '../services/otp.service.js';
import { auditService } from '../services/audit.service.js';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';

const registerSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit Indian phone number'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  otp: z.string().optional().or(z.literal('')),
});

const sendOtpSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit Indian phone number'),
  purpose: z.enum(['REGISTRATION', 'ACCOUNT_LINK', 'PHONE_UPDATE']).optional().default('REGISTRATION'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required').max(100),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit Indian phone number'),
  email: z.string().email('Invalid email address'),
});

const addressSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  recipient_name: z.string().min(2, 'Recipient name is required'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid phone number'),
  address_line1: z.string().min(5, 'Address Line 1 is required'),
  address_line2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  pincode: z.string().regex(/^\d{6}$/, 'Invalid 6-digit Pincode'),
  is_default: z.string().optional(),
});

export class CustomerController {
  
  getLogin(req: Request, res: Response) {
    if (req.session.customer_id) return res.redirect('/account');
    res.render('customer_login', { error: req.flash('error'), success: req.flash('success'), csrfToken: res.locals.csrfToken });
  }

  postLogin(req: Request, res: Response, next: import('express').NextFunction) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      metricsAggregator.recordAuthFailure('customer', 'invalid_input_schema');
      auditService.recordFailedLogin({
        actor: req.body.email || 'unknown',
        source: auditService.extractSource(req, 'STOREFRONT_AUTH'),
        reason: 'Invalid input schema'
      });
      req.flash('error', 'Invalid credentials');
      return res.redirect('/customer/login');
    }
    const customer = customerService.authenticate(parsed.data.email, parsed.data.password);
    if (customer) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.customer_id = customer.id;
        auditService.recordLogin({
          actor: `customer:${customer.id} (${customer.email})`,
          source: auditService.extractSource(req, 'STOREFRONT_AUTH'),
          entityId: customer.id,
          metadata: { email: customer.email, name: customer.name }
        });
        return res.redirect('/account');
      });
      return;
    }
    metricsAggregator.recordAuthFailure('customer', 'invalid_credentials');
    auditService.recordFailedLogin({
      actor: parsed.data.email,
      source: auditService.extractSource(req, 'STOREFRONT_AUTH'),
      reason: 'Invalid email or password'
    });
    req.flash('error', 'Invalid Email or Password');
    res.redirect('/customer/login');
  }

  getRegister(req: Request, res: Response) {
    if (req.session.customer_id) return res.redirect('/account');
    res.render('customer_register', { error: req.flash('error'), csrfToken: res.locals.csrfToken });
  }

  async postSendOtp(req: Request, res: Response) {
    const parsed = sendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || 'Invalid input'
      });
    }

    try {
      const result = await otpService.sendOtp(parsed.data.phone, parsed.data.purpose);
      return res.status(200).json({
        success: true,
        message: 'Verification code sent successfully.',
        cooldownSeconds: result.cooldownSeconds,
        expiresSeconds: result.expiresSeconds
      });
    } catch (err: any) {
      const msg = err?.message || '';
      // Rate limits and cooldown
      if (msg.includes('Please wait') || msg.includes('Too many verification requests')) {
        return res.status(429).json({
          success: false,
          message: msg
        });
      }
      // Invalid input / phone
      if (msg.includes('Invalid') || msg.includes('required')) {
        return res.status(400).json({
          success: false,
          message: msg
        });
      }
      // Delivery failure / provider error
      logger.error('[OTP Controller] Delivery failed:', { error: msg });
      return res.status(503).json({
        success: false,
        message: "We couldn't send the verification code right now. Please try again shortly."
      });
    }
  }

  postRegister(req: Request, res: Response, next: import('express').NextFunction) {
    const isJson = req.xhr || req.headers.accept?.includes('application/json');
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues.map(i => i.message).join(', ');
      if (isJson) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      req.flash('error', errorMsg);
      return res.redirect('/customer/register');
    }
    try {
      const customer = customerService.register(
        parsed.data.name,
        parsed.data.phone,
        parsed.data.email,
        parsed.data.password,
        parsed.data.otp?.trim() || undefined
      );
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.customer_id = customer.id;
        auditService.recordLogin({
          actor: `customer:${customer.id} (${customer.email})`,
          source: auditService.extractSource(req, 'STOREFRONT_AUTH'),
          entityId: customer.id,
          metadata: { email: customer.email, name: customer.name, registration: true }
        });
        if (isJson) {
          return res.status(201).json({ success: true, message: 'Registration successful!', redirect: '/account' });
        }
        req.flash('success', 'Registration successful!');
        return res.redirect('/account');
      });
      return;
    } catch (e: any) {
      if (isJson) {
        return res.status(400).json({ success: false, message: e.message });
      }
      req.flash('error', e.message);
      res.redirect('/customer/register');
    }
  }

  logout(req: Request, res: Response) {
    req.session.destroy(() => {
      res.redirect('/customer/login');
    });
  }

  getDashboard(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const customer = customerService.getProfile(req.session.customer_id);
    res.render('customer_dashboard', { customer, csrfToken: res.locals.csrfToken });
  }

  getProfile(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const customer = customerService.getProfile(req.session.customer_id);
    res.render('customer_profile', { customer, error: req.flash('error'), success: req.flash('success'), csrfToken: res.locals.csrfToken });
  }

  postProfile(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map(i => i.message).join(', '));
      return res.redirect('/account/profile');
    }
    try {
      customerService.updateProfile(req.session.customer_id, parsed.data.name, parsed.data.phone, parsed.data.email);
      req.flash('success', 'Profile updated successfully.');
    } catch (e: any) {
      req.flash('error', e.message);
    }
    res.redirect('/account/profile');
  }

  postLinkGuest(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const isJson = req.xhr || req.headers.accept?.includes('application/json');
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      if (isJson) return res.status(400).json({ success: false, message: 'Phone number and verification code are required.' });
      req.flash('error', 'Phone number and verification code are required.');
      return res.redirect('/account/profile');
    }
    try {
      customerService.linkGuestToAccount(req.session.customer_id, phone, otp);
      if (isJson) return res.status(200).json({ success: true, message: 'Guest orders linked successfully!' });
      req.flash('success', 'Past guest orders and addresses have been linked to your account.');
      return res.redirect('/account/orders');
    } catch (e: any) {
      if (isJson) return res.status(400).json({ success: false, message: e.message });
      req.flash('error', e.message);
      return res.redirect('/account/profile');
    }
  }

  getAddresses(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const addresses = customerService.getAddresses(req.session.customer_id);
    res.render('customer_addresses', { addresses, error: req.flash('error'), success: req.flash('success'), csrfToken: res.locals.csrfToken });
  }

  postAddress(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      req.flash('error', parsed.error.issues.map(i => i.message).join(', '));
      return res.redirect('/account/addresses');
    }
    try {
      customerService.addAddress({
        ...parsed.data,
        customer_id: req.session.customer_id,
        is_default: parsed.data.is_default === 'on' ? 1 : 0
      });
      req.flash('success', 'Address added successfully.');
    } catch (e: any) {
      req.flash('error', e.message);
    }
    res.redirect('/account/addresses');
  }

  setDefaultAddress(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    try {
      customerService.setDefaultAddress(req.session.customer_id, parseInt(req.params.id));
      req.flash('success', 'Default address updated.');
    } catch (e: any) {
      req.flash('error', e.message);
    }
    res.redirect('/account/addresses');
  }

  deleteAddress(req: Request, res: Response) {
    if (!req.session.customer_id) return res.redirect('/customer/login');
    try {
      customerService.deleteAddress(req.session.customer_id, parseInt(req.params.id));
      req.flash('success', 'Address deleted.');
    } catch (e: any) {
      req.flash('error', e.message);
    }
    res.redirect('/account/addresses');
  }
}

export const customerController = new CustomerController();
