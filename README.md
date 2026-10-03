# Sri Tirumala Dry Fruits - POS & Inventory System 🥜

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-563D7C?style=for-the-badge&logo=bootstrap&logoColor=white)

A production-grade, hybrid web application built for Sri Tirumala Dry Fruits & Organics. It serves as both a **public-facing product catalog** for customers and a highly secure, lightning-fast **Point-of-Sale (POS) and Inventory Management system** for store staff and administrators.

---

## ✨ Key Features

### 🛒 Public Storefront
*   **Modern Catalog:** Beautiful, mobile-responsive product grid displaying premium dry fruits, millets, and organics.
*   **Live Search & Filtering:** Instant client-side filtering by category and product name.
*   **Dynamic Inventory Integration:** Automatically reflects current stock and pricing from the backend.

### 💳 POS Terminal (Point of Sale)
*   **Rapid Checkout:** Barcode scanning support and F-key shortcuts (F1-F4) for lightning-fast billing.
*   **Bill Management:** Ability to suspend (hold) and resume bills for customers who step away.
*   **Payment & Tax Breakdown:** Track payment methods (Cash, UPI, Card) and auto-calculate CGST/SGST on PDF receipts.
*   **PDF Receipts:** Generates downloadable, thermal-printer-ready PDF invoices formatted for 80mm rolls.
*   **Returns Processing:** Handle customer returns with automatic inventory restocking and profit adjustment.

### 📦 Inventory & Admin Management
*   **Real-time Stock:** Add, edit, and track product quantities and margins (Cost vs. Selling Price).
*   **Shift & Register Management:** Enforces "Open Register" and "Close Register" flows for cashiers to reconcile drawer cash.
*   **Profit Analytics:** Daily sales and profit tracking dashboards for the store owner.
*   **Role-Based Access Control:** Strict segregation between `admin` (Analytics, User Management) and `staff` (Billing, Stock).

---

## 🏗️ Tech Stack & Security

*   **Backend:** Node.js, Express.js (Modular routing), TypeScript
*   **Database:** SQLite (`better-sqlite3` with WAL mode enabled for high concurrency)
*   **Frontend:** Server-Side Rendered EJS templates, Bootstrap 5, custom CSS.
*   **Security & Reliability:**
    *   Automated daily database backups via Node-Cron.
    *   Strict database constraints to prevent race conditions during high-volume checkout.
    *   Double-submit cookie pattern for strict CSRF protection.
    *   Global rate-limiting applied to public storefront routes.
*   **DevOps:** `winston` & `morgan` for robust logging, PM2 for process management.

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   npm

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd sri-tirumala-dryfruits
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy the example environment file and update the secrets.
   ```bash
   cp .env.example .env
   ```
   *Ensure you set strong, unique values for `SESSION_SECRET` and `COOKIE_SECRET`.*

4. **Start the application (Development):**
   ```bash
   npm run dev
   ```
   *The database (`data/store.db`) will auto-initialize with default admin credentials if it doesn't exist.*

5. **Start the application (Production using PM2):**
   ```bash
   npx pm2 start ecosystem.config.cjs
   ```

---

## 📁 Project Structure

```text
├── src/
│   ├── database.ts        # SQLite connection & initialization
│   ├── repository.ts      # Core database operations (Queries, Transactions)
│   ├── logger.ts          # Winston logger configuration
│   ├── middleware/        # Auth guards and CSRF protection
│   └── routes/            # Modular Express routes (auth, admin, billing, stock)
├── views/                 # EJS templates (UI components)
├── public/                # Static assets (CSS, images)
├── scripts/               # Utility scripts (e.g., legacy data migration)
├── data/                  # Auto-generated SQLite databases (store.db, sessions.db)
├── logs/                  # Auto-generated application logs
└── server.ts              # Express application entry point
```

---

## 🛡️ License & Proprietary Notice

This software is proprietary and developed specifically for Sri Tirumala Dry Fruits & Organics. Unauthorized distribution, modification, or commercial use outside of the intended organization is prohibited.

*Built with ❤️ for Sri Tirumala Dry Fruits.*
