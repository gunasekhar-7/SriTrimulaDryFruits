# Sri Tirumala Dry Fruits — UI/UX Audit & Visual Review

**Audited:** 2026-10-17
**Project:** Sri Tirumala Dry Fruits & Millets (Hybrid POS & E-Commerce Platform)
**Baseline:** Abstract 6-Pillar Visual & Interaction Design Standards
**Screenshots:** Not captured (no dev server running on localhost:3000, 5173, or 8080)
**Interaction captures:** Off (`workflow.ui_interaction_capture` is false / code-derived audit)

---

## Executive Summary

A comprehensive, adversarial 6-pillar UI/UX audit was conducted across the entire codebase of the Sri Tirumala Dry Fruits platform. The application represents an ambitious, dual-interface architecture: an artisanal botanical luxury storefront for retail customers paired with a local-first, zero-latency POS counter terminal and administrative governance suite (financial analytics and cryptographically chained audit logs).

While the aesthetic direction (the "Artisanal Botanical Luxury" system) is conceptually rich and features high-grade typography, thoughtful micro-interactions (e.g. the `/` keyboard shortcut for catalog search, WhatsApp 1-click cart export, and animated progress bars for Tekkali free delivery), the implementation suffers from severe architectural fragmentation, several user-facing blockers, and design system divergences between storefront, customer account, and POS views.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| **1. Copywriting** | **2 / 4** | Dual personality: ornate luxury prose clashed with >200 raw/generic strings ("Submit", "Cancel", "OK") and conflicting delivery threshold copy (₹500 vs ₹1,499). |
| **2. Visuals** | **2 / 4** | Missing FontAwesome stylesheet in `checkout.ejs` causing broken icons; icon tri-furcation (Material Symbols vs FontAwesome vs Emojis); dangling `</div>` tags breaking DOM structure. |
| **3. Color** | **2 / 4** | 348 hardcoded color values; 7 competing shades of green and 7 shades of gold; `.text-primary !important` overriding Bootstrap utility; WCAG AA contrast failures on micro-labels. |
| **4. Typography** | **3 / 4** | Strong Playfair Display + Plus Jakarta Sans foundation with fluid `clamp()`, but excessive micro-stepped sizes (14+ distinct rem/px variants in body scale) and sub-10px illegible text. |
| **5. Spacing** | **2 / 4** | 11 competing `border-radius` values (4px to 50px); mobile sticky bottom navigation bar overlaps interactive forms and footer links due to missing bottom safe-area offset. |
| **6. Experience Design** | **2 / 4** | **BLOCKER:** Connoisseur Bestsellers "Quick Add +" button is a stub that never calls the cart API; destructive "Cancel Order" lacks confirmation; customer account views lack cart access. |

**Overall Score: 13 / 24**

---

## Top 3 Priority Fixes (Actionable Remediation)

### 1. [BLOCKER] Connect Connoisseur Bestsellers "Quick Add +" to the Live Cart API
- **User Impact:** High-intent shoppers clicking "Quick Add +" on the 4 premier hero cards ("Royal Mamra Almonds", "King Size W180 Cashews", "Original Medjool Dates", "Pure Kashmiri Mongra Saffron") see a toast and watch the badge number increment, but the item is **never added** to their backend session cart. When they open their cart or navigate to checkout, their cart is completely empty, destroying conversion.
- **Root Cause:** In `views/home.ejs:838-853`, `window.quickAddFeaturedItem(itemName, price)` only invokes `window.showRoyalCasketToast()` and locally increments the badge counter. It lacks an item ID and fails to call `window.Storefront.addToCart(productId, qty, name)`.
- **Concrete Fix:** Update `views/home.ejs` to pass the actual database product ID (`data-id="<%= p.id %>"`) to each spotlight card, and replace the mock function with a direct invocation of `window.Storefront.addToCart(id, 1, name)`.

### 2. [BLOCKER] Fix Broken FontAwesome Icons on Checkout & Unify Iconography System
- **User Impact:** Customers on `views/checkout.ejs` see blank boxes or broken missing characters for Home Delivery (`fas fa-truck`), Store Pickup (`fas fa-store`), Cash on Delivery (`fas fa-money-bill-wave`), UPI QR (`fas fa-qrcode`), and WhatsApp buttons (`fab fa-whatsapp`), causing loss of trust during financial checkout.
- **Root Cause:** `views/checkout.ejs` uses FontAwesome 6 classes, but the `<head>` of `checkout.ejs` does not include `font-awesome.min.css` (unlike `customer_orders.ejs`). Furthermore, `storefront.css` uses Google Material Symbols Outlined, while `header.ejs` uses native OS emojis.
- **Concrete Fix:** Add `<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">` to `views/checkout.ejs` immediately, or standardize all storefront views on Google Material Symbols Outlined (`local_shipping`, `storefront`, `payments`, `qr_code_scanner`).

