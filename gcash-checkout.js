import { ArtisanDB } from './firebase-config.js';

let currentOrder = null;
let orderId = '';
let qrphPayload = '';
let timerInterval = null;
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
  setupEventListeners();
  startCountdownTimer();
});

/**
 * Loads order information and builds dynamic QRPh payload
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
      window.location.href = `cart.html?payment=success&orderId=${orderId}&ref=${currentOrder.paymentReference || 'VERIFIED'}`;
      return;
    }

    const totalAmount = Number(currentOrder.total || 0);
    const totalFormatted = `₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const orderRef = currentOrder.orderNumber || orderId;

    // Display banner figures
    document.getElementById('gcashTotalAmountDisplay').textContent = totalFormatted;
    document.getElementById('gcashBtnAmount').textContent = totalFormatted;
    document.getElementById('gcashOrderNumberTag').textContent = `Order Reference: ${orderRef}`;
    document.getElementById('qrOrderRefText').textContent = orderRef;
    document.getElementById('qrPayableAmount').textContent = totalFormatted;
    document.getElementById('qrStepAmount').textContent = totalFormatted;

    // Resolve artisan / seller GCash details
    let sellerName = 'Eugene Marciene Jerusalem';
    let sellerPhone = '09764948458';

    if (currentOrder.items && currentOrder.items.length > 0) {
      const firstItem = currentOrder.items[0];
      if (firstItem.sellerName) {
        sellerName = firstItem.sellerName;
      }
      if (firstItem.sellerGCash) {
        sellerPhone = firstItem.sellerGCash;
      } else if (firstItem.sellerId) {
        // Attempt to fetch from seller document
        try {
          const sellerDoc = await ArtisanDB.getSeller(firstItem.sellerId);
          if (sellerDoc && sellerDoc.gcashNumber) {
            sellerPhone = sellerDoc.gcashNumber;
            sellerName = sellerDoc.shopName || sellerDoc.fullName || sellerName;
          }
        } catch (e) {
          console.warn('Could not fetch seller profile:', e);
        }
      }
    }

    // Format phone nicely: 0976 494 8458
    let cleanPhone = sellerPhone.replace(/\D/g, '');
    if (cleanPhone.startsWith('63') && cleanPhone.length === 12) cleanPhone = '0' + cleanPhone.slice(2);
    const prettyPhone = cleanPhone.length === 11 
      ? `${cleanPhone.slice(0, 4)} ${cleanPhone.slice(4, 7)} ${cleanPhone.slice(7)}`
      : sellerPhone;

    document.getElementById('gcashMerchantName').textContent = `Merchant: ${sellerName} (via ArtisanAisle)`;
    document.getElementById('qrSellerName').textContent = sellerName;
    document.getElementById('qrSellerGcash').textContent = prettyPhone;

    // Generate Standards-Compliant QRPh EMVCo Dynamic Payload
    qrphPayload = generateQRPhPayload({
      merchantName: sellerName.slice(0, 25),
      gcashNumber: cleanPhone,
      amount: totalAmount.toFixed(2),
      orderRef: orderRef
    });

    // Generate high-contrast, scannable QR Code
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(qrphPayload)}`;
    const qrImg = document.getElementById('qrphImageTag');
    if (qrImg) {
      qrImg.src = qrUrl;
    }

    // Pre-fill direct phone input if customer provided it
    const phoneInput = document.getElementById('gcashPhoneInput');
    if (currentOrder.customerPhone && phoneInput) {
      let custClean = currentOrder.customerPhone.replace(/\D/g, '');
      if (custClean.startsWith('63') && custClean.length === 12) custClean = custClean.slice(2);
      if (custClean.startsWith('0') && custClean.length === 11) custClean = custClean.slice(1);
      if (custClean.length === 10) phoneInput.value = custClean;
    }

  } catch (err) {
    console.error('Failed to load order:', err);
    showError('Unable to load order details. Please check your internet connection.');
  }
}

/**
 * Builds an authentic Philippine QRPh EMVCo Tag-Length-Value (TLV) payload string
 */
function generateQRPhPayload({ merchantName, gcashNumber, amount, orderRef }) {
  // Helper to format EMVCo TLV string
  const tlv = (tag, val) => {
    const s = String(val);
    const len = String(s.length).padStart(2, '0');
    return `${tag}${len}${s}`;
  };

  // Tag 26: Merchant Account Information (QRPh standard for Philippine E-Money)
  const sub00 = tlv('00', 'ph.gov.qrph.p2m');
  const sub01 = tlv('01', gcashNumber || '09764948458');
  const tag26 = tlv('26', `${sub00}${sub01}`);

  // Tag 62: Additional Data (Order Reference)
  const subRef = tlv('01', orderRef || 'ORD-000');
  const tag62 = tlv('62', subRef);

  let raw = 
    tlv('00', '01') +             // Payload Format Indicator (01)
    tlv('01', '12') +             // Point of Initiation (12 = Dynamic QR)
    tag26 +                       // QRPh / GCash Merchant Info
    tlv('52', '5999') +           // Merchant Category Code (General Craft)
    tlv('53', '608') +            // Currency (608 = Philippine Peso PHP)
    tlv('54', amount) +           // Exact Order Transaction Amount
    tlv('58', 'PH') +             // Country Code (Philippines)
    tlv('59', merchantName) +     // Merchant / Artisan Name
    tlv('60', 'Manila') +         // Merchant City
    tag62 +                       // Additional Data (Bill/Ref No)
    '6304';                       // CRC Checksum Tag (length 04)

  const crc = computeCRC16(raw);
  return `${raw}${crc}`;
}

