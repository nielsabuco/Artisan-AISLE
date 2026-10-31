import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';
import { PayMongo } from './paymongo-service.js';

let isSubmitting = false;

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  setupCourierAutoDetect();
  renderCart();
  setupPaymentListener();
  setupPlaceOrder();
  loadSavedShipping();
  setupRealtimeStockSync();
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
              <span class="cart-item-seller">Artisan: <a href="artisans.html?sellerId=${encodeURIComponent(item.sellerId || '')}&sellerName=${encodeURIComponent(item.sellerName || '')}" class="artisan-link-inline" style="font-size:12px; font-weight:600; text-decoration:underline;" title="View this artisan's workshop and profile">${item.sellerName || 'Verified Guild Member'}</a></span>
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

  // Update Summary Sidebar with Courier Distance Rate
  const subtotal = cart.reduce((acc, i) => acc + (Number(i.price) * Number(i.quantity)), 0);
  const courierInfo = getCourierRateInfo();
  // Free shipping promo if subtotal >= 2500, otherwise courier rate based on distance
  const shipping = (cart.length > 0 && subtotal >= 2500) ? 0 : (cart.length > 0 ? courierInfo.rate : 0);
  const grandTotal = subtotal + shipping;

  const subtotalEl = document.getElementById('summarySubtotal');
  const shippingEl = document.getElementById('summaryShipping');
  const grandTotalEl = document.getElementById('summaryGrandTotal');

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (shippingEl) {
    if (cart.length === 0) {
      shippingEl.textContent = '₱0.00';
    } else if (shipping === 0) {
      shippingEl.textContent = 'FREE (Promo ₱2,500+)';
    } else {
      shippingEl.textContent = `₱${shipping.toFixed(2)} (${courierInfo.label})`;
    }
  }
  if (grandTotalEl) grandTotalEl.textContent = `₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function setupPaymentListener() {
  const radios = document.querySelectorAll('input[name="paymentOption"]');
  const codPanel = document.getElementById('codDirectDetailsPanel');
  const gcashPanel = document.getElementById('gcashDirectDetailsPanel');
  const mayaPanel = document.getElementById('mayaDirectDetailsPanel');
  const cardPanel = document.getElementById('cardDirectDetailsPanel');
  const submitBtn = document.getElementById('placeOrderSubmitBtn');

  const updatePanels = (val) => {
    if (codPanel) codPanel.style.display = val === 'Cash on Delivery' ? 'block' : 'none';
    if (gcashPanel) gcashPanel.style.display = val === 'GCash' ? 'block' : 'none';
    if (mayaPanel) mayaPanel.style.display = val === 'Maya' ? 'block' : 'none';
    if (cardPanel) cardPanel.style.display = val === 'Credit / Debit Card' ? 'block' : 'none';

    if (submitBtn) {
      const btnText = submitBtn.querySelector('.btn-text');
      if (val === 'GCash') {
        if (btnText) btnText.textContent = 'Proceed to GCash Payment →';
        submitBtn.style.background = '#007DFE';
      } else if (val === 'Maya') {
        if (btnText) btnText.textContent = 'Proceed to Maya Payment →';
        submitBtn.style.background = '#00A859';
      } else if (val === 'Credit / Debit Card') {
        if (btnText) btnText.textContent = 'Pay with Credit / Debit Card →';
        submitBtn.style.background = '#1e293b';
      } else {
        if (btnText) btnText.textContent = 'Place Order (Cash on Delivery)';
        submitBtn.style.background = '#285c3b';
      }
    }
  };

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      updatePanels(radio.value);
    });
  });

  const checked = document.querySelector('input[name="paymentOption"]:checked');
  if (checked) {
    updatePanels(checked.value);
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
    let paymentStatus = paymentMethod === 'Cash on Delivery' ? 'Due on delivery' : 'Pending Payment';
    let orderStatus = paymentMethod === 'Cash on Delivery' ? 'Processing' : 'Awaiting Payment';

    // Set Loading State
    isSubmitting = true;
    submitBtn.disabled = true;
    let loadingMsg = 'Processing Order...';
    if (paymentMethod === 'GCash') loadingMsg = 'Redirecting to GCash...';
    else if (paymentMethod === 'Maya') loadingMsg = 'Connecting to Maya...';
    else if (paymentMethod === 'Credit / Debit Card') loadingMsg = 'Connecting to Card Gateway...';

    submitBtn.querySelector('.btn-text').textContent = loadingMsg;
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

      // 2. Prepare Order Payload with Courier Distance Rate
      const subtotal = cart.reduce((acc, i) => acc + (Number(i.price) * Number(i.quantity)), 0);
      const courierInfo = getCourierRateInfo();
      const shipping = subtotal >= 2500 ? 0 : courierInfo.rate;
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
        total,
        courierZone: courierInfo.zone,
        courierRate: courierInfo.rate,
        shippingRegion: courierInfo.label,
        courierPartner: 'J&T Express / LBC Express'
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

      // 6. IF MAYA: Launch PayMongo or in-page Maya checkout
      if (paymentMethod === 'Maya') {
        try {
          const pmResult = await PayMongo.createCheckoutSession(createdOrder, 'paymaya');
          if (pmResult.success && pmResult.checkoutUrl) {
            window.location.href = pmResult.checkoutUrl;
            return;
          }
        } catch (e) {
          console.warn('PayMongo Maya error, opening sandbox portal:', e);
        }
        openMayaSandboxModal(createdOrder);
        return;
      }

      // 7. IF CREDIT / DEBIT CARD: Launch PayMongo or in-page Card modal
      if (paymentMethod === 'Credit / Debit Card') {
        try {
          const pmResult = await PayMongo.createCheckoutSession(createdOrder, 'card');
          if (pmResult.success && pmResult.checkoutUrl) {
            window.location.href = pmResult.checkoutUrl;
            return;
          }
        } catch (e) {
          console.warn('PayMongo Card error, opening sandbox portal:', e);
        }
        openCardSandboxModal(createdOrder);
        return;
      }

      // 8. IF COD: Show Success Modal
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
      let defaultBtnText = 'Place Order (Cash on Delivery)';
      if (paymentMethod === 'GCash') defaultBtnText = 'Proceed to GCash Payment →';
      else if (paymentMethod === 'Maya') defaultBtnText = 'Proceed to Maya Payment →';
      else if (paymentMethod === 'Credit / Debit Card') defaultBtnText = 'Pay with Credit / Debit Card →';
      submitBtn.querySelector('.btn-text').textContent = defaultBtnText;
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
      const methodParam = params.get('method') || '';
      const isMaya = methodParam === 'paymongo_maya' || (order.paymentMethod || '').toLowerCase().includes('maya');
      const isCard = methodParam === 'paymongo_card' || (order.paymentMethod || '').toLowerCase().includes('card');
      const isPayMongo = methodParam.startsWith('paymongo_') || (order.paymentMethod || '').includes('PayMongo');

      let resolvedMethodName = 'GCash (PayMongo)';
      let successTitle = 'Payment Verified!';
      let successSubtitle = 'Your transaction was authorized successfully. Your order is confirmed and marked as PAID.';
      let refPrefix = 'PM-';

      if (isMaya) {
        resolvedMethodName = 'Maya (PayMongo)';
        successTitle = 'Maya Payment Verified!';
        successSubtitle = 'Your Maya mobile wallet payment was authorized successfully. Your order is confirmed and marked as PAID.';
        refPrefix = 'MY-';
      } else if (isCard) {
        resolvedMethodName = 'Credit / Debit Card (PayMongo)';
        successTitle = 'Card Payment Approved!';
        successSubtitle = 'Your credit/debit card was charged successfully via 3D-Secure encrypted checkout. Your order is confirmed and marked as PAID.';
        refPrefix = 'CARD-';
      } else if (isPayMongo) {
        resolvedMethodName = 'GCash (PayMongo)';
        successTitle = 'PayMongo GCash Payment Verified!';
        successSubtitle = 'Your GCash transaction went through successfully. Your order is confirmed and marked as PAID.';
        refPrefix = 'GC-';
      } else {
        resolvedMethodName = order.paymentMethod || 'GCash (QRPh)';
        successTitle = 'GCash Payment Verified!';
        successSubtitle = 'Your GCash transaction went through successfully. Your order is confirmed and marked as PAID.';
        refPrefix = 'QRPH-';
      }

      if (order.paymentStatus !== 'Paid') {
        const generatedRef = ref || (refPrefix + Math.random().toString(36).substring(2, 11).toUpperCase());
        await finalizePaidOrder(orderId, resolvedMethodName, generatedRef, Number(order.total || 0), order.items);
        order.paymentStatus = 'Paid';
        order.paymentReference = generatedRef;
        order.paymentMethod = resolvedMethodName;
      }

      showSuccessReceipt(order, resolvedMethodName, order.paymentReference || ref, successTitle, successSubtitle);
      history.replaceState(null, null, window.location.pathname);

    } else if (paymentState === 'failed') {
      const methodParam = params.get('method') || '';
      const isMaya = methodParam === 'paymongo_maya' || (order.paymentMethod || '').toLowerCase().includes('maya');
      const isCard = methodParam === 'paymongo_card' || (order.paymentMethod || '').toLowerCase().includes('card');

      const failedTitle = document.getElementById('paymentFailedTitle');
      const failedMsg = document.getElementById('paymentFailedMessage');
      const retryBtn = document.getElementById('retryGcashBtn');

      if (isMaya) {
        if (failedTitle) failedTitle.textContent = 'Maya Payment Incomplete';
        if (failedMsg) failedMsg.textContent = 'Your Maya transaction was not completed or was cancelled. Your order has been saved!';
        if (retryBtn) retryBtn.textContent = 'Retry Maya Payment';
      } else if (isCard) {
        if (failedTitle) failedTitle.textContent = 'Card Payment Incomplete';
        if (failedMsg) failedMsg.textContent = 'Your card authorization was not completed or was cancelled. Your order has been saved!';
        if (retryBtn) retryBtn.textContent = 'Retry Card Payment';
      } else {
        if (failedTitle) failedTitle.textContent = 'GCash Payment Incomplete';
        if (failedMsg) failedMsg.textContent = 'Your GCash transaction was not completed or was cancelled. Your order has been saved!';
        if (retryBtn) retryBtn.textContent = 'Retry GCash Payment';
      }

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
      }, { once: true });

      // Choice 2: Retry Payment
      retryBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
        if (isMaya) {
          openMayaSandboxModal(order);
        } else if (isCard) {
          openCardSandboxModal(order);
        } else {
          window.location.href = `gcash-checkout.html?orderId=${orderId}`;
        }
      }, { once: true });

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
      }, { once: true });

      history.replaceState(null, null, window.location.pathname);
    }
  } catch (err) {
    console.error('Payment callback check error:', err);
  }
}

/**
 * Finalizes an order as Paid in Firestore and decrements product inventory
 */
async function finalizePaidOrder(orderId, paymentMethod, reference, totalAmount, items) {
  await ArtisanDB.updateOrder(orderId, {
    paymentStatus: 'Paid',
    orderStatus: 'Confirmed',
    paymentMethod: paymentMethod,
    paymentReference: reference,
    paidAmount: Number(totalAmount || 0),
    paidAt: new Date().toISOString()
  });

  // Decrement inventory stock
  if (items && Array.isArray(items)) {
    for (const item of items) {
      const pid = item.productId || item.id;
      const qty = Number(item.quantity) || 1;
      if (pid) {
        try { await ArtisanDB.decrementStock(pid, qty); } catch (e) {}
      }
    }
  }

  ArtisanDB.clearCart();
  updateHeaderAuth();
}

/**
 * Displays the verified order receipt modal
 */
function showSuccessReceipt(order, paymentMethod, reference, title, subtitle) {
  document.getElementById('successModalTitle').textContent = title;
  document.getElementById('successModalSubtitle').textContent = subtitle;
  document.getElementById('receiptOrderNumber').textContent = order.orderNumber || order.id;
  document.getElementById('receiptPaymentMethod').textContent = paymentMethod;

  const refRow = document.getElementById('receiptGcashRefRow');
  const refVal = document.getElementById('receiptGcashRef');
  const refLabel = document.getElementById('receiptPaymentRefLabel');
  if (refRow && refVal) {
    if (refLabel) {
      if (paymentMethod.includes('Maya')) refLabel.textContent = 'Maya Ref No:';
      else if (paymentMethod.includes('Card')) refLabel.textContent = 'Card Auth Code:';
      else refLabel.textContent = 'GCash Ref No:';
    }
    refVal.textContent = reference || 'VERIFIED';
    refRow.style.display = 'flex';
  }

  document.getElementById('receiptPaymentStatus').textContent = 'Paid';
  document.getElementById('receiptPaymentStatus').className = 'status-badge-inline delivered';
  document.getElementById('receiptTotalAmount').textContent = `₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  document.getElementById('orderSuccessModal').style.display = 'flex';
}

