import { ArtisanDB } from './firebase-config.js';
import { PayMongo } from './paymongo-service.js';

let currentOrder = null;
let orderId = '';
let currentSession = null;
let timerInterval = null;
let pollInterval = null;
let timeLeftSeconds = 15 * 60; // 15 minutes

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  orderId = params.get('orderId');

  if (!orderId) {
    alert('No order reference found. Returning to shopping cart.');
    window.location.href = 'cart.html';
    return;
  }

  await loadOrderDetails();
  await checkGatewayStatus();
  setupEventListeners();
  startCountdownTimer();
  await initializePayMongoGcashSession();
});

/**
 * Loads order details and displays the complete shipping fee breakdown
 */
async function loadOrderDetails() {
  try {
    currentOrder = await ArtisanDB.getOrder(orderId);
    if (!currentOrder) {
      showError('Order not found in database. Please return to your order history.');
      return;
    }

    // Check if already marked as Paid
    if (currentOrder.paymentStatus === 'Paid') {
      alert('This order has already been paid and confirmed!');
      window.location.href = `cart.html?payment=success&orderId=${orderId}&method=paymongo_gcash&ref=${currentOrder.paymentReference || 'VERIFIED'}`;
      return;
    }

    const subtotal = Number(currentOrder.subtotal || 0) || (Array.isArray(currentOrder.items) ? currentOrder.items.reduce((acc, i) => acc + (Number(i.price || 0) * Number(i.quantity || 1)), 0) : 0);
    const shipping = Number(currentOrder.shipping || 0);
    const discount = Number(currentOrder.discount || 0);
    const total = Number(currentOrder.total || 0) || Math.max(0, subtotal - discount) + shipping;

    const totalFormatted = `₱${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const subtotalFormatted = `₱${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const shippingFormatted = shipping > 0 ? `+₱${shipping.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'FREE';
    const orderRef = currentOrder.orderNumber || orderId;

    // Display banner figures
    document.getElementById('gcashTotalAmountDisplay').textContent = totalFormatted;
    document.getElementById('gcashOrderNumberTag').textContent = `Order Reference: ${orderRef}`;

    // Itemized summary figures (including shipping fee)
    const subtotalEl = document.getElementById('pmItemsSubtotalText');
    if (subtotalEl) subtotalEl.textContent = subtotalFormatted;

    const shippingEl = document.getElementById('pmShippingFeeText');
    if (shippingEl) shippingEl.textContent = shippingFormatted;

    const discountRow = document.getElementById('pmDiscountRow');
    const discountEl = document.getElementById('pmDiscountText');
    if (discountRow && discountEl) {
      if (discount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-₱${discount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      } else {
        discountRow.style.display = 'none';
      }
    }

    // Total payable figures
    const pmPayable = document.getElementById('pmPayableAmount');
    if (pmPayable) pmPayable.textContent = totalFormatted;

    const pmOrderRef = document.getElementById('pmOrderRefText');
    if (pmOrderRef) pmOrderRef.textContent = orderRef;

    const pmBtnAmt = document.getElementById('pmBtnAmount');
    if (pmBtnAmt) pmBtnAmt.textContent = totalFormatted;

    const qrStepAmt = document.getElementById('qrStepAmount');
    if (qrStepAmt) qrStepAmt.textContent = totalFormatted;

    // Merchant identity
    document.getElementById('gcashMerchantName').textContent = 'ArtisanAisle Official Store (PayMongo Live)';

  } catch (err) {
    console.error('Failed to load order:', err);
    showError('Unable to load order details. Please check your internet connection.');
  }
}

/**
 * Initializes the PayMongo GCash QR Checkout Session
 */
async function initializePayMongoGcashSession() {
  if (!currentOrder) return;

  const qrImg = document.getElementById('qrphImageTag');
  const proceedBtn = document.getElementById('paymongoProceedBtn');
  const checkPill = document.getElementById('pmAutoCheckPill');

  try {
    const session = await PayMongo.createCheckoutSession(currentOrder, 'gcash');

    if (session && session.success && session.checkoutUrl) {
      currentSession = session;

      // Render the live QR code pointing directly to PayMongo's secure GCash checkout session
      if (qrImg) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=6&data=${encodeURIComponent(session.checkoutUrl)}`;
        qrImg.src = qrUrl;
        qrImg.alt = 'Scan to Pay with GCash App';
      }

      // Configure proceed button
      if (proceedBtn) {
        proceedBtn.onclick = () => {
          window.location.href = session.checkoutUrl;
        };
      }

      // Start automatic payment polling every 3.5 seconds
      startPaymentPolling(session.sessionId);

    } else if (session && session.needsSetup) {
      if (checkPill) {
        checkPill.innerHTML = '⚠️ PayMongo API key required in Admin Console';
        checkPill.style.background = '#fef3c7';
        checkPill.style.color = '#92400e';
      }
      showError('PayMongo gateway is awaiting API credentials. Please set your PayMongo keys in Admin Console > Payment Gateway.');
    } else {
      throw new Error(session?.error || 'Could not create PayMongo GCash checkout session.');
    }
  } catch (err) {
    console.error('PayMongo GCash session initiation error:', err);
    showError(err.message || 'Error connecting to PayMongo Live GCash gateway.');
  }
}

/**
 * Periodically polls the payment status and auto-redirects on confirmation
 */