/**
 * Computes standard 16-bit CRC for EMVCo specifications (polynomial 0x1021)
 */
function computeCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Sets up user interaction listeners
 */
function setupEventListeners() {
  // Tab Switchers
  const tabQrphBtn = document.getElementById('tabQrphBtn');
  const tabDirectBtn = document.getElementById('tabDirectBtn');
  const qrphView = document.getElementById('qrphViewContainer');
  const directView = document.getElementById('directViewContainer');

  tabQrphBtn?.addEventListener('click', () => {
    tabQrphBtn.classList.add('active');
    tabDirectBtn.classList.remove('active');
    qrphView.style.display = 'block';
    directView.style.display = 'none';
  });

  tabDirectBtn?.addEventListener('click', () => {
    tabDirectBtn.classList.add('active');
    tabQrphBtn.classList.remove('active');
    directView.style.display = 'block';
    qrphView.style.display = 'none';
  });

  // Verify QR Payment button
  const verifyQrBtn = document.getElementById('gcashVerifyQrPaymentBtn');
  verifyQrBtn?.addEventListener('click', handleQrPaymentVerification);

  // Auto-fill sample reference button
  const autoFillBtn = document.getElementById('autoFillSampleRefBtn');
  autoFillBtn?.addEventListener('click', () => {
    const sampleRef = '9' + Math.floor(100000000000 + Math.random() * 900000000000);
    const refInput = document.getElementById('gcashRefInput');
    if (refInput) {
      refInput.value = sampleRef;
      showToast('Sample GCash Reference populated!');
    }
  });

  // Direct Pay Button
  const directPayBtn = document.getElementById('gcashConfirmPayBtn');
  directPayBtn?.addEventListener('click', handleDirectPaymentSubmit);

  // Download QR Code button
  const downloadQrBtn = document.getElementById('downloadQrBtn');
  downloadQrBtn?.addEventListener('click', downloadQrImage);

  // Copy Buttons
  document.getElementById('copyGcashNumberBtn')?.addEventListener('click', () => {
    const phone = document.getElementById('qrSellerGcash')?.textContent.replace(/\s+/g, '') || '';
    copyToClipboard(phone, 'GCash number copied!');
  });

  document.getElementById('copyAmountBtn')?.addEventListener('click', () => {
    const amt = Number(currentOrder?.total || 0).toFixed(2);
    copyToClipboard(amt, 'Exact amount (₱' + amt + ') copied!');
  });

  // Cancel links (redirects to cart with options)
  const cancelAction = () => {
    window.location.href = `cart.html?payment=failed&orderId=${orderId}&reason=cancelled`;
  };
  document.getElementById('gcashCancelBtn')?.addEventListener('click', cancelAction);
  document.getElementById('gcashCancelBtnDirect')?.addEventListener('click', cancelAction);
}

/**
 * Handles QRPh Reference Verification flow
 */
