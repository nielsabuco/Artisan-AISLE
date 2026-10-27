import { ArtisanDB } from './firebase-config.js';

let currentOrder = null;
let orderId = '';

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  orderId = params.get('orderId');

  if (!orderId) {
    alert('No order reference found. Returning to cart.');
    window.location.href = 'cart.html';
    return;
  }

  await loadOrderDetails();
  setupEventListeners();
});

async function loadOrderDetails() {
  try {
    currentOrder = await ArtisanDB.getOrder(orderId);
    if (!currentOrder) {
      showError('Order not found in database. Please check your order history.');
      return;
    }

    // Check if already paid
    if (currentOrder.paymentStatus === 'Paid') {
      alert('This order has already been paid!');
      window.location.href = `cart.html?payment=success&orderId=${orderId}&ref=${currentOrder.paymentReference || 'VERIFIED'}`;
      return;
    }

    const totalFormatted = `₱${Number(currentOrder.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    document.getElementById('gcashTotalAmountDisplay').textContent = totalFormatted;
    document.getElementById('gcashBtnAmount').textContent = totalFormatted;
    document.getElementById('gcashOrderNumberTag').textContent = `Order Reference: ${currentOrder.orderNumber || orderId}`;

    if (currentOrder.items && currentOrder.items[0]?.sellerName) {
      document.getElementById('gcashMerchantName').textContent = `Merchant: ${currentOrder.items[0].sellerName} (via ArtisanAisle)`;
    }

    // Pre-fill phone if available
    const phoneInput = document.getElementById('gcashPhoneInput');
    if (currentOrder.customerPhone) {
      let clean = currentOrder.customerPhone.replace(/\D/g, '');
      if (clean.startsWith('63') && clean.length === 12) clean = clean.slice(2);
      if (clean.startsWith('0') && clean.length === 11) clean = clean.slice(1);
      if (clean.length === 10) phoneInput.value = clean;
    }

  } catch (err) {
    console.error('Failed to load order:', err);
    showError('Unable to load order details. Please check your connection.');
  }
}

function setupEventListeners() {
  const payBtn = document.getElementById('gcashConfirmPayBtn');
  const cancelBtn = document.getElementById('gcashCancelBtn');
  const failBtn = document.getElementById('gcashSimulateFailBtn');

  payBtn?.addEventListener('click', handlePaymentSubmit);
  
  cancelBtn?.addEventListener('click', () => {
    window.location.href = `cart.html?payment=failed&orderId=${orderId}&reason=cancelled`;
  });

  failBtn?.addEventListener('click', () => {
    window.location.href = `cart.html?payment=failed&orderId=${orderId}&reason=declined`;
  });
}

async function handlePaymentSubmit() {
  hideError();

  const phone = document.getElementById('gcashPhoneInput').value.trim();
  const mpin = document.getElementById('gcashMpinInput').value.trim();

  if (!phone || phone.length !== 10) {
    showError('Please enter a valid 10-digit GCash mobile number (e.g. 9171234567).');
    return;
  }

  if (!mpin || mpin.length !== 4) {
    showError('Please enter your 4-digit GCash MPIN.');
    return;
  }

  const overlay = document.getElementById('gcashProcessingOverlay');
  const title = document.getElementById('gcashProcessingTitle');
  const msg = document.getElementById('gcashProcessingMsg');
  const payBtn = document.getElementById('gcashConfirmPayBtn');

  payBtn.disabled = true;
  overlay.style.display = 'flex';

  try {
    // Stage 1
    title.textContent = 'Connecting to GCash...';
    msg.textContent = 'Contacting the GCash payments network...';
    await delay(1000);

    // Stage 2
    title.textContent = 'Authorizing Balance...';
    msg.textContent = `Deducting ₱${Number(currentOrder.total || 0).toLocaleString()} from GCash account 09${phone.slice(1, 4)}••••${phone.slice(-3)}...`;
    await delay(1200);

    // Stage 3: Success & Reference Generation
    title.textContent = 'Payment Approved!';
    msg.textContent = 'Transaction verified! Returning you back to ArtisanAisle...';

    // Official 13-digit GCash reference number starting with 9
    const gcashRef = '9' + Math.floor(100000000000 + Math.random() * 900000000000);

    // Update order in Firestore
    await ArtisanDB.updateOrder(orderId, {
      paymentStatus: 'Paid',
      orderStatus: 'Confirmed',
      paymentReference: gcashRef,
      paymentMethod: 'GCash',
      payerGcashPhone: `09${phone}`,
      paidAmount: Number(currentOrder.total || 0)
    });

    await delay(1000);

    // Redirect back to website with success verification
    window.location.href = `cart.html?payment=success&orderId=${orderId}&ref=${gcashRef}`;

  } catch (err) {
    console.error('GCash payment error:', err);
    overlay.style.display = 'none';
    payBtn.disabled = false;
    showError('Payment authorization failed: ' + err.message);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showError(msg) {
  const errBox = document.getElementById('gcashErrorBanner');
  if (errBox) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
  }
}

function hideError() {
  const errBox = document.getElementById('gcashErrorBanner');
  if (errBox) errBox.style.display = 'none';
}