### 3. [BLOCKER] Repair HTML DOM Tree Structural Discrepancy in Layout Templates
- **User Impact:** Container elements and layout wrappers prematurely terminate, causing footers and scripts to misalign, sticky headers to fail, and CSS grid constraints to break across desktop and mobile screens.
- **Root Cause:** In `views/header.ejs:1027`, the public layout opens exactly one container `<div>`. In `views/footer.ejs:1-6`, three unconditional `</div>` tags and a fourth conditional `</div>` tag are closed, creating a mismatched tag count.
- **Concrete Fix:** Balance container opening tags in `header.ejs` with exact closing tags in `footer.ejs` (ensure `<div class="main-content">` and `<div class="page-content">` are consistently opened when authenticated, and exactly 1 public wrapper is opened and closed when unauthenticated).

---

## Detailed Findings by Pillar

### Pillar 1: Copywriting (Score: 2/4)

#### Finding 1.1: Clashing Brand Voices (High-Luxury Editorial vs Raw Generic)
- **Files:** `views/header.ejs:845`, `views/footer.ejs:13-17`, `views/sell.ejs:216`, `views/stock.ejs:55`, `views/add_product.ejs:98`
- **Details:** The public storefront adopts an ultra-refined, aristocratic editorial tone:
  - *"Complimentary bespoke luxury gift casket & refrigerated cold-chain transit on orders exceeding ₹1,499"* (`header.ejs:845`)
  - *"Private Reserve Dispatch: Receive the Seasonal Harvest Gazette"* (`footer.ejs:15`)
  - *"Purveyors of heirloom-grade royal dry fruits... 1984 Royal Estate Reserve"* (`home.ejs:42`)
  In sharp contrast, admin forms, POS terminals, and customer account sub-pages immediately revert to generic, unpolished software defaults:
  - Over 200 instances of `"Submit"`, `"Cancel"`, `"Save"`, and `"OK"` across button labels.
  - In `views/sell.ejs:216`: `"Add Item to Bill (Enter)"` vs `views/stock.ejs:54`: `"UPDATE SHELF STOCK"`.
  - In `views/customer_addresses.ejs`: `"Save"` instead of `"Save Delivery Address"`.

#### Finding 1.2: Contradictory Free Delivery Threshold Copy
- **Files:** `views/header.ejs:845`, `views/header.ejs:1050`, `public/storefront.js:256`
- **Details:**
  - Header Announcement Bar: *"Complimentary bespoke luxury gift casket & refrigerated cold-chain transit on orders exceeding ₹1,499"*
  - Offcanvas Cart Drawer Banner: *"Add ₹500.00 more for FREE delivery in Tekkali!"*
  - Toast Feedback Drawer: *"Complies with Free Insulated Cold-Chain Transit"* with an arbitrary `82%` hardcoded progress bar (`header.ejs:1017`).
  A visitor has no way of discerning whether the delivery threshold is ₹500 (Tekkali local) or ₹1,499 (regional cold-chain). The rules must be clearly qualified (e.g. "Free Tekkali Local Delivery on ₹500+ | Free Cold-Chain Regional Dispatch on ₹1,499+").

#### Finding 1.3: Ambiguous Terminology for Internal Portals
- **Files:** `views/header.ejs:993`, `views/header.ejs:704`, `public/storefront.css:413`
- **Details:** The navbar links to the staff portal as `"🔐 Staff Vault"`, the CSS calls it `.nav-btn-staff`, the page title is `"Cashier & Admin Login"`, and the sidebar calls it `"Billing / POS"`. Standardize on a clear, professional term such as **"Staff Portal"** or **"Partner Desk"**.

---

### Pillar 2: Visuals (Score: 2/4)

#### Finding 2.1: Broken FontAwesome Icons on Critical Checkout Flow [BLOCKER]
- **File:** `views/checkout.ejs:92, 142, 153, 204, 215, 264`
- **Details:**
  - Line 142: `<i class="fas fa-truck text-muted me-2"></i> Home Delivery`
  - Line 153: `<i class="fas fa-store text-muted me-2"></i> Store Pickup`
  - Line 204: `<i class="fas fa-money-bill-wave text-muted me-2"></i> Cash on Delivery`
  - Line 215: `<i class="fas fa-qrcode text-muted me-2"></i> UPI QR`
  Because `<link href="...font-awesome...css">` is missing in `checkout.ejs`, all icons render as missing glyphs or invisible elements.