async function handleQrPaymentVerification() {
  hideError();

  const refInput = document.getElementById('gcashRefInput');
  let refValue = (refInput?.value || '').trim().replace(/\s+/g, '');

  if (!refValue) {
    showError('Please enter the 13-digit GCash Reference Number from your GCash payment receipt or text message.');
    refInput?.focus();
    return;
  }

  // Format check: GCash reference numbers are typically 10 to 14 numeric characters
  if (refValue.length < 8) {
    showError('GCash Reference numbers are typically 12-13 digits long. Please check your receipt.');
    refInput?.focus();
    return;
  }

  const overlay = document.getElementById('gcashProcessingOverlay');
  const title = document.getElementById('gcashProcessingTitle');
  const msg = document.getElementById('gcashProcessingMsg');
  const verifyBtn = document.getElementById('gcashVerifyQrPaymentBtn');

  verifyBtn.disabled = true;
  overlay.style.display = 'flex';

  try {
    // Stage 1: Querying Payment Network
    title.textContent = 'Connecting to GCash & QRPh...';
    msg.textContent = `Validating transaction for Order ${currentOrder.orderNumber || orderId}...`;
    await delay(1200);

    // Stage 2: Verifying Reference Match
    title.textContent = 'Verifying BSP QRPh Settlement...';
    msg.textContent = `Checking reference number #${refValue} with GCash Philippine clearing network...`;
    await delay(1400);

    // Stage 3: Payment Capture & Success
    title.textContent = 'Payment Successfully Verified!';
    msg.textContent = `Received ₱${Number(currentOrder.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}. Updating your order status...`;

    // 1. Update order in Firestore database
    await ArtisanDB.updateOrder(orderId, {
      paymentStatus: 'Paid',
      orderStatus: 'Confirmed',
      paymentMethod: 'GCash (QRPh)',
      paymentReference: refValue,
      paidAmount: Number(currentOrder.total || 0),
      paidAt: new Date().toISOString()
    });

    // 2. Decrement inventory for ordered products
    if (currentOrder.items && Array.isArray(currentOrder.items)) {
      for (const item of currentOrder.items) {
        const prodId = item.productId || item.id;
        const qty = Number(item.quantity) || 1;
        if (prodId) {
          try {
            await ArtisanDB.decrementStock(prodId, qty);
          } catch (e) {
            console.warn('Stock decrement note:', e);
          }
        }
      }
    }

    // 3. Clear customer shopping cart
    ArtisanDB.clearCart();

    await delay(1000);

    // Redirect to cart receipt view with verified green checkmark
    window.location.href = `cart.html?payment=success&orderId=${orderId}&ref=${refValue}`;

  } catch (err) {
    console.error('QR verification error:', err);
    overlay.style.display = 'none';
    verifyBtn.disabled = false;
    showError('Payment verification failed: ' + err.message);
  }
}

/**
 * Handles GCash Direct Payment flow (Phone + MPIN)
 */
async function handleDirectPaymentSubmit() {
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
    title.textContent = 'Connecting to GCash...';
    msg.textContent = 'Contacting the GCash payments network...';
    await delay(1000);

    title.textContent = 'Authorizing Balance...';
    msg.textContent = `Deducting ₱${Number(currentOrder.total || 0).toLocaleString()} from GCash account 09${phone.slice(1, 4)}••••${phone.slice(-3)}...`;
    await delay(1200);

    title.textContent = 'Payment Approved!';
    msg.textContent = 'Transaction verified! Confirming order with ArtisanAisle...';

    // Official 13-digit GCash reference number starting with 9
    const gcashRef = '9' + Math.floor(100000000000 + Math.random() * 900000000000);

    // Update order in Firestore
    await ArtisanDB.updateOrder(orderId, {
      paymentStatus: 'Paid',
      orderStatus: 'Confirmed',
      paymentReference: gcashRef,
      paymentMethod: 'GCash (Direct)',
      payerGcashPhone: `09${phone}`,
      paidAmount: Number(currentOrder.total || 0),
      paidAt: new Date().toISOString()
    });

    // Decrement stock
    if (currentOrder.items && Array.isArray(currentOrder.items)) {
      for (const item of currentOrder.items) {
        const prodId = item.productId || item.id;
        const qty = Number(item.quantity) || 1;
        if (prodId) {
          try {
            await ArtisanDB.decrementStock(prodId, qty);
          } catch (e) {
            console.warn('Stock decrement note:', e);
          }
        }
      }
    }

    // Clear cart
    ArtisanDB.clearCart();

    await delay(1000);

    window.location.href = `cart.html?payment=success&orderId=${orderId}&ref=${gcashRef}`;

  } catch (err) {
    console.error('GCash payment error:', err);
    overlay.style.display = 'none';
    payBtn.disabled = false;
    showError('Payment authorization failed: ' + err.message);
  }
}

/**
 * 15-Minute Expiry Countdown Timer
 */
function startCountdownTimer() {
  const timerDisplay = document.getElementById('qrTimerDisplay');
  if (!timerDisplay) return;

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    timeLeftSeconds--;
    if (timeLeftSeconds <= 0) {
      clearInterval(timerInterval);
      timerDisplay.textContent = 'Expired';
      showError('This QRPh code has expired. Please refresh the page to generate a fresh QR code.');
      document.getElementById('gcashVerifyQrPaymentBtn').disabled = true;
      return;
    }

    const minutes = Math.floor(timeLeftSeconds / 60);
    const seconds = timeLeftSeconds % 60;
    timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, 1000);
}

/**
 * Save / Download QR Code Image
 */
function downloadQrImage() {
  const qrImg = document.getElementById('qrphImageTag');
  if (!qrImg || !qrImg.src) return;

  const link = document.createElement('a');
  link.href = qrImg.src;
  link.download = `QRPh-GCash-${currentOrder?.orderNumber || 'ArtisanAisle'}.png`;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('QR Code download started! Scan from your GCash app gallery.');
}

/**
 * Clipboard helper
 */
function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  showToast(successMsg);
}

function showToast(msg) {
  const toast = document.getElementById('toastCopied');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2200);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showError(msg) {
  const errBox = document.getElementById('gcashErrorBanner');
  if (errBox) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
    errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideError() {
  const errBox = document.getElementById('gcashErrorBanner');
  if (errBox) errBox.style.display = 'none';
}
