import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';

let isSubmitting = false;
let currentSellersCache = {};

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  renderCart();
  setupPaymentListener();
  setupPlaceOrder();
  loadSavedShipping();

  // Listen to external cart updates
  window.addEventListener('artisan-cart-updated', () => {
    renderCart();
  });

  // Check auth state
  ArtisanDB.onAuth((user) => {
    if (user) {
      loadSavedShipping(user);
      loadUserOrders(user.uid);
    }
  });

  // Handle URL hash navigation (e.g. cart.html#orders)
  if (window.location.hash === '#orders') {
    switchTab('orders');
  }
});

function initTabs() {
  const tabCartBtn = document.getElementById('tabCartBtn');
  const tabOrdersBtn = document.getElementById('tabOrdersBtn');

  if (tabCartBtn && tabOrdersBtn) {
    tabCartBtn.addEventListener('click', () => switchTab('cart'));
    tabOrdersBtn.addEventListener('click', () => switchTab('orders'));
  }

  // Clear cart button
  const clearCartBtn = document.getElementById('clearCartBtn');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to remove all items from your cart?')) {
        ArtisanDB.clearCart();
        renderCart();
      }
    });
  }

  // Success modal buttons
  document.getElementById('successViewOrdersBtn')?.addEventListener('click', () => {
    document.getElementById('orderSuccessModal').style.display = 'none';
    switchTab('orders');
  });

  document.getElementById('successContinueShoppingBtn')?.addEventListener('click', () => {
    window.location.href = 'products.html';
  });
}

function switchTab(tab) {
  const cartSection = document.getElementById('cartSection');
  const ordersSection = document.getElementById('ordersSection');
  const tabCartBtn = document.getElementById('tabCartBtn');
  const tabOrdersBtn = document.getElementById('tabOrdersBtn');

  if (tab === 'orders') {
    cartSection.style.display = 'none';
    ordersSection.style.display = 'block';
    tabCartBtn.classList.remove('active');
    tabOrdersBtn.classList.add('active');
    window.location.hash = '#orders';
    const user = ArtisanDB.getLocalUser();
    if (user && user.uid) {
      loadUserOrders(user.uid);
    } else {
      document.getElementById('userOrdersList').innerHTML = `
        <div class="empty-state-card">
          <h2>Please Log In</h2>
          <p>Sign in to view your order history and track shipments.</p>
          <a href="login.html" class="primary-btn">Login to Account</a>
        </div>
      `;
    }
  } else {
    cartSection.style.display = 'block';
    ordersSection.style.display = 'none';
    tabCartBtn.classList.add('active');
    tabOrdersBtn.classList.remove('active');
    history.replaceState(null, null, ' ');
    renderCart();
  }
}