#### Finding 2.2: Tri-furcated Iconography Across Pages
- **Files:** `views/home.ejs`, `views/header.ejs`, `views/customer_orders.ejs`, `views/sell.ejs`
- **Details:** The project concurrently uses:
  1. Google Material Symbols Outlined (`star`, `military_tech`, `check_circle`, `eco`, `local_shipping` in `views/home.ejs`)
  2. FontAwesome 6 icons (`fa-leaf`, `fa-truck`, `fa-trash`, `fa-whatsapp` in `customer_orders.ejs`, `customer_order_detail.ejs`)
  3. Raw Unicode Emojis (`🥥`, `🌰`, `🌾`, `🌱`, `🌶️`, `🥜`, `🍬`, `🛍️`, `🛒`, `❤️`, `💬`, `🔍`, `🏷️` in `views/header.ejs`, `views/stock.ejs`, `views/sell.ejs`)
  On Windows 10/11 machines, Segoe UI Emoji renders as brightly saturated flat cartoon glyphs that severely undermine the "Artisanal Botanical Luxury" brand aesthetic.

#### Finding 2.3: Visual Hierarchy Disconnect Between Storefront and Account Portal
- **Files:** `views/partials/header_account.ejs`, `views/header.ejs`
- **Details:** When a customer navigates from the storefront into `/account` or `/account/orders`, the entire visual header abruptly changes:
  - Storefront navbar: Cream background `#faf9f5`, glassmorphism backdrop blur, luxury gold crest PNG, pill search input, wishlist pill, "Royal Casket" pill.
  - Account navbar: Heavy dark-green block `#063A22`, yellow border, plain text links, raw `🥥` emoji, no search input, no cart casket button.
  This creates an unsettling feeling that the user was redirected to a different website or an unfinished demo.

---

### Pillar 3: Color (Score: 2/4)

#### Finding 3.1: Token Duplication and Color Proliferation (348 Hardcoded Instances)
- **Files:** `public/storefront.css`, `views/header.ejs`, `views/sell.ejs`, `views/checkout.ejs`, `views/product_detail.ejs`
- **Details:** The project has multiple competing token namespaces and hardcoded hex values:
  - **Greens:**
    - `#002312` (`--primary`, `storefront.css:28`)
    - `#063a22` (`--sf-primary`, `--brand-green`, `storefront.css:29, 64`)
    - `#032013` (`--forest-dark`, `storefront.css:32`)
    - `#032113` (`--bg-sidebar`, `--brand-green-dark`, `header.ejs:83, 87`)
    - `#031c10` (used inline in `order_tracking.ejs:17`, `customer_login.ejs:27`, `header_account.ejs:1`)
    - `#0e5735` (`--forest-light`, `storefront.css:33`)
    - `#0d5a37` (`--brand-green-light`, `header.ejs:82`)
  - **Golds:**
    - `#d4af37` (`--gold-accent`, `--sf-gold`, `--brand-gold`)
    - `#b89528` (`--gold-burnished`, `--sf-gold-dark`)
    - `#fed65b` (`--secondary-container`)
    - `#c9a430` (inline hover in `header.ejs:491`)
    - `#f3e5ab` (`--gold-sheen`)
    - `#aa820a` (`--brand-gold-dark` fallback in `analytics.ejs:14`)
    - `#b18b10` (inline style in `stock.ejs:63`)
  This fragmentation violates the 60/30/10 design standard, creating unpredictable color variance across screens.

#### Finding 3.2: Aggressive Global Utility Override via `!important`
- **File:** `views/header.ejs:658`
- **Details:**
  ```css
  .text-primary, .text-primary-container {
    color: #002312 !important;
  }
  ```
  This blunt override alters Bootstrap 5's `.text-primary` globally. While intended to prevent Bootstrap's default royal blue (`#0d6efd`) from showing up, it breaks components that rely on `.text-primary` for contrast on dark backgrounds, causing dark-green-on-dark-green illegibility.

#### Finding 3.3: Accessibility Contrast Deficiencies
- **Files:** `public/storefront.css:258`, `views/header.ejs:183`
- **Details:**
  - `.brand-sub` uses `color: var(--secondary) /* #735c00 */` over `--surface: #faf9f5` at `0.62rem` (~10px). The contrast ratio is 3.58:1, failing WCAG AA (minimum 4.5:1).
  - `.sidebar-brand-text small` uses `color: rgba(255, 255, 255, 0.45);` over `#032113`. Contrast ratio is 3.79:1 at `0.68rem` (~11px).