function startPaymentPolling(sessionId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      // 1. Check order directly in Firestore in case webhook or background worker updated it
      const order = await ArtisanDB.getOrder(orderId);
      if (order && order.paymentStatus === 'Paid') {
        clearInterval(pollInterval);
        handlePaymentSuccess(order.paymentReference || 'VERIFIED');
        return;
      }

      // 2. Query PayMongo verify endpoint
      if (sessionId) {
        const check = await PayMongo.verifyPayment(sessionId);
        if (check && check.paid) {
          clearInterval(pollInterval);

          // Update order in Firestore
          const paymentRef = check.paymentId || ('PM-GC-' + Date.now().toString(36).toUpperCase());
          await ArtisanDB.updateOrder(orderId, {
            paymentStatus: 'Paid',
            orderStatus: 'Confirmed',
            paymentMethod: 'GCash (PayMongo Live QR)',
            paymentReference: paymentRef,
            paidAt: new Date().toISOString()
          });

          handlePaymentSuccess(paymentRef);
        }
      }
    } catch (e) {
      console.warn('Payment check attempt:', e);
    }
  }, 3500);
}

/**
 * Handles payment success and transitions to receipt
 */
function handlePaymentSuccess(refId) {
  const overlay = document.getElementById('gcashProcessingOverlay');
  const title = document.getElementById('gcashProcessingTitle');
  const msg = document.getElementById('gcashProcessingMsg');

  if (overlay) overlay.style.display = 'flex';
  if (title) title.textContent = '🎉 Payment Confirmed!';
  if (msg) msg.textContent = 'Your GCash payment via PayMongo has been verified. Redirecting to your confirmed order receipt...';

  setTimeout(() => {
    window.location.href = `cart.html?payment=success&orderId=${orderId}&method=paymongo_gcash&ref=${refId}`;
  }, 1400);
}

/**
 * Checks and updates PayMongo gateway status banner in the UI
 */
async function checkGatewayStatus() {
  try {
    const status = await PayMongo.getStatus();
    const title = document.getElementById('pmStatusTitle');
    const modeText = document.getElementById('pmModeIndicatorText');

    if (title && modeText) {
      if (status.isConfigured) {
        title.textContent = status.isLiveMode ? 'PayMongo Live GCash QR Gateway' : 'PayMongo Sandbox Gateway';
        modeText.textContent = status.isLiveMode 
          ? 'Live mode active — Real money GCash QR payments accepted' 
          : 'Sandbox testing mode active — Scan or launch test checkout';
      } else {
        title.textContent = 'PayMongo Gateway (Awaiting Keys)';
        modeText.textContent = 'Configure sk_live_... key in Admin Console to accept real customer payments';
      }
    }
  } catch (e) {
    console.warn('Could not check gateway status:', e);
  }
}

/**
 * Sets up user interaction listeners
 */
function setupEventListeners() {
  // Manual check status button
  const checkStatusBtn = document.getElementById('gcashCheckStatusBtn');
  checkStatusBtn?.addEventListener('click', async () => {
    checkStatusBtn.disabled = true;
    checkStatusBtn.textContent = 'Checking PayMongo settlement...';

    try {
      const order = await ArtisanDB.getOrder(orderId);
      if (order && order.paymentStatus === 'Paid') {
        handlePaymentSuccess(order.paymentReference || 'VERIFIED');
        return;
      }

      if (currentSession?.sessionId) {
        const verifyRes = await PayMongo.verifyPayment(currentSession.sessionId);
        if (verifyRes && verifyRes.paid) {
          const paymentRef = verifyRes.paymentId || ('PM-GC-' + Date.now().toString(36).toUpperCase());
          await ArtisanDB.updateOrder(orderId, {
            paymentStatus: 'Paid',
            orderStatus: 'Confirmed',
            paymentMethod: 'GCash (PayMongo Live QR)',
            paymentReference: paymentRef,
            paidAt: new Date().toISOString()
          });
          handlePaymentSuccess(paymentRef);
          return;
        }
      }

      alert('No confirmed payment detected yet. Please ensure you have completed the GCash authorization in your app, then try again in a few moments.');
    } catch (e) {
      alert('Error verifying payment: ' + e.message);
    } finally {
      checkStatusBtn.disabled = false;
      checkStatusBtn.textContent = '🔄 I Have Paid in GCash — Verify Payment Now';
    }
  });

  // Cancel link
  const cancelBtn = document.getElementById('pmCancelBtn');
  cancelBtn?.addEventListener('click', () => {
    if (pollInterval) clearInterval(pollInterval);
    if (timerInterval) clearInterval(timerInterval);
    window.location.href = `cart.html?payment=failed&orderId=${orderId}&reason=cancelled&method=paymongo_gcash`;
  });
}

/**
 * Starts 15-minute expiration countdown timer
 */
function startCountdownTimer() {
  const timerDisplay = document.getElementById('qrTimerDisplay');

  timerInterval = setInterval(() => {
    timeLeftSeconds--;

    if (timeLeftSeconds <= 0) {
      clearInterval(timerInterval);
      if (pollInterval) clearInterval(pollInterval);
      if (timerDisplay) timerDisplay.textContent = '00:00 (Expired)';
      showError('This PayMongo GCash QR payment session has expired. Please return to your shopping cart to generate a new session.');
      const proceedBtn = document.getElementById('paymongoProceedBtn');
      if (proceedBtn) proceedBtn.disabled = true;
      return;
    }

    const mins = Math.floor(timeLeftSeconds / 60);
    const secs = timeLeftSeconds % 60;
    if (timerDisplay) {
      timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);
}

function showError(msg) {
  const banner = document.getElementById('gcashErrorBanner');
  if (banner) {
    banner.textContent = msg;
    banner.style.display = 'block';
  }
}