/**
 * In-Page Maya Sandbox Authorization Modal
 */
function openMayaSandboxModal(order) {
  const modal = document.getElementById('mayaCheckoutModal');
  if (!modal) return;

  const amtEl = document.getElementById('mayaModalAmount');
  const refEl = document.getElementById('mayaModalOrderRef');
  const phoneInput = document.getElementById('mayaMobileInput');
  const errorEl = document.getElementById('mayaModalErrorNotice');
  const confirmBtn = document.getElementById('confirmMayaPayBtn');
  const closeBtn = document.getElementById('closeMayaModalBtn');
  const cancelBtn = document.getElementById('cancelMayaPayBtn');

  if (amtEl) amtEl.textContent = `₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (refEl) refEl.textContent = order.orderNumber || order.id;
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  if (phoneInput && order.customerPhone) {
    let clean = order.customerPhone.replace(/\D/g, '');
    if (clean.startsWith('63')) clean = clean.slice(2);
    if (clean.startsWith('0')) clean = clean.slice(1);
    phoneInput.value = clean;
  }

  modal.style.display = 'flex';

  const closeModal = () => { modal.style.display = 'none'; };
  closeBtn?.addEventListener('click', closeModal, { once: true });
  cancelBtn?.addEventListener('click', closeModal, { once: true });

  confirmBtn?.addEventListener('click', async () => {
    const rawPhone = (phoneInput?.value || '').replace(/\D/g, '');
    if (rawPhone.length < 10) {
      if (errorEl) {
        errorEl.textContent = 'Please enter a valid 10-digit Maya mobile number (e.g. 9853551524).';
        errorEl.style.display = 'block';
      }
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Authorizing with Maya Gateway...';

    try {
      await new Promise(r => setTimeout(r, 900));
      const mayaRef = 'MY-' + Math.floor(1000000000 + Math.random() * 9000000000);

      await finalizePaidOrder(order.id, 'Maya (PayMongo)', mayaRef, Number(order.total || 0), order.items);

      modal.style.display = 'none';
      showSuccessReceipt(
        order,
        'Maya (PayMongo)',
        mayaRef,
        'Maya Payment Verified!',
        'Your Maya transaction was authorized successfully. Your order is confirmed and marked as PAID.'
      );
    } catch (err) {
      console.error('Maya authorization failed:', err);
      if (errorEl) {
        errorEl.textContent = err.message || 'Maya authorization failed. Please try again.';
        errorEl.style.display = 'block';
      }
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Authorize Maya Payment';
    }
  }, { once: true });
}

/**
 * In-Page Credit/Debit Card Sandbox Authorization Modal
 */
function openCardSandboxModal(order) {
  const modal = document.getElementById('cardCheckoutModal');
  if (!modal) return;

  const amtEl = document.getElementById('cardModalAmount');
  const numInput = document.getElementById('cardNumberInput');
  const nameInput = document.getElementById('cardHolderNameInput');
  const expInput = document.getElementById('cardExpiryInput');
  const cvvInput = document.getElementById('cardCvvInput');
  const errorEl = document.getElementById('cardModalErrorNotice');
  const confirmBtn = document.getElementById('confirmCardPayBtn');
  const autoFillBtn = document.getElementById('cardAutoFillDemoBtn');
  const closeBtn = document.getElementById('closeCardModalBtn');
  const cancelBtn = document.getElementById('cancelCardPayBtn');

  const prevNum = document.getElementById('previewCardNumber');
  const prevName = document.getElementById('previewCardName');
  const prevExp = document.getElementById('previewCardExpiry');
  const prevNet = document.getElementById('previewCardNetwork');

  if (amtEl) amtEl.textContent = `₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  if (nameInput && !nameInput.value && order.customerName) {
    nameInput.value = order.customerName.toUpperCase();
    if (prevName) prevName.textContent = order.customerName.toUpperCase();
  }

  // Live input formatters
  numInput?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').substring(0, 16);
    let parts = v.match(/.{1,4}/g);
    e.target.value = parts ? parts.join(' ') : v;
    if (prevNum) prevNum.textContent = e.target.value || '•••• •••• •••• ••••';

    if (prevNet) {
      if (v.startsWith('4')) prevNet.textContent = 'VISA';
      else if (v.startsWith('5')) prevNet.textContent = 'MASTERCARD';
      else if (v.startsWith('35')) prevNet.textContent = 'JCB';
      else prevNet.textContent = 'CARD';
    }
  });

  nameInput?.addEventListener('input', (e) => {
    if (prevName) prevName.textContent = e.target.value.toUpperCase() || 'YOUR NAME';
  });

  expInput?.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').substring(0, 4);
    if (v.length >= 3) {
      e.target.value = v.substring(0, 2) + '/' + v.substring(2);
    } else {
      e.target.value = v;
    }
    if (prevExp) prevExp.textContent = e.target.value || 'MM/YY';
  });

  autoFillBtn?.addEventListener('click', () => {
    if (numInput) numInput.value = '4242 4242 4242 4242';
    if (nameInput) nameInput.value = (order.customerName || 'MARIA CLARA').toUpperCase();
    if (expInput) expInput.value = '12/28';
    if (cvvInput) cvvInput.value = '888';
    if (prevNum) prevNum.textContent = '4242 4242 4242 4242';
    if (prevName) prevName.textContent = (order.customerName || 'MARIA CLARA').toUpperCase();
    if (prevExp) prevExp.textContent = '12/28';
    if (prevNet) prevNet.textContent = 'VISA';
    if (errorEl) errorEl.style.display = 'none';
  });

  modal.style.display = 'flex';

  const closeModal = () => { modal.style.display = 'none'; };
  closeBtn?.addEventListener('click', closeModal, { once: true });
  cancelBtn?.addEventListener('click', closeModal, { once: true });

  confirmBtn?.addEventListener('click', async () => {
    const rawNum = (numInput?.value || '').replace(/\D/g, '');
    const exp = (expInput?.value || '').trim();
    const cvv = (cvvInput?.value || '').trim();
    const name = (nameInput?.value || '').trim();

    if (rawNum.length < 15 || rawNum.length > 16) {
      showCardError('Please enter a valid 16-digit credit or debit card number.');
      return;
    }
    if (!exp.includes('/') || exp.length < 5) {
      showCardError('Please enter a valid expiry date in MM/YY format.');
      return;
    }
    if (cvv.length < 3) {
      showCardError('Please enter a 3 or 4-digit security CVV code.');
      return;
    }
    if (!name) {
      showCardError('Please enter the cardholder name.');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Authorizing 3D-Secure...';

    try {
      await new Promise(r => setTimeout(r, 1100));
      const cardRef = 'CARD-' + Math.random().toString(36).substring(2, 10).toUpperCase();

      await finalizePaidOrder(order.id, 'Credit / Debit Card (PayMongo)', cardRef, Number(order.total || 0), order.items);

      modal.style.display = 'none';
      showSuccessReceipt(
        order,
        'Credit / Debit Card (PayMongo)',
        cardRef,
        'Card Payment Approved!',
        'Your credit/debit card was charged successfully via 256-bit encrypted checkout. Your order is confirmed and marked as PAID.'
      );
    } catch (err) {
      console.error('Card payment failed:', err);
      showCardError(err.message || 'Payment authorization failed. Please check your card details.');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Pay Securely Now';
    }
  }, { once: true });

  function showCardError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
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
              <a href="review.html?orderId=${order.id}&productId=${item.productId || item.id || ''}&productName=${encodeURIComponent(item.name || 'Craft Item')}" class="btn-review-item" style="margin-left: auto; text-decoration: none; padding: 6px 12px; background: #fdfaf5; border: 1.5px solid #c88937; color: #1d4831; border-radius: 6px; font-size: 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">
                ⭐ Review Item
              </a>
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

/* ================= COURIER DISTANCE SHIPPING & REAL-TIME STOCK ================= */
export function getCourierRateInfo() {
  const select = document.getElementById('shippingCourierRegion');
  if (!select) return { rate: 60, label: 'Metro Manila (NCR)', zone: 'ncr' };
  const opt = select.options[select.selectedIndex];
  const rate = Number(opt?.dataset.rate || 60);
  const label = opt?.dataset.label || 'Metro Manila (NCR)';
  const zone = select.value || 'ncr';
  return { rate, label, zone };
}

function setupCourierAutoDetect() {
  const cityInput = document.getElementById('shippingCity');
  const courierSelect = document.getElementById('shippingCourierRegion');
  const courierTag = document.getElementById('shippingCourierTag');

  if (courierSelect) {
    courierSelect.addEventListener('change', () => {
      const info = getCourierRateInfo();
      if (courierTag) courierTag.textContent = `Tier: ₱${info.rate.toFixed(2)}`;
      renderCart();
    });
  }

  if (cityInput && courierSelect) {
    cityInput.addEventListener('input', () => {
      const val = cityInput.value.toLowerCase().trim();
      let matchedZone = null;
      if (val.match(/manila|quezon|makati|taguig|pasig|mandaluyong|paranaque|pasay|valenzuela|caloocan|marikina|las pinas|muntinlupa|malabon|navotas|san juan|pateros|ncr/i)) {
        matchedZone = 'ncr';
      } else if (val.match(/cavite|laguna|batangas|rizal|bulacan|antipolo|calamba|santa rosa|dasmarinas|bacoor|imus/i)) {
        matchedZone = 'gma';
      } else if (val.match(/baguio|benguet|ilocos|la union|pangasinan|pampanga|tarlac|zambales|bataan|nueva ecija|albay|camarines|sorsogon|bicol|vigan|clark|angeles|legazpi|naga/i)) {
        matchedZone = 'luzon';
      } else if (val.match(/cebu|mandaue|lapu-lapu|bohol|tagbilaran|iloilo|bacolod|leyte|tacloban|samar|calbiga|catbalogan|borongan|panay|negros|dumaguete/i)) {
        matchedZone = 'visayas';
      } else if (val.match(/davao|cagayan de oro|cdo|zamboanga|general santos|gensan|bukidnon|butuan|cotabato|iligan|koronadal/i)) {
        matchedZone = 'mindanao';
      } else if (val.match(/palawan|puerto princesa|coron|batanes|basilan|sulu|tawi-tawi|catanduanes|marinduque|romblon|siargao/i)) {
        matchedZone = 'island';
      }

      if (matchedZone && courierSelect.value !== matchedZone) {
        courierSelect.value = matchedZone;
        const info = getCourierRateInfo();
        if (courierTag) courierTag.textContent = `Tier: ₱${info.rate.toFixed(2)}`;
        renderCart();
      }
    });
  }
}

function setupRealtimeStockSync() {
  ArtisanDB.subscribeProducts((prods) => {
    const cart = ArtisanDB.getCart();
    if (!cart || cart.length === 0) return;

    let modified = false;
    cart.forEach(item => {
      const live = prods.find(p => p.id === (item.productId || item.id));
      if (live) {
        const liveStock = Number(live.stock) || 0;
        if (item.stock !== liveStock) {
          item.stock = liveStock;
          if (item.quantity > liveStock && liveStock > 0) {
            item.quantity = liveStock;
          }
          modified = true;
        }
      }
    });

    if (modified) {
      ArtisanDB.saveCart(cart);
      renderCart();
    }
  });
}
