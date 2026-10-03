import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import flash from 'connect-flash';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ─── Routes ──────────────────────────────────────────────────────────────────
import authRoutes from './src/routes/auth.js';
import billingRoutes from './src/routes/billing.js';
import stockRoutes from './src/routes/stock.js';
import adminRoutes from './src/routes/admin.js';
import pdfRoutes from './src/routes/pdf.js';
import rateLimit from 'express-rate-limit';

// ─── Middleware ───────────────────────────────────────────────────────────────
import { requireAuth, csrfProtection } from './src/middleware/auth.js';
import { getProducts } from './src/repository.js';
import logger from './src/logger.js';

// ─── Session Store (SQLite) ───────────────────────────────────────────────────
import connectSqlite3 from 'connect-sqlite3';
const SQLiteStore = connectSqlite3(session);

declare module 'express-session' {
  interface SessionData {
    user?: string;
    user_id?: number;
    role?: string;
    cart?: any[];
    held_bills?: any[];
    csrfToken?: string;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Ensure data/logs directories exist ──────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_fallback_secret_change_this';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev_cookie_secret_change_this';

// ─── Security Headers (Helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com', 'cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', '*'],
      connectSrc: ["'self'"],
    },
  },
}));

// ─── HTTP Access Logging (Morgan → file) ─────────────────────────────────────
const accessLogStream = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });
app.use(morgan('combined', { stream: accessLogStream }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ─── View Engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }) as any,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));
app.use(flash());

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000,
  message: 'Too many requests from this IP, please try again after an hour',
  skip: (req) => {
    return !!(req.session && req.session.user);
  }
});
app.use(globalLimiter);

// ─── Global Locals ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.messages = req.flash('info');
  try {
    const products = getProducts();
    res.locals.lowStockCount = products.filter(p => (p.total_qty - (p.sold_qty || 0)) < 5).length;
  } catch {
    res.locals.lowStockCount = 0;
  }
  next();
});

// ─── Public Home ──────────────────────────────────────────────────────────────
app.get('/', csrfProtection, (req, res) => {
  const allProducts = getProducts();
  const shuffled = [...allProducts].sort(() => 0.5 - Math.random());
  const selectedProducts = shuffled.slice(0, 12);
  res.render('home', { products: selectedProducts });
});

// ─── Route Modules ────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/', billingRoutes);
app.use('/', stockRoutes);
app.use('/', adminRoutes);
app.use('/', pdfRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    statusCode: 404,
    title: 'Page Not Found',
    message: `The page "${req.path}" does not exist.`
  });
});

// ─── 500 / Global Error Handler ──────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack, path: req.path });
  res.status(500).render('error', {
    statusCode: 500,
    title: 'Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again later.'
      : err.message
  });
});

import { initBackupCron } from './src/backup.js';

// ─── Start Server ─────────────────────────────────────────────────────────────
initBackupCron();
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`✅ Server running: http://localhost:${PORT}`);
});
