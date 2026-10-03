# System Architecture & Development Guide

This document outlines the architectural decisions, database schema, and security models used in the Sri Tirumala Dry Fruits POS system.

## 1. Architectural Overview

The application follows a classic **Model-View-Controller (MVC)** architectural pattern adapted for a modern Node.js/Express backend:

*   **Models / Data Access (`src/repository.ts`):** Centralizes all SQL queries and transactions. We use `better-sqlite3` which is synchronous and highly performant for local environments.
*   **Views (`views/*.ejs`):** Server-Side Rendered (SSR) templates. This prevents the need for a complex SPA (React/Vue) build step and ensures the POS terminal loads instantly on older hardware.
*   **Controllers / Routes (`src/routes/*.ts`):** Business logic is divided into modular domains (auth, admin, billing, stock).

### Why SQLite?
For a single-location retail store, SQLite configured with **Write-Ahead Logging (WAL)** is superior to a traditional client-server database (like PostgreSQL/MySQL). It removes network latency, handles tens of thousands of concurrent reads/writes locally, and drastically simplifies backups (copying a single `.db` file).

## 2. Database Schema

The database (`data/store.db`) consists of the following primary tables:

*   **`users`**: Stores staff and admin accounts. Passwords are encrypted using `bcryptjs`.
*   **`shifts`**: Manages cashier sessions (opening_cash, actual_closing_cash, time). Ensures financial accountability.
*   **`products`**: The core inventory registry. Tracks `cost_price` vs `selling_price` (for profit calculation), current stock availability, and `tax_rate`. Backed by a strict `CHECK (total_qty - sold_qty >= 0)` constraint to prevent race condition negative stock.
*   **`bills`**: Records the finalized invoices, customer details, timestamps, `payment_method`, and links to the active `shift_id`.
*   **`sales`**: A junction/line-item table recording exactly which products were sold in which bill, the quantity, and the specific profit made on that line item at the time of sale.

*Note: Session data is stored in a separate SQLite database (`data/sessions.db`) via `connect-sqlite3` to prevent session bloat from impacting main database performance.*

## 3. Security Model

### Authentication & Authorization
*   Session-based authentication is managed via `express-session`.
*   Middleware (`src/middleware/auth.ts`) exports `requireAuth` (ensures user is logged in) and `requireAdmin` (restricts access to profit/settings pages).

### CSRF Protection (Double-Submit Cookie)
Because traditional `csurf` packages are deprecated, we implemented a custom Double-Submit CSRF pattern:
1. On GET requests to state-changing forms, a cryptographically secure random token is generated.
2. It is saved in `req.session.csrfToken` and injected into the EJS view as a hidden `<input name="_csrf">`.
3. On POST requests, the middleware strictly validates that `req.body._csrf` matches the session token.
4. Tokens are rotated upon successful validation to prevent replay attacks.

### Payload Validation
All incoming `req.body` data for critical operations (like logging in, adding stock, processing a cart) is strictly validated against schemas using the **Zod** library. This ensures type safety and prevents malformed data from reaching the database layer.

## 4. Error Handling & Logging

*   **Winston:** Application errors, DB transaction failures, and critical system events are logged to `logs/error.log` and `logs/app.log`.
*   **Morgan:** HTTP request metrics (status codes, response times) are logged to the console in development, and can be piped to `logs/access.log` in production via PM2.
*   **Global Error Handler:** Any unhandled synchronous or asynchronous errors in Express routes are caught by a global fallback middleware in `server.ts`, which renders a friendly `views/error.ejs` 500-page rather than crashing the server or leaking stack traces to the user.

## 5. PM2 Process Management

In production, the app is managed by PM2 using `ecosystem.config.cjs`. This configuration ensures:
1. The app restarts automatically if it crashes.
2. Memory usage is capped (e.g., restarts if it exceeds 500MB, preventing memory leaks).
3. Standard Output and Error streams are properly routed to persistent log files.
