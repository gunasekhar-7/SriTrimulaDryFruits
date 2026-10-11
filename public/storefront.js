/**
 * ==============================================================================
 * SRI TIRUMALA DRY FRUITS — STOREFRONT CLIENT ENGINE
 * High-performance, Accessible Cart, Wishlist, Search, and WhatsApp Ordering
 * ==============================================================================
 */

(function () {
  'use strict';

  // State Management
  let cart = [];
  let cartSubtotal = 0;
  let wishlist = [];
  let allCatalogProducts = [];
  let currentCategory = 'All';

  const STORE_WHATSAPP = '919133133931';

  // ─── CSRF Helpers ──────────────────────────────────────────────────────────
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function updateCsrfToken(res) {
    const newToken = res.headers ? res.headers.get('X-CSRF-Token') : null;
    if (newToken) {
      let meta = document.querySelector('meta[name="csrf-token"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'csrf-token';
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', newToken);
    }
  }

  // ─── Toast Notifications ───────────────────────────────────────────────────
  function showToast(message, icon = '✅') {
    let container = document.getElementById('storefrontToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'storefrontToastContainer';
      container.className = 'storefront-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'sf-toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // ─── Cart Management ───────────────────────────────────────────────────────
  async function fetchCart() {
    try {
      const res = await fetch('/api/v1/cart');
      updateCsrfToken(res);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success) {
          cart = resData.data.items || [];
          cartSubtotal = resData.data.subtotal || 0;
          updateCartBadge();
          renderCart();
        }
      }
    } catch (e) {
      console.warn('Could not fetch cart', e);
    }
  }

  async function addToCart(productId, quantity = 1, productName = 'Item') {
    try {
      const res = await fetch('/api/v1/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({ product_id: productId, quantity })
      });

      updateCsrfToken(res);

      if (res.ok) {
        const resData = await res.json();
        if (resData.success) {
          cart = resData.data.items || [];
          cartSubtotal = resData.data.subtotal || 0;
          updateCartBadge();
          renderCart();
          showToast(`Added ${productName} to cart!`, '🛒');
          if (typeof window.showRoyalCasketToast === 'function') {
            window.showRoyalCasketToast(productName, cartSubtotal);
          }

          // Bounce badge animation
          const badge = document.getElementById('cartCountBadge');
          if (badge) {
            badge.style.transform = 'scale(1.4)';
            setTimeout(() => { badge.style.transform = 'scale(1)'; }, 250);
          }
        }
      } else {
        const err = await res.json();
        showToast(err.error?.message || 'Could not add to cart', '⚠️');
      }
    } catch {
      showToast('Network error adding to cart', '❌');
    }
  }

  async function updateQty(productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    const newQty = item.qty + delta;
    if (newQty <= 0) {
      return removeFromCart(productId);
    }

    try {
      const res = await fetch('/api/v1/cart/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({ product_id: productId, quantity: newQty })
      });

      updateCsrfToken(res);

      if (res.ok) {
        const resData = await res.json();
        if (resData.success) {
          cart = resData.data.items || [];
          cartSubtotal = resData.data.subtotal || 0;
          updateCartBadge();
          renderCart();
        }
      }
    } catch {
      showToast('Error updating quantity', '⚠️');
    }
  }

  async function removeFromCart(productId) {
    try {
      const res = await fetch(`/api/v1/cart/remove/${productId}`, {
        method: 'DELETE',
        headers: { 'CSRF-Token': getCsrfToken() }
      });

      updateCsrfToken(res);

      if (res.ok) {
        const resData = await res.json();
        if (resData.success) {
          cart = resData.data.items || [];
          cartSubtotal = resData.data.subtotal || 0;
          updateCartBadge();
          renderCart();
          showToast('Item removed from cart', '🗑️');
        }
      }
    } catch {
      showToast('Error removing item', '⚠️');
    }
  }

  function updateCartBadge() {
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    const badges = [
      document.getElementById('cartCountBadge'),
      document.getElementById('mobileCartBadge')
    ];

    badges.forEach(b => {
      if (!b) return;
      if (totalQty > 0) {
        b.innerText = totalQty;
        b.style.display = 'inline-block';
      } else {
        b.style.display = 'none';
      }
    });
  }

  function renderCart() {
    const list = document.getElementById('cartItemsList');
    const subtotalEl = document.getElementById('cartSubtotal');
    const drawerTitle = document.getElementById('cartOffcanvasLabel');
    if (!list || !subtotalEl) return;

    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    if (drawerTitle) drawerTitle.innerHTML = `🛒 Your Cart (${totalQty})`;

    if (cart.length === 0) {
      list.innerHTML = `
        <div class="empty-state-box my-4">
          <div class="empty-state-icon">🛒</div>
          <h5 class="fw-bold text-dark mb-1">Your cart is empty</h5>
          <p class="text-muted small mb-3">Browse our premium harvest of dry fruits and nuts!</p>
          <button class="btn btn-sm btn-outline-success px-4 rounded-pill" data-bs-dismiss="offcanvas">
            Start Shopping →
          </button>
        </div>
      `;
    } else {
      list.innerHTML = cart.map(item => {
        const price = Number(item.price);
        const qty = Number(item.qty);
        const itemTotal = price * qty;
        return `
          <div class="d-flex align-items-center justify-content-between p-3 mb-2 bg-white rounded-3 border">
            <div style="flex: 1; min-width: 0;">
              <h6 class="mb-1 text-dark fw-bold text-truncate" style="font-size: 0.92rem;">${item.name}</h6>
              <div class="small text-muted">₹${price.toFixed(2)} × ${qty} = <strong class="text-success">₹${itemTotal.toFixed(2)}</strong></div>
            </div>
            <div class="d-flex align-items-center gap-1 ms-2">
              <button class="btn btn-sm btn-light border px-2 py-0 fw-bold" onclick="window.storefront.updateQty(${item.id}, -1)">−</button>
              <span class="px-2 fw-bold" style="font-size: 0.9rem;">${qty}</span>
              <button class="btn btn-sm btn-light border px-2 py-0 fw-bold" onclick="window.storefront.updateQty(${item.id}, 1)">+</button>
              <button class="btn btn-sm text-danger ms-2 px-1 py-0" title="Remove" onclick="window.storefront.removeFromCart(${item.id})">✕</button>
            </div>
          </div>
        `;
      }).join('');
    }

    subtotalEl.innerText = cartSubtotal.toFixed(2);

    // Free Delivery Milestone
    const progress = document.getElementById('freeDeliveryProgress');
    const text = document.getElementById('freeDeliveryText');
    if (progress && text) {
      if (cartSubtotal >= 500) {
        progress.style.width = '100%';
        progress.style.backgroundColor = '#198754';
        text.innerHTML = '🎉 <strong>Congratulations!</strong> You qualify for FREE local delivery!';
        text.className = 'text-success fw-bold d-block text-center mb-1';
      } else {
        const needed = 500 - cartSubtotal;
        progress.style.width = Math.min((cartSubtotal / 500) * 100, 100) + '%';
        progress.style.backgroundColor = 'var(--sf-gold)';
        text.innerText = `Add ₹${needed.toFixed(2)} more for FREE delivery in Tekkali!`;
        text.className = 'text-muted fw-bold d-block text-center mb-1';
      }
    }
  }

  // ─── WhatsApp 1-Click Ordering from Cart ────────────────────────────────────
  function orderCartViaWhatsApp() {
    if (cart.length === 0) {
      showToast('Your cart is empty! Add products first.', '⚠️');
      return;
    }

    let message = `🌴 *SRI TIRUMALA DRY FRUITS — WHATSAPP ORDER* 🌴\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📅 Date: ${new Date().toLocaleDateString('en-IN')}\n\n`;
    message += `🛍️ *Order Items:*\n`;

    cart.forEach((item, idx) => {
      message += `${idx + 1}. *${item.name}* × ${item.qty} = ₹${(Number(item.price) * item.qty).toFixed(2)}\n`;
    });

    const isFreeDelivery = cartSubtotal >= 500;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `💵 *Subtotal:* ₹${cartSubtotal.toFixed(2)}\n`;
    message += `🚚 *Delivery:* ${isFreeDelivery ? 'FREE (Tekkali Express)' : '₹50.00'}\n`;
    message += `💰 *Grand Total:* *₹${(cartSubtotal + (isFreeDelivery ? 0 : 50)).toFixed(2)}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `👤 *My Delivery Details:*\n`;
    message += `Name: \n`;
    message += `Address / Landmark (Tekkali): \n`;
    message += `Phone: \n\n`;
    message += `👉 *Please confirm this order!*`;

    const url = `https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  function orderProductViaWhatsApp(param1, param2, param3) {
    let name = 'Product';
    let price = 0;
    let unit = 'pack';

    if (typeof param1 === 'object' && param1 !== null) {
      name = param1.name || 'Product';
      price = param1.price || 0;
      unit = param1.unit || 'pack';
    } else {
      name = param1 || 'Product';
      price = param2 || 0;
      unit = param3 || 'pack';
    }

    const message = `Hi Sri Tirumala Dry Fruits! 🌴\n\nI want to order: *${name}* (${unit}) priced at *₹${Number(price).toFixed(2)}*.\n\nPlease confirm availability and delivery in Tekkali!`;
    const url = `https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  // ─── Wishlist Architecture ─────────────────────────────────────────────────
  function loadWishlist() {
    try {
      const stored = localStorage.getItem('stdf_wishlist');
      wishlist = stored ? JSON.parse(stored) : [];
    } catch {
      wishlist = [];
    }
    updateWishlistBadge();
    renderWishlist();
    syncWishlistButtons();
  }

  function saveWishlist() {
    try {
      localStorage.setItem('stdf_wishlist', JSON.stringify(wishlist));
    } catch {}
    updateWishlistBadge();
    renderWishlist();
    syncWishlistButtons();
  }

  function toggleWishlist(product) {
    const idx = wishlist.findIndex(item => item.id === product.id);
    if (idx >= 0) {
      wishlist.splice(idx, 1);
      showToast(`Removed ${product.name} from wishlist`, '💔');
    } else {
      wishlist.push(product);
      showToast(`Saved ${product.name} to wishlist!`, '💖');
    }
    saveWishlist();
  }

  function syncWishlistButtons() {
    document.querySelectorAll('.wishlist-toggle-btn').forEach(btn => {
      const id = parseInt(btn.dataset.id, 10);
      if (wishlist.some(item => item.id === id)) {
        btn.classList.add('active');
        btn.innerHTML = '❤️';
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '🤍';
      }
    });
  }

  function updateWishlistBadge() {
    const count = wishlist.length;
    const badges = [
      document.getElementById('wishlistCountBadge'),
      document.getElementById('mobileWishlistBadge'),
      document.getElementById('wishlistOffcanvasCount')
    ];

    badges.forEach(b => {
      if (!b) return;
      b.innerText = count;
      b.style.display = count > 0 ? 'inline-block' : 'none';
    });
  }

  function renderWishlist() {
    const list = document.getElementById('wishlistItemsList');
    if (!list) return;

    if (wishlist.length === 0) {
      list.innerHTML = `
        <div class="empty-state-box my-4">
          <div class="empty-state-icon">💖</div>
          <h5 class="fw-bold text-dark mb-1">Your wishlist is empty</h5>
          <p class="text-muted small mb-3">Tap the heart icon on any product to save it for later!</p>
          <button class="btn btn-sm btn-outline-success px-4 rounded-pill" data-bs-dismiss="offcanvas">
            Explore Catalog →
          </button>
        </div>
      `;
    } else {
      list.innerHTML = wishlist.map(item => `
        <div class="d-flex align-items-center justify-content-between p-3 mb-2 bg-white rounded-3 border">
          <div>
            <h6 class="mb-1 text-dark fw-bold" style="font-size: 0.92rem;">${item.name}</h6>
            <div class="small fw-bold text-success">₹${Number(item.price).toFixed(2)}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-success px-2 py-1" onclick="window.storefront.moveWishlistToCart(${item.id})">
              + Cart
            </button>
            <button class="btn btn-sm text-danger px-1 py-1" onclick="window.storefront.removeFromWishlist(${item.id})">
              ✕
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  function moveWishlistToCart(productId) {
    const item = wishlist.find(p => p.id === productId);
    if (!item) return;
    addToCart(item.id, 1, item.name);
    wishlist = wishlist.filter(p => p.id !== productId);
    saveWishlist();
  }

  function removeFromWishlist(productId) {
    wishlist = wishlist.filter(p => p.id !== productId);
    saveWishlist();
  }

  // ─── Product Quick View Modal ───────────────────────────────────────────────
  function openProductDetails(product) {
    const modalEl = document.getElementById('productDetailsModal');
    if (!modalEl) return;

    const modalTitle = document.getElementById('modalProductName') || document.getElementById('modalProductTitle');
    const modalCategory = document.getElementById('modalCategoryBadge') || document.getElementById('modalProductCategory');
    const modalPrice = document.getElementById('modalProductPrice');
    const modalMrp = document.getElementById('modalProductMrp');
    const modalSavings = document.getElementById('modalDiscountBadge') || document.getElementById('modalProductSavings');
    const modalStock = document.getElementById('modalStockBadge') || document.getElementById('modalProductStock');
    const modalImg = document.getElementById('modalProductImage') || document.getElementById('modalProductImg');
    const modalEmoji = document.getElementById('modalProductEmoji');
    const modalAddBtn = document.getElementById('modalAddToCartBtn');
    const modalWhatsAppBtn = document.getElementById('modalWhatsAppBtn');
    const qtyInput = document.getElementById('modalProductQty') || document.getElementById('modalQuantityInput');

    if (modalTitle) modalTitle.innerText = product.name;
    if (modalCategory) modalCategory.innerText = product.category || 'Dry Fruits';
    if (modalPrice) modalPrice.innerText = `₹${Number(product.price).toFixed(2)}`;
    if (qtyInput) qtyInput.value = '1';

    const mrp = Number(product.mrp || product.price);
    const price = Number(product.price);
    if (mrp > price) {
      if (modalMrp) {
        modalMrp.innerText = `MRP ₹${mrp.toFixed(2)}`;
        modalMrp.style.display = 'inline-block';
      }
      if (modalSavings) {
        modalSavings.innerText = `${Math.round(((mrp - price) / mrp) * 100)}% OFF`;
        modalSavings.style.display = 'inline-block';
      }
    } else {
      if (modalMrp) modalMrp.style.display = 'none';
      if (modalSavings) modalSavings.style.display = 'none';
    }

    if (modalStock) {
      const stock = parseInt(product.stock, 10);
      if (stock <= 0) {
        modalStock.className = 'badge bg-danger';
        modalStock.innerText = 'Out of Stock';
        if (modalAddBtn) modalAddBtn.disabled = true;
      } else if (stock < 10) {
        modalStock.className = 'badge bg-warning text-dark';
        modalStock.innerText = `Only ${stock} units left`;
        if (modalAddBtn) modalAddBtn.disabled = false;
      } else {
        modalStock.className = 'badge bg-success';
        modalStock.innerText = 'In Stock';
        if (modalAddBtn) modalAddBtn.disabled = false;
      }
    }

    const imgSrc = product.image || product.image_url;
    if (imgSrc && modalImg) {
      modalImg.src = imgSrc;
      modalImg.style.display = 'block';
      if (modalEmoji) modalEmoji.style.display = 'none';
    } else {
      if (modalImg) modalImg.style.display = 'none';
      if (modalEmoji) {
        modalEmoji.innerText = product.emoji || '🥥';
        modalEmoji.style.display = 'flex';
      }
    }

    if (modalAddBtn) {
      modalAddBtn.onclick = () => {
        const qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
        addToCart(product.id, qty, product.name);
        try {
          if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
          }
        } catch {}
      };
    }

    if (modalWhatsAppBtn) {
      modalWhatsAppBtn.onclick = () => {
        orderProductViaWhatsApp(product);
      };
    }

    try {
      if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
      }
    } catch {}
  }

  // ─── Keyboard Accessibility & Shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Focus search on '/' when not in input
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      const searchInput = document.getElementById('searchInput') || document.getElementById('navSearchInput');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
    // Escape clears search
    if (e.key === 'Escape') {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && document.activeElement === searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.blur();
      }
    }
  });

  // ─── Initialize on DOM Ready ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    fetchCart();
    loadWishlist();

    // Sync navbar search with catalog search
    const navSearch = document.getElementById('navSearchInput');
    const mainSearch = document.getElementById('searchInput');
    if (navSearch && mainSearch) {
      navSearch.addEventListener('input', (e) => {
        mainSearch.value = e.target.value;
        if (typeof window.onSearchInput === 'function') {
          window.onSearchInput(e.target.value);
        } else if (typeof window.filterProducts === 'function') {
          window.filterProducts();
        }
      });
    }

    // Header scroll blur effect
    window.addEventListener('scroll', () => {
      const nav = document.querySelector('.storefront-navbar');
      if (nav) {
        if (window.scrollY > 20) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
      }
    });
  });

  // Export to global window for template access (both cases)
  window.Storefront = window.storefront = {
    fetchCart,
    addToCart,
    updateQty,
    removeFromCart,
    renderCart,
    orderCartViaWhatsApp,
    orderProductViaWhatsApp,
    toggleWishlist,
    moveWishlistToCart,
    removeFromWishlist,
    renderWishlist,
    syncWishlistButtons,
    openProductDetails,
    showToast
  };
})();
