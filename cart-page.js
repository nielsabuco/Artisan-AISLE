import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';

let isSubmitting = false;

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  renderCart();
  setupPaymentListener();
  setupPlaceOrder();
  loadSavedShipping();
  await checkPaymentCallback();

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
  const cartGrid = document.getElementById('cartActiveGrid');
  const cartItemsList = document.getElementById('cartItemsList');
  const cartItemCount = document.getElementById('cartItemCount');

  updateHeaderAuth();

  if (!cart || cart.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (cartGrid) cartGrid.style.display = 'none';
    if (cartItemCount) cartItemCount.textContent = '(0 items)';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (cartGrid) cartGrid.style.display = 'grid';

  const totalCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  if (cartItemCount) cartItemCount.textContent = `(${totalCount} item${totalCount > 1 ? 's' : ''})`;

  // Render Cart Item Cards
  if (cartItemsList) {
    cartItemsList.innerHTML = '';
    cart.forEach(item => {
      const price = Number(item.price) || 0;
      const qty = Number(item.quantity) || 1;
      const lineTotal = price * qty;
      const stock = Number(item.stock) || 99;

      const itemCard = document.createElement('div');
      itemCard.className = 'cart-item-card';
      itemCard.dataset.id = item.productId || item.id;

      itemCard.innerHTML = `
        <div class="cart-item-thumb">
          <img src="${item.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=300&q=80'}" alt="${item.name}" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=300&q=80'">
        </div>
        <div class="cart-item-details">
          <div class="cart-item-header">
            <div>
              <h3 class="cart-item-title">${item.name}</h3>
              <span class="cart-item-seller">Artisan: ${item.sellerName || 'Verified Guild Member'}</span>
            </div>
            <button type="button" class="cart-item-remove-btn" title="Remove item">&times;</button>
          </div>
          <div class="cart-item-footer">
            <div class="cart-qty-control">
              <button type="button" class="qty-btn dec-btn" ${qty <= 1 ? 'disabled' : ''}>-</button>
              <input type="number" class="qty-input" value="${qty}" min="1" max="${stock}" readonly>
              <button type="button" class="qty-btn inc-btn" ${qty >= stock ? 'disabled' : ''}>+</button>
            </div>
            <div class="cart-item-pricing">
              <span class="unit-price">₱${price.toFixed(2)} each</span>
              <strong class="line-total">₱${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
            </div>
          </div>
        </div>
      `;

      // Event Listeners for Item Actions
      const removeBtn = itemCard.querySelector('.cart-item-remove-btn');
      const decBtn = itemCard.querySelector('.dec-btn');
      const incBtn = itemCard.querySelector('.inc-btn');

      removeBtn.addEventListener('click', () => {
        ArtisanDB.removeFromCart(item.productId || item.id);
        renderCart();
      });

      decBtn.addEventListener('click', () => {
        if (qty > 1) {
          ArtisanDB.updateCartQuantity(item.productId || item.id, qty - 1);
          renderCart();
        }
      });

      incBtn.addEventListener('click', () => {
        if (qty < stock) {
          ArtisanDB.updateCartQuantity(item.productId || item.id, qty + 1);
          renderCart();
        } else {
          alert(`Maximum available stock reached for ${item.name} (${stock} units).`);
        }
      });

      cartItemsList.appendChild(itemCard);
    });
  }

  // Update Summary Sidebar
  const subtotal = cart.reduce((acc, i) => acc + (Number(i.price) * Number(i.quantity)), 0);
  const shipping = subtotal >= 1000 ? 0 : 50;
  const grandTotal = subtotal + shipping;

  const subtotalEl = document.getElementById('summarySubtotal');
  const shippingEl = document.getElementById('summaryShipping');
  const grandTotalEl = document.getElementById('summaryGrandTotal');

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (shippingEl) shippingEl.textContent = shipping === 0 ? 'FREE' : `₱${shipping.toFixed(2)}`;
  if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function setupPaymentListener() {
  const radios = document.querySelectorAll('input[name="paymentOption"]');
  const gcashPanel = document.getElementById('gcashDirectDetailsPanel');
  const submitBtn = document.getElementById('placeOrderSubmitBtn');

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'GCash') {
        if (gcashPanel) gcashPanel.style.display = 'block';
        if (submitBtn) {
          submitBtn.querySelector('.btn-text').textContent = 'Proceed to GCash Payment →';
          submitBtn.style.background = '#007DFE';
        }
      } else {
        if (gcashPanel) gcashPanel.style.display = 'none';
        if (submitBtn) {
          submitBtn.querySelector('.btn-text').textContent = 'Place Order (Cash on Delivery)';
          submitBtn.style.background = '#285c3b';
        }
      }
    });
  });
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
    let paymentStatus = paymentMethod === 'Cash on Delivery' ? 'Due on delivery' : 'Pending Payment';
    let orderStatus = paymentMethod === 'Cash on Delivery' ? 'Processing' : 'Awaiting Payment';

    // Set Loading State
    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = paymentMethod === 'GCash' ? 'Redirecting to GCash...' : 'Processing Order...';
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
        subtotal,
        shipping,
        total
      };

      // 3. Write to Firestore via ArtisanDB
      const createdOrder = await ArtisanDB.createOrder(orderPayload);

      // 4. Clear cart on verified creation
      ArtisanDB.clearCart();
      updateHeaderAuth();

      // 5. IF GCASH: Redirect immediately to GCash payment gateway
      if (paymentMethod === 'GCash') {
        window.location.href = `gcash-checkout.html?orderId=${createdOrder.id}`;
        return;
      }

      // 6. IF COD: Show Success Modal
      document.getElementById('successModalTitle').textContent = 'Order Successfully Placed!';
      document.getElementById('successModalSubtitle').textContent = 'Thank you for supporting our local artisans. Your order details have been recorded.';
      document.getElementById('receiptOrderNumber').textContent = createdOrder.orderNumber;
      document.getElementById('receiptPaymentMethod').textContent = paymentMethod;
      document.getElementById('receiptPaymentStatus').textContent = paymentStatus;
      document.getElementById('receiptTotalAmount').textContent = `₱${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      document.getElementById('receiptGcashRefRow').style.display = 'none';
      document.getElementById('orderSuccessModal').style.display = 'flex';

    } catch (err) {
      console.error('Order creation failure:', err);
      showError(err.message || 'Unable to place order. Please review your cart and try again.');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn-text').textContent = paymentMethod === 'GCash' ? 'Proceed to GCash Payment →' : 'Place Order Now';
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

async function checkPaymentCallback() {
  const params = new URLSearchParams(window.location.search);
  const paymentState = params.get('payment');
  const orderId = params.get('orderId');
  const ref = params.get('ref');

  if (!paymentState || !orderId) return;

  try {
    const order = await ArtisanDB.getOrder(orderId);
    if (!order) return;

    if (paymentState === 'success') {
      // 1. Success verification from GCash / PayMongo
      const methodParam = params.get('method');
      const isPayMongo = methodParam === 'paymongo_gcash' || (order.paymentMethod || '').includes('PayMongo');

      if (order.paymentStatus !== 'Paid') {
        const generatedRef = ref || ('PM-' + Math.random().toString(36).substring(2, 11).toUpperCase());
        await ArtisanDB.updateOrder(orderId, {
          paymentStatus: 'Paid',
          orderStatus: 'Confirmed',
          paymentMethod: isPayMongo ? 'GCash (PayMongo)' : (order.paymentMethod || 'GCash'),
          paymentReference: generatedRef,
          paidAmount: Number(order.total || 0),
          paidAt: new Date().toISOString()
        });
        order.paymentStatus = 'Paid';
        order.paymentReference = generatedRef;
        order.paymentMethod = isPayMongo ? 'GCash (PayMongo)' : (order.paymentMethod || 'GCash');

        // Decrement inventory stock
        if (order.items && Array.isArray(order.items)) {
          for (const item of order.items) {
            const pid = item.productId || item.id;
            const qty = Number(item.quantity) || 1;
            if (pid) {
              try { await ArtisanDB.decrementStock(pid, qty); } catch (e) {}
            }
          }
        }

        ArtisanDB.clearCart();
      }

      document.getElementById('successModalTitle').textContent = isPayMongo ? 'PayMongo GCash Payment Verified!' : 'GCash Payment Verified!';
      document.getElementById('successModalSubtitle').textContent = 'Your GCash transaction went through successfully. Your order is confirmed and marked as PAID.';
      document.getElementById('receiptOrderNumber').textContent = order.orderNumber || orderId;
      document.getElementById('receiptPaymentMethod').textContent = order.paymentMethod || (isPayMongo ? 'GCash (PayMongo)' : 'GCash (QRPh)');
      
      const refRow = document.getElementById('receiptGcashRefRow');
      const refVal = document.getElementById('receiptGcashRef');
      if (refRow && refVal) {
        refVal.textContent = ref || order.paymentReference || 'VERIFIED';
        refRow.style.display = 'flex';
      }

      document.getElementById('receiptPaymentStatus').textContent = 'Paid';
      document.getElementById('receiptPaymentStatus').className = 'status-badge-inline delivered';
      document.getElementById('receiptTotalAmount').textContent = `₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      
      document.getElementById('orderSuccessModal').style.display = 'flex';
      history.replaceState(null, null, window.location.pathname);

    } else if (paymentState === 'failed') {
      // 2. Failed / Cancelled flow with alternative choices
      document.getElementById('failedReceiptOrderNumber').textContent = order.orderNumber || orderId;
      document.getElementById('failedReceiptAmount').textContent = `₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const modal = document.getElementById('paymentFailedModal');
      modal.style.display = 'flex';

      // Choice 1: Switch to COD
      document.getElementById('switchToCodBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('switchToCodBtn');
        btn.disabled = true;
        btn.textContent = 'Updating Payment Method...';
        try {
          await ArtisanDB.updateOrder(orderId, {
            paymentMethod: 'Cash on Delivery',
            paymentStatus: 'Due on delivery',
            orderStatus: 'Confirmed'
          });
          alert('Payment method switched to Cash on Delivery (COD)! Your order is now confirmed.');
          modal.style.display = 'none';
          switchTab('orders');
        } catch (e) {
          alert('Failed to update payment method: ' + e.message);
          btn.disabled = false;
          btn.textContent = 'Switch to Cash on Delivery (COD)';
        }
      });

      // Choice 2: Retry GCash
      document.getElementById('retryGcashBtn')?.addEventListener('click', () => {
        window.location.href = `gcash-checkout.html?orderId=${orderId}`;
      });

      // Choice 3: Cancel Order
      document.getElementById('cancelFailedOrderBtn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to cancel this order?')) {
          await ArtisanDB.updateOrder(orderId, {
            orderStatus: 'Cancelled',
            paymentStatus: 'Cancelled'
          });
          modal.style.display = 'none';
          switchTab('orders');
        }
      });

      history.replaceState(null, null, window.location.pathname);
    }
  } catch (err) {
    console.error('Payment callback check error:', err);
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
      const isPaid = order.paymentStatus === 'Paid';
      const paymentBadgeClass = isPaid ? 'paid-badge' : 'unpaid-badge';

      // If unpaid GCash order, show Pay Now button
      const canPayGcash = !isPaid && order.paymentMethod === 'GCash' && order.orderStatus !== 'Cancelled';

      // Calculate tracking step
      let currentStep = 1;
      const s = String(order.orderStatus || '').toLowerCase();
      if (s === 'delivered') currentStep = 5;
      else if (s === 'out for delivery') currentStep = 4;
      else if (s === 'shipped') currentStep = 3;
      else if (s === 'packed') currentStep = 3;
      else if (s === 'processing' || s === 'confirmed') currentStep = 2;

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

        <!-- Live Order Tracking Stepper -->
        <div class="order-tracking-stepper-box">
          <div class="tracking-stepper">
            <div class="step-point ${currentStep >= 1 ? (currentStep > 1 ? 'completed' : 'active') : ''}">
              <div class="circle">${currentStep > 1 ? '✓' : '1'}</div>
              <span>Placed</span>
            </div>
            <div class="step-line ${currentStep >= 2 ? 'completed' : ''}"></div>
            <div class="step-point ${currentStep >= 2 ? (currentStep > 2 ? 'completed' : 'active') : ''}">
              <div class="circle">${currentStep > 2 ? '✓' : '2'}</div>
              <span>Processing</span>
            </div>
            <div class="step-line ${currentStep >= 3 ? 'completed' : ''}"></div>
            <div class="step-point ${currentStep >= 3 ? (currentStep > 3 ? 'completed' : 'active') : ''}">
              <div class="circle">${currentStep > 3 ? '✓' : '3'}</div>
              <span>Shipped</span>
            </div>
            <div class="step-line ${currentStep >= 4 ? 'completed' : ''}"></div>
            <div class="step-point ${currentStep >= 4 ? (currentStep > 4 ? 'completed' : 'active') : ''}">
              <div class="circle">${currentStep > 4 ? '✓' : '4'}</div>
              <span>Out for Delivery</span>
            </div>
            <div class="step-line ${currentStep >= 5 ? 'completed' : ''}"></div>
            <div class="step-point ${currentStep >= 5 ? 'completed' : ''}">
              <div class="circle">${currentStep >= 5 ? '✓' : '5'}</div>
              <span>Delivered</span>
            </div>
          </div>

          <div class="tracking-live-info">
            <div class="tracking-info-grid">
              <div>
                <small>Courier</small>
                <strong>${order.courier || 'Artisan Direct / Local Logistics'}</strong>
              </div>
              <div>
                <small>Tracking Reference</small>
                <strong>${order.trackingNumber ? `<code>${order.trackingNumber}</code>` : 'Pending Pickup'}</strong>
              </div>
              <div>
                <small>Current Location</small>
                <strong>${order.currentLocation || 'Artisan Workshop'}</strong>
              </div>
            </div>
            ${order.trackingNotes ? `
              <div class="tracking-note-banner">
                <small><strong>Latest Tracking Update:</strong></small> ${order.trackingNotes}
              </div>
            ` : ''}
          </div>
        </div>

        <div class="order-card-footer">
          <div class="order-shipping-summary">
            <strong>Delivery to:</strong> ${order.customerName || 'Customer'} • ${order.shippingAddress || 'Standard Delivery'}
            ${order.paymentReference ? `<br><small style="color:#007DFE; font-weight:600;">GCash Ref: ${order.paymentReference}</small>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="order-total-highlight">
              Total: <strong>₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
            </div>
            ${canPayGcash ? `
              <a href="gcash-checkout.html?orderId=${order.id}" class="action-btn" style="background:#007DFE; color:white; padding:8px 14px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:700; white-space:nowrap;">
                Pay with GCash
              </a>
            ` : ''}
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  });
}
