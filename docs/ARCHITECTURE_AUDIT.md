# Sri Tirumala Dry Fruits - Architecture & Implementation Audit

## 1. What is Already Implemented

**Architecture & Stack:**
- **Backend:** Node.js, Express, TypeScript (ESM modules).
- **Database:** SQLite3 (`better-sqlite3`) with WAL (Write-Ahead Logging) enabled for better concurrency.
- **Session Management:** `express-session` backed by `connect-sqlite3` (`sessions.db`).
- **Security:** CSRF protection (double-submit cookie), rate limiting, Helmet for HTTP headers, and bcrypt for password hashing.
- **Views:** EJS templating engine for Server-Side Rendering (SSR).

**Core Business Features:**
- **Point of Sale (POS) Flow:** Full billing functionality with cart, discount, shift management (opening/closing cash), return items, and profit calculation.
- **Inventory Management:** Products table with stock tracking (`total_qty` vs `sold_qty`) and SQLite constraint checks (`total_qty - sold_qty >= 0`).
- **Admin Management:** Views for product management, inventory adjustment, shift logs, and viewing online orders.
- **Online Orders (Basic):** Guest checkout flow (`/api/store/checkout`) which creates an order, calculates delivery fees, and tracks order statuses. An admin can push online orders to a POS bill.

**Operations & Deployment:**
- **Deployment:** Docker support with a multi-stage `Dockerfile` and `docker-compose.yml`.
- **Process Management:** PM2 configuration (`ecosystem.config.cjs`) for production runtime.
- **Database Backups:** Automated cron job (runs daily at 11:30 PM) for SQLite backups and an offsite sync script.
- **Logging:** Morgan file-based logging (`access.log`).

## 2. What is Partially Implemented

- **Customer Data Model:** The `customers` table acts more as an address book/registry based on phone numbers rather than authenticated user accounts.
- **WhatsApp Integration:** The current "integration" simply constructs a static `wa.me` URL with pre-filled text for the user to manually send a message from their device. It's not an automated messaging system.
- **Inventory Concurrency for E-commerce:** The system relies strictly on database constraints (`check_inventory`). There is no mechanism for soft-reserving stock while a user is in checkout, which can lead to abrupt checkout failures under high load.
- **Push-to-POS Integration:** When an online order is marked as completed and pushed to POS (`store.ts`), the code manually offsets a double-increment of `sold_qty` to prevent inventory counting errors, creating tech debt.
- **Testing:** Only a single test file (`billing.test.ts`) exists; there is no comprehensive test suite.

## 3. What is Missing

- **Authenticated Customer E-commerce:** Customers cannot create accounts, log in, view order history, or manage saved addresses.
- **Automated WhatsApp Notifications:** True server-to-server integration (Meta Cloud API / Twilio) for sending order confirmations, dispatch updates, and delivery alerts automatically.
- **Payment Gateway Integration:** The system only handles COD and UPI QR (manual verification). Real-time payment processing (e.g., Razorpay, Stripe) is missing.
- **Frontend SPA/PWA:** The storefront is SSR EJS. Moving to a separate React/Next.js storefront would provide a better e-commerce experience.
- **Inventory Reservation System:** A caching layer (like Redis) or a dedicated reservation table to temporarily hold stock during checkout.

## 4. What Can Break Existing Functionality

- **Modifying the `users` Table or Auth Middleware:** The POS, Admin, and Shift flows are deeply tied to the current session-based staff/admin authentication (`req.session.user`). Introducing customer authentication in the same middleware could easily leak admin privileges or break POS access.
- **Changing `sold_qty` Logic:** Modifying how inventory is deducted during bill creation will immediately break the "Push to POS" workaround in `routes/store.ts`, potentially corrupting stock levels.
- **Database Schema Changes:** As this is SQLite, altering complex tables with existing constraints might require recreating tables or complex migration scripts, which could cause downtime.

## 5. What Needs to Change for Authenticated Customer E-commerce

1. **Database Schema:** 
   - Add authentication fields (e.g., `password_hash` or `otp_secret`) to the `customers` table, or create a distinct `customer_accounts` table linked to the `customers` profile.
2. **Session/Auth Layer:** 
   - Implement customer session handling (JWT or separate session cookie scope) that operates completely independently of the staff POS sessions.
3. **API Endpoints:** 
   - Create customer registration, login, and profile management routes.
   - Refactor `/api/store/checkout` to explicitly bind orders to the authenticated customer ID rather than relying purely on a phone number lookup.
   - Build a `GET /api/store/my-orders` endpoint for the customer dashboard.
4. **UI Updates:** 
   - Add user portals, login screens, and order history pages to the storefront views.

## 6. What Needs to Change for Production-Grade WhatsApp Automation

1. **Provider Integration:** 
   - Register for the WhatsApp Business API (via Meta directly or providers like Gupshup/Twilio).
2. **Database Updates:** 
   - Add `whatsapp_message_id` and `whatsapp_status` (SENT, DELIVERED, READ, FAILED) to the `online_orders` or a new `communications_log` table.
3. **Event-Driven Messaging:** 
   - Remove the `wa.me` URL generation from the checkout response.
   - Trigger an asynchronous background task on successful order creation to hit the WhatsApp API.
   - Add webhooks to listen for status updates from the WhatsApp API.
4. **Lifecycle Hooks:** 
   - Integrate WhatsApp triggers in the Admin dashboard, so when an order status changes (e.g., `DISPATCHED`), an automated message is sent.

## 7. Recommended Implementation Order

1. **Technical Debt & Refactoring:** 
   - Refactor the inventory deduction logic to cleanly handle both POS bills and Online Orders without the double-increment hack. 
2. **Customer Authentication:** 
   - Add OTP-based or password-based login for customers.
   - Update the session middleware to support and segregate customer sessions.
3. **Customer Portal & E-commerce Upgrade:** 
   - Tie checkout to logged-in users.
   - Implement "My Orders" and saved address features.
4. **WhatsApp Business API Integration:** 
   - Set up API credentials.
   - Build the webhook handler and asynchronous notification service for transactional messages.
5. **Payment Gateway Integration (Optional but Recommended):** 
   - Integrate Razorpay/PhonePe for seamless online payments.
6. **Testing & CI:** 
   - Increase test coverage (Vitest) for all new endpoints before deploying to production.