async function renderCart() {
  const cart = ArtisanDB.getCart();
  const emptyState = document.getElementById('emptyCartState');
  const activeContent = document.getElementById('activeCartContent');
  const listEl = document.getElementById('cartItemsList');
  const countTitle = document.getElementById('cartCountTitle');

  const totalCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  if (countTitle) countTitle.textContent = totalCount;

  if (!cart || cart.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (activeContent) activeContent.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (activeContent) activeContent.style.display = 'grid';

  if (!listEl) return;
  listEl.innerHTML = '';

  let subtotal = 0;

  cart.forEach(item => {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    const lineTotal = price * qty;
    subtotal += lineTotal;

    const itemRow = document.createElement('div');
    itemRow.className = 'cart-item-row';
    itemRow.innerHTML = `
      <img class="cart-item-thumb" src="${item.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=400&q=80'}" alt="${item.name}" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=400&q=80'">
      <div class="cart-item-details">
        <h4 class="cart-item-name">${item.name}</h4>
        <div class="cart-item-meta">
          <span>Seller: <strong>${item.sellerName || 'Artisan Partner'}</strong></span>
          <span>Category: ${item.category || 'Handicrafts'}</span>
        </div>
        <div class="cart-item-price-unit">₱${price.toFixed(2)} each</div>
      </div>
      <div class="cart-item-controls">
        <div class="qty-pill">
          <button type="button" class="qty-btn dec-btn" data-id="${item.id}">-</button>
          <span class="qty-val">${qty}</span>
          <button type="button" class="qty-btn inc-btn" data-id="${item.id}">+</button>
        </div>
        <div class="cart-item-line-total">₱${lineTotal.toFixed(2)}</div>
        <button type="button" class="item-delete-btn" data-id="${item.id}" title="Remove item">Remove</button>
      </div>
    `;

    listEl.appendChild(itemRow);
  });

  // Calculate Shipping and Grand Total
  const shipping = subtotal >= 1000 ? 0 : (subtotal > 0 ? 50 : 0);
  const grandTotal = subtotal + shipping;

  document.getElementById('summarySubtotal').textContent = `₱${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('summaryShipping').textContent = shipping === 0 ? 'FREE' : `₱${shipping.toFixed(2)}`;
  document.getElementById('summaryGrandTotal').textContent = `₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  // Attach quantity and delete event listeners
  listEl.querySelectorAll('.dec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item && item.quantity > 1) {
        ArtisanDB.updateCartQuantity(id, item.quantity - 1);
      } else {
        ArtisanDB.removeFromCart(id);
      }
    });
  });

  listEl.querySelectorAll('.inc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const item = cart.find(i => i.id === id);
      if (item) {
        ArtisanDB.updateCartQuantity(id, item.quantity + 1);
      }
    });
  });

  listEl.querySelectorAll('.item-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      ArtisanDB.removeFromCart(id);
    });
  });

  // If GCash is selected, refresh the seller payment card
  const selectedPayment = document.querySelector('input[name="paymentOption"]:checked')?.value;
  if (selectedPayment === 'GCash') {
    updateGcashSellerDetails();
  }
}