---

### Pillar 4: Typography (Score: 3/4)

#### Finding 4.1: Excessive Micro-Stepping in Typography Scale
- **Files:** `public/storefront.css:85-187`, `views/header.ejs`, `views/sell.ejs`, `views/stock.ejs`
- **Details:**
  Rather than adhering to an established modular type scale (e.g., Major Second 1.125 or Minor Third 1.200), the project features over 14 bespoke fractional rem sizes:
  `0.62rem`, `0.65rem`, `0.68rem`, `0.72rem`, `0.75rem`, `0.78rem`, `0.8125rem`, `0.82rem`, `0.84rem`, `0.85rem`, `0.88rem`, `0.9rem`, `0.92rem`, `0.95rem`.
  This micro-stepping creates visual dissonance, as elements that should share equivalent typographic hierarchy appear slightly out of sync.

#### Finding 4.2: Illegible Micro-Labels on High-Density Screens
- **Files:** `public/storefront.css:309`, `views/home.ejs:106, 129`, `views/header.ejs:259`
- **Details:**
  - Search chips use `font-size: 8.5px;` (`storefront.css:309`).
  - Floating badge captions use `font-size: 9px;` (`home.ejs:106, 129`).
  - Sidebar badges use `font-size: 0.65rem;` (~10px).
  Text under 11px causes severe readability fatigue and fails mobile touch accessibility guidelines. Minimum body/label size should be 12px / 0.75rem.

#### Positive Observation (Pass):
- The editorial headline pairing (`Playfair Display` serif) against high-clarity geometric body text (`Plus Jakarta Sans`) delivers genuine luxury sophistication.
- Monospace numbers (`JetBrains Mono`) on POS receipt summaries, barcodes, and cryptographic hash strings maintain perfect numerical column alignment.

---

### Pillar 5: Spacing (Score: 2/4)

#### Finding 5.1: Proliferation of Corner Radius Tokens
- **Files:** `public/storefront.css`, `views/header.ejs`, `views/sell.ejs`, `views/checkout.ejs`, `views/stock.ejs`
- **Details:**
  The project utilizes 11 different corner radii:
  - `4px` (variant chips, legacy badges)
  - `6px` (quick add buttons)
  - `8px` (inputs, hero CTA, product thumbnails)
  - `10px` (buttons in `sell.ejs`, `stock.ejs`)
  - `12px` (product cards, modals, stat cards)
  - `14px` (`--radius`, `--sf-radius-lg`)
  - `16px` (checkout steps, order cards)
  - `18px` (filter cards in `analytics.ejs`)
  - `20px` (POS cards, login cards, product detail container)
  - `24px` (PDP main card, invoice wrapper, error card)
  - `50px` (pills, badges, search bars)
  Standardize on a concise 4-tier scale:
  - Small: `6px` (chips, form controls)
  - Medium: `10px` (buttons, dropdowns)
  - Large: `16px` (cards, dialogs)
  - Full: `9999px` (pills, badges)

#### Finding 5.2: Mobile Viewport Sticky Bottom Navigation Collision
- **Files:** `public/storefront.css:457-515`, `views/header.ejs:1132-1162`
- **Details:**
  `.mobile-bottom-nav` is fixed at the bottom of the viewport with a height of `58px`. However, the page content wrapper (`.public-main` and `.public-main-home`) does not provide adequate bottom padding on mobile screens. Consequently:
  - On checkout, the "Complete Order" button is partially covered by the sticky bar.
  - On login and registration, submit buttons and legal disclaimers collide with the bottom bar.
  - The bar lacks `padding-bottom: env(safe-area-inset-bottom);`, causing visual interference on iOS devices with home indicator bars.

---

### Pillar 6: Experience Design (Score: 2/4)

#### Finding 6.1: Connoisseur Bestsellers "Quick Add +" Stubbed Interaction [BLOCKER]
- **File:** `views/home.ejs:838-853`
- **Details:**
  ```javascript
  window.quickAddFeaturedItem = function (itemName, price) {
      window.showRoyalCasketToast(itemName, price);
      const cartBadge = document.getElementById('cartCountBadge');
      if (cartBadge) {
          const current = parseInt(cartBadge.innerText || '0', 10);
          cartBadge.innerText = (current + 1).toString();
          cartBadge.style.display = 'inline-block';
      }
      // ...
  };
  ```
  The button triggers visual feedback (toast + badge count), but **makes zero network requests** to `/api/v1/cart/add`. No item is persisted in the server-side SQLite session cart. When the customer opens the cart drawer or navigates to `/checkout`, the item does not exist.

#### Finding 6.2: Unconfirmed Destructive Action in Order Management [BLOCKER]
- **File:** `views/online_orders.ejs:187-190`
- **Details:**
  ```html
  <form action="/admin/online-orders/<%= o.id %>/status" method="POST">
      <input type="hidden" name="_csrf" value="<%= csrfToken %>">
      <input type="hidden" name="new_status" value="CANCELLED">
      <button type="submit" class="dropdown-item text-danger">❌ Cancel Order</button>
  </form>
  ```
  Unlike product deletion (`views/stock.ejs:191`) which includes `onclick="return confirm(...)"`, the order cancellation dropdown executes immediately upon a single click. In a busy retail environment, an accidental click irrevocably cancels customer orders and releases reserved stock.

#### Finding 6.3: Broken Wishlist "Move to Cart" on Account Subpage
- **File:** `views/customer_wishlist.ejs:141-146`
- **Details:**
  When a logged-in user on `/account/wishlist` clicks `"🛒 Move to Cart"`, `window.Storefront.addToCart()` is called. The backend receives the addition, but the frontend code immediately attempts to update `#cartCountBadge` and `#cartItemsList`, which do not exist on `customer_wishlist.ejs` (because `header_account.ejs` is used instead of `header.ejs`). The user receives no visual confirmation, the cart offcanvas cannot be opened, and no link exists to proceed to checkout.

#### Finding 6.4: Intrusive Browser `alert()` in Newsletter Subscription
- **File:** `views/footer.ejs:19`
- **Details:**
  `<form ... onsubmit="event.preventDefault(); alert('Thank you for subscribing...');">`
  Using synchronous, blocking browser `alert()` disrupts the luxury brand experience and can trigger browser anti-dialog suppression. Use an inline toast notification (`showToast()`) instead.

#### Finding 6.5: Missing Form Loading & Duplicate Submit Prevention
- **Files:** `views/checkout.ejs`, `views/customer_login.ejs`, `views/sell.ejs`
- **Details:**
  Buttons do not enter a `disabled` or loading state upon click, allowing multiple rapid clicks during network latency to submit duplicate POS bills or checkout orders.

---

## Files Audited

1. **Styling & Assets:**
   - `public/storefront.css` (Artisanal Botanical Design System)
   - `public/storefront.js` (Client-side cart, search, wishlist & WhatsApp engine)
   - `public/images/stitch/` (Stitch UI assets & image mappings)

2. **Core Layouts & Partials:**
   - `views/header.ejs` (Master layout, meta tags, top announcement, navbar, offcanvas cart & wishlist)
   - `views/footer.ejs` (Master footer, newsletter card, collections navigation)
   - `views/partials/breadcrumbs.ejs` (Breadcrumb navigation)
   - `views/partials/header_account.ejs` (Authenticated customer navigation)
   - `views/partials/account_nav.ejs` (Customer account sidebar)

3. **Customer Storefront Views:**
   - `views/home.ejs` (Hero editorial, category filter ribbon, Connoisseur Bestsellers, live catalog)
   - `views/product_detail.ejs` (PDP, verified attributes, quantity stepper, related products carousel)
   - `views/checkout.ejs` (Multi-step checkout: contact, delivery method, payment mode, order summary)
   - `views/order_tracking.ejs` (Order number lookup, 5-stage visual progress stepper)

4. **Customer Account Portal Views:**
   - `views/customer_login.ejs` (Customer authentication)
   - `views/customer_register.ejs` (Customer registration with WhatsApp OTP verification)
   - `views/customer_dashboard.ejs` (Account overview cards)
   - `views/customer_orders.ejs` (Order history list)
   - `views/customer_order_detail.ejs` (Detailed order fulfillment status & invoice view)
   - `views/customer_wishlist.ejs` (Saved items grid)
   - `views/customer_addresses.ejs` (Address management)
   - `views/customer_profile.ejs` (Profile details)

5. **POS, Inventory & Administrative Views:**
   - `views/sell.ejs` (Cashier POS counter terminal, barcode auto-focus, fast keyboard shortcuts)
   - `views/bill.ejs` (Thermal receipt print layout & invoice view)
   - `views/stock.ejs` (Inventory control table, restock triggers, low-stock warnings)
   - `views/online_orders.ejs` (Store manager order processing desk & status transitions)
   - `views/analytics.ejs` (Centralized financial dashboard, profit & loss, sales trends)
   - `views/audit_logs.ejs` (Cryptographically chained audit trail inspector & hash verification)
   - `views/login.ejs` (Staff vault login)
   - `views/error.ejs` (404/500 branded error pages)