function setupPaymentListener() {
  const radios = document.querySelectorAll('input[name="paymentOption"]');
  const gcashPanel = document.getElementById('gcashDirectDetailsPanel');

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'GCash') {
        if (gcashPanel) gcashPanel.style.display = 'block';
        updateGcashSellerDetails();
      } else {
        if (gcashPanel) gcashPanel.style.display = 'none';
      }
    });
  });

  // Copy button for GCash number
  document.getElementById('copyGcashNumberBtn')?.addEventListener('click', () => {
    const num = document.getElementById('gcashMobileNumberDisplay')?.textContent || '';
    if (num && num !== 'Loading...') {
      navigator.clipboard.writeText(num).then(() => {
        const btn = document.getElementById('copyGcashNumberBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }
  });
}

async function updateGcashSellerDetails() {
  const cart = ArtisanDB.getCart();
  if (!cart.length) return;

  const firstItem = cart[0];
  const sellerId = firstItem.sellerId;

  const nameDisplay = document.getElementById('gcashAccountNameDisplay');
  const numberDisplay = document.getElementById('gcashMobileNumberDisplay');
  const qrWrap = document.getElementById('gcashQrContainer');
  const qrImg = document.getElementById('gcashQrImage');

  if (sellerId && currentSellersCache[sellerId]) {
    const s = currentSellersCache[sellerId];
    nameDisplay.textContent = s.gcashName || s.name || 'Artisan Seller Official';
    numberDisplay.textContent = s.gcashNumber || s.phone || '09123456789';
    if (s.gcashQr) {
      qrImg.src = s.gcashQr;
      qrWrap.style.display = 'block';
    } else {
      qrWrap.style.display = 'none';
    }
    return;
  }

  // Fetch seller details from Firestore
  try {
    const seller = await ArtisanDB.getSeller(sellerId);
    if (seller) {
      currentSellersCache[sellerId] = seller;
      nameDisplay.textContent = seller.gcashName || seller.name || 'Artisan Seller Official';
      numberDisplay.textContent = seller.gcashNumber || seller.phone || '09123456789';
      if (seller.gcashQr) {
        qrImg.src = seller.gcashQr;
        qrWrap.style.display = 'block';
      } else {
        qrWrap.style.display = 'none';
      }
    } else {
      nameDisplay.textContent = firstItem.sellerName || 'Artisan Guild of the Philippines';
      numberDisplay.textContent = '0917-889-4455';
      qrWrap.style.display = 'none';
    }
  } catch (err) {
    nameDisplay.textContent = firstItem.sellerName || 'Artisan Seller Official';
    numberDisplay.textContent = '0917-889-4455';
  }
}

function loadSavedShipping(user) {
  const profile = user || ArtisanDB.getLocalUser();
  if (!profile) return;

  if (profile.name && !document.getElementById('shippingFullName').value) {
    document.getElementById('shippingFullName').value = profile.name;
  }
  if (profile.phone && !document.getElementById('shippingPhone').value) {
    document.getElementById('shippingPhone').value = profile.phone;
  }
  if (profile.address && !document.getElementById('shippingAddress').value) {
    document.getElementById('shippingAddress').value = profile.address;
  }
  if (profile.city && !document.getElementById('shippingCity').value) {
    document.getElementById('shippingCity').value = profile.city;
  }
}

function setupPlaceOrder() {
  const submitBtn = document.getElementById('placeOrderSubmitBtn');
  if (!submitBtn) return;

  submitBtn.addEventListener('click', async () => {
    if (isSubmitting) return;

    const errorBanner = document.getElementById('checkoutErrorNotice');
    errorBanner.style.display = 'none';
    errorBanner.textContent = '';

    const cart = ArtisanDB.getCart();
    if (!cart || cart.length === 0) {
      showError('Your shopping cart is empty. Please add items to proceed.');
      return;
    }

    const user = ArtisanDB.getLocalUser();
    if (!user || !user.uid) {
      showError('Please log in or register before placing your order so you can track its delivery status.');
      setTimeout(() => {
        window.location.href = 'login.html?redirect=cart.html';
      }, 1800);
      return;
    }

    // Validate shipping fields
    const fullName = document.getElementById('shippingFullName').value.trim();
    const phone = document.getElementById('shippingPhone').value.trim();
    const address = document.getElementById('shippingAddress').value.trim();
    const city = document.getElementById('shippingCity').value.trim();
    const postal = document.getElementById('shippingPostal').value.trim();
    const notes = document.getElementById('shippingNotes').value.trim();

    if (!fullName || !phone || !address || !city) {
      showError('Please complete all required shipping fields (Name, Phone, Address, City).');
      return;
    }

    const paymentMethod = document.querySelector('input[name="paymentOption"]:checked')?.value || 'Cash on Delivery';
    let gcashRef = '';
    let paymentStatus = paymentMethod === 'Cash on Delivery' ? 'Due on delivery' : 'Pending Verification';
    let orderStatus = 'Processing';

    if (paymentMethod === 'GCash') {
      gcashRef = document.getElementById('gcashReferenceInput').value.trim();
      if (!gcashRef || gcashRef.length < 9) {
        showError('Please provide your valid GCash transaction reference number (9-13 digits) to confirm payment.');
        return;
      }
      paymentStatus = 'Paid';
      orderStatus = 'Confirmed';
    }

    // Set Loading State
    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'Processing Order...';
    submitBtn.querySelector('.btn-spinner').style.display = 'inline-block';

    try {
      // 1. Stock & Price Re-verification
      for (const item of cart) {
        const liveProduct = await ArtisanDB.getProduct(item.productId || item.id);
        if (liveProduct) {
          const availableStock = Number(liveProduct.stock) || 0;
          if (availableStock < Number(item.quantity)) {
            throw new Error(`Item "${item.name}" has only ${availableStock} units remaining in stock. Please adjust quantity.`);
          }
        }
      }

      // 2. Prepare Order Payload
      const subtotal = cart.reduce((acc, i) => acc + (Number(i.price) * Number(i.quantity)), 0);
      const shipping = subtotal >= 1000 ? 0 : 50;
      const total = subtotal + shipping;
      const sellerIds = Array.from(new Set(cart.map(i => i.sellerId).filter(Boolean)));

      const orderPayload = {
        userId: user.uid,
        customerName: fullName,
        customerEmail: user.email,
        customerPhone: phone,
        shippingAddress: `${address}, ${city} ${postal}`.trim(),
        deliveryNotes: notes,
        items: cart,
        sellerIds,
        paymentMethod,
        paymentStatus,
        orderStatus,
        paymentReference: gcashRef,
        subtotal,
        shipping,
        total
      };

      // 3. Write to Firestore via ArtisanDB
      const createdOrder = await ArtisanDB.createOrder(orderPayload);

      // 4. Clear cart on verified success
      ArtisanDB.clearCart();
      updateHeaderAuth();

      // 5. Show Success Modal
      document.getElementById('receiptOrderNumber').textContent = createdOrder.orderNumber;
      document.getElementById('receiptPaymentMethod').textContent = paymentMethod;
      document.getElementById('receiptPaymentStatus').textContent = paymentStatus;
      document.getElementById('receiptTotalAmount').textContent = `₱${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      document.getElementById('orderSuccessModal').style.display = 'flex';

    } catch (err) {
      console.error('Order creation failure:', err);
      showError(err.message || 'Unable to place order. Please review your cart and try again.');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn-text').textContent = 'Place Order Now';
      submitBtn.querySelector('.btn-spinner').style.display = 'none';
    }
  });

  function showError(msg) {
    const errorBanner = document.getElementById('checkoutErrorNotice');
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.style.display = 'block';
      errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(msg);
    }
  }
}

function loadUserOrders(userId) {
  const container = document.getElementById('userOrdersList');
  if (!container) return;

  ArtisanDB.subscribeUserOrders(userId, (orders) => {
    if (!orders || orders.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-state-icon">📦</div>
          <h2>No Orders Yet</h2>
          <p>You haven't placed any handcrafted orders yet. Discover our community artisans today!</p>
          <a href="products.html" class="primary-btn">Explore Products</a>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    orders.forEach(order => {
      const dateStr = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently';
      const statusClass = (order.orderStatus || 'processing').toLowerCase();
      const paymentBadgeClass = order.paymentStatus === 'Paid' ? 'paid-badge' : 'unpaid-badge';

      const card = document.createElement('div');
      card.className = 'user-order-card';
      card.innerHTML = `
        <div class="order-card-header">
          <div>
            <strong class="order-id-label">${order.orderNumber || order.id}</strong>
            <span class="order-date-label">Placed on ${dateStr}</span>
          </div>
          <div class="order-badges-wrap">
            <span class="status-badge ${statusClass}">${order.orderStatus || 'Processing'}</span>
            <span class="payment-badge ${paymentBadgeClass}">${order.paymentStatus || 'Pending'}</span>
          </div>
        </div>

        <div class="order-card-items-list">
          ${(order.items || []).map(item => `
            <div class="order-mini-item">
              <img src="${item.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=200&q=80'}" alt="${item.name}" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=200&q=80'">
              <div class="mini-item-details">
                <span class="mini-item-title">${item.name}</span>
                <span class="mini-item-meta">Qty: ${item.quantity} × ₱${Number(item.price).toFixed(2)}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="order-card-footer">
          <div class="order-shipping-summary">
            <strong>Delivery to:</strong> ${order.customerName || 'Customer'} • ${order.shippingAddress || 'Standard Delivery'}
          </div>
          <div class="order-total-highlight">
            Total: <strong>₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  });
}
