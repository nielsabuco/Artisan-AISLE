import { ArtisanDB } from './firebase-config.js';
import { exportToExcel, exportToWord } from './export-utils.js';

let currentAdmin = null;
let allSellers = [];
let allOrders = [];
let allUsers = [];
let allPayoutRecords = [];
let selectedSellerId = null;
let currentFilterMode = 'all'; // 'all' | 'pending' | 'settled'

document.addEventListener('DOMContentLoaded', () => {
  initAdminAuth();
  setupUIEventListeners();
});

function initAdminAuth() {
  ArtisanDB.onAuth(async (user) => {
    const accessDenied = document.getElementById('adminAccessDeniedCard');
    const mainContent = document.getElementById('adminPayoutConsoleContent');

    if (!user) {
      if (accessDenied) accessDenied.style.display = 'block';
      if (mainContent) mainContent.style.display = 'none';
      return;
    }

    const isAdmin = String(user.role || '').toLowerCase() === 'admin' ||
                    (ArtisanDB.isEmailAdmin && ArtisanDB.isEmailAdmin(user.email));

    if (!isAdmin) {
      if (accessDenied) accessDenied.style.display = 'block';
      if (mainContent) mainContent.style.display = 'none';
      return;
    }

    currentAdmin = user;
    if (accessDenied) accessDenied.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';

    subscribeRealtimeData();
  });
}

function subscribeRealtimeData() {
  // 1. Subscribe to approved sellers
  ArtisanDB.subscribeSellers((sellers) => {
    allSellers = sellers || [];
    renderSellerDropdown();
    if (selectedSellerId) {
      renderSelectedSellerView();
    }
  });

  // 2. Subscribe to orders
  ArtisanDB.subscribeOrders((orders) => {
    allOrders = orders || [];
    renderSellerDropdown();
    if (selectedSellerId) {
      renderSelectedSellerView();
    }
  });

  // 3. Subscribe to users
  ArtisanDB.subscribeUsers((users) => {
    allUsers = users || [];
    renderSellerDropdown();
    if (selectedSellerId) {
      renderSelectedSellerView();
    }
  });

  // 4. Subscribe to all payouts
  if (typeof ArtisanDB.subscribeAllPayouts === 'function') {
    ArtisanDB.subscribeAllPayouts((records) => {
      allPayoutRecords = records || [];
      renderSellerDropdown();
      if (selectedSellerId) {
        renderSelectedSellerView();
      }
    });
  }
}

function computeSellerFinancials(sellerId) {
  const seller = allSellers.find(s => s.id === sellerId || s.uid === sellerId);
  const sellerUser = allUsers.find(u => u.uid === sellerId || u.id === sellerId);

  const shopName = seller?.shopName || sellerUser?.shopName || 'Artisan Workshop';
  const artisanName = seller?.name || sellerUser?.name || 'Verified Artisan';
  const gcashName = seller?.gcashName || sellerUser?.name || artisanName;
  const gcashNumber = seller?.gcashNumber || seller?.phone || sellerUser?.phone || '-';

  const relevantOrders = [];
  let grossSales = 0;

  allOrders.forEach(o => {
    let orderSellerMatch = false;
    let orderSellerGross = 0;
    const itemsMatched = [];

    if (Array.isArray(o.items) && o.items.length > 0) {
      o.items.forEach(it => {
        const itemSellerId = it.sellerId || (o.sellerIds && o.sellerIds[0]);
        if (itemSellerId === sellerId || (it.sellerName && (it.sellerName === artisanName || it.sellerName === shopName))) {
          orderSellerMatch = true;
          const itemTotal = Number(it.price || 0) * Number(it.quantity || 1);
          orderSellerGross += itemTotal;
          itemsMatched.push({
            name: it.title || it.name || it.productName || 'Artisan Craft',
            price: Number(it.price || 0),
            quantity: Number(it.quantity || 1),
            total: itemTotal
          });
        }
      });
    } else {
      const oSellerId = (o.sellerIds && o.sellerIds[0]);
      if (oSellerId === sellerId) {
        orderSellerMatch = true;
        orderSellerGross += Number(o.total || 0);
        itemsMatched.push({
          name: o.itemsDescription || 'Handcrafted Order',
          price: Number(o.total || 0),
          quantity: 1,
          total: Number(o.total || 0)
        });
      }
    }

    if (orderSellerMatch) {
      grossSales += orderSellerGross;
      const orderGatewayFee = Math.round(orderSellerGross * 0.02 * 100) / 100;
      const orderMaintFee = Math.round(orderSellerGross * 0.13 * 100) / 100;
      const orderTotalFee = Math.round(orderSellerGross * 0.15 * 100) / 100;
      const orderNetSalary = Math.round((orderSellerGross - orderTotalFee) * 100) / 100;

      // Check disbursement status for this order
      const isTaggedDisbursed = o.disbursements && o.disbursements[sellerId]?.status === 'Disbursed';
      const isLumpDisbursed = allPayoutRecords.some(p => 
        p.sellerId === sellerId && 
        p.status === 'Disbursed' && 
        Array.isArray(p.orderIds) && 
        (p.orderIds.includes(o.id) || p.orderIds.includes(o.orderNumber))
      );

      const isDisbursed = isTaggedDisbursed || isLumpDisbursed;
      const refNumber = o.disbursements?.[sellerId]?.referenceNumber || 
                        allPayoutRecords.find(p => p.sellerId === sellerId && Array.isArray(p.orderIds) && p.orderIds.includes(o.id))?.referenceNumber || '';

      relevantOrders.push({
        id: o.id,
        orderNumber: o.orderNumber || o.id,
        createdAt: o.createdAt,
        customerName: o.customerName || o.shippingAddress?.fullName || 'Customer',
        paymentMethod: o.paymentMethod || 'GCash',
        orderStatus: o.orderStatus || 'Completed',
        items: itemsMatched,
        gross: orderSellerGross,
        gatewayFee: orderGatewayFee,
        maintFee: orderMaintFee,
        totalFee: orderTotalFee,
        netSalary: orderNetSalary,
        isDisbursed,
        referenceNumber: refNumber
      });
    }
  });

  const gatewayFee = Math.round(grossSales * 0.02 * 100) / 100;
  const maintenanceFee = Math.round(grossSales * 0.13 * 100) / 100;
  const totalFees = Math.round(grossSales * 0.15 * 100) / 100;
  const lifetimeNetSalary = Math.round((grossSales - totalFees) * 100) / 100;

  // Calculate already disbursed from seller_payouts
  const sellerPayouts = allPayoutRecords.filter(p => p.sellerId === sellerId && p.status === 'Disbursed');
  const alreadyDisbursed = sellerPayouts.reduce((sum, p) => sum + Number(p.netSalary || p.amount || 0), 0);

  // Pending orders (not yet tagged as disbursed)
  const pendingOrders = relevantOrders.filter(o => !o.isDisbursed && o.gross > 0);
  const pendingNetSalary = pendingOrders.reduce((sum, o) => sum + o.netSalary, 0);

  return {
    seller,
    sellerUser,
    shopName,
    artisanName,
    gcashName,
    gcashNumber,
    email: seller?.email || sellerUser?.email || '',
    phone: seller?.phone || sellerUser?.phone || '',
    category: seller?.category || 'Handcraft Specialization',
    region: seller?.region || 'Philippines',
    photo: seller?.photoURL || seller?.avatar || sellerUser?.avatar || '',
    grossSales,
    gatewayFee,
    maintenanceFee,
    totalFees,
    lifetimeNetSalary,
    alreadyDisbursed,
    pendingNetSalary: Math.max(0, Math.round(pendingNetSalary * 100) / 100),
    orders: relevantOrders,
    pendingOrders,
    payoutHistory: sellerPayouts
  };
}

function renderSellerDropdown() {
  const select = document.getElementById('sellerSelectDropdown');
  if (!select) return;

  const currentVal = select.value || selectedSellerId;
  const searchVal = (document.getElementById('sellerSearchInput')?.value || '').toLowerCase().trim();

  // Compute for all sellers
  const sellerCards = allSellers.map(s => {
    const fin = computeSellerFinancials(s.id);
    return {
      id: s.id,
      shopName: fin.shopName,
      artisanName: fin.artisanName,
      phone: fin.phone,
      pendingNetSalary: fin.pendingNetSalary,
      grossSales: fin.grossSales
    };
  });

  // Filter counts
  const countAll = sellerCards.length;
  const countPending = sellerCards.filter(s => s.pendingNetSalary > 0).length;
  const countSettled = sellerCards.filter(s => s.pendingNetSalary === 0).length;

  const elAll = document.getElementById('countFilterAll');
  const elPending = document.getElementById('countFilterPending');
  const elSettled = document.getElementById('countFilterSettled');
  const elSummary = document.getElementById('sellerCountSummary');

  if (elAll) elAll.textContent = countAll;
  if (elPending) elPending.textContent = countPending;
  if (elSettled) elSettled.textContent = countSettled;
  if (elSummary) elSummary.textContent = `${countPending} Artisan(s) with pending GCash payout`;

  // Apply current filter mode
  let filtered = sellerCards;
  if (currentFilterMode === 'pending') {
    filtered = filtered.filter(s => s.pendingNetSalary > 0);
  } else if (currentFilterMode === 'settled') {
    filtered = filtered.filter(s => s.pendingNetSalary === 0);
  }

  // Apply search query
  if (searchVal) {
    filtered = filtered.filter(s => 
      s.shopName.toLowerCase().includes(searchVal) ||
      s.artisanName.toLowerCase().includes(searchVal) ||
      (s.phone && s.phone.includes(searchVal))
    );
  }

  select.innerHTML = '<option value="">-- Choose an Artisan / Shop --</option>';

  filtered.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    const pendingTag = s.pendingNetSalary > 0 
      ? `[⚡ PENDING: ₱${s.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}]`
      : `[✓ Fully Settled]`;
    opt.textContent = `${s.shopName} (${s.artisanName}) — ${pendingTag}`;
    if (s.id === currentVal) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  if (currentVal && allSellers.some(s => s.id === currentVal)) {
    selectedSellerId = currentVal;
  }
}

function renderSelectedSellerView() {
  const noSeller = document.getElementById('noSellerSelectedState');
  const detailContainer = document.getElementById('activeSellerDetailContainer');

  if (!selectedSellerId) {
    if (noSeller) noSeller.style.display = 'block';
    if (detailContainer) detailContainer.style.display = 'none';
    return;
  }

  const fin = computeSellerFinancials(selectedSellerId);

  if (noSeller) noSeller.style.display = 'none';
  if (detailContainer) detailContainer.style.display = 'block';

  // 1. Populate Seller Banner & Profile
  document.getElementById('sellerDisplayShopName').textContent = fin.shopName;
  document.getElementById('sellerDisplayArtisanName').textContent = `Crafted by ${fin.artisanName}`;
  document.getElementById('sellerCategoryTag').textContent = `🧵 ${fin.category}`;
  document.getElementById('sellerRegionTag').textContent = `📍 ${fin.region}`;
  document.getElementById('sellerEmailTag').textContent = `✉️ ${fin.email || 'N/A'}`;
  document.getElementById('sellerPhoneTag').textContent = `📞 ${fin.phone || 'N/A'}`;

  // Avatar
  const avatarWrap = document.getElementById('artisanAvatarWrap');
  if (avatarWrap) {
    if (fin.photo) {
      avatarWrap.innerHTML = `<img src="${fin.photo}" alt="${fin.artisanName}">`;
    } else {
      avatarWrap.innerHTML = `<span>🇵🇭</span>`;
    }
  }

  // 2. GCash Account Box
  document.getElementById('sellerGcashName').textContent = fin.gcashName;
  document.getElementById('sellerGcashNumber').textContent = fin.gcashNumber;

  // 3. Metrics Cards
  document.getElementById('metricGrossSales').textContent = `₱${fin.grossSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricGatewayFee').textContent = `-₱${fin.gatewayFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricMaintFee').textContent = `-₱${fin.maintenanceFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricTotalFees').textContent = `-₱${fin.totalFees.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricLifetimeNet').textContent = `₱${fin.lifetimeNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricAlreadyDisbursed').textContent = `₱${fin.alreadyDisbursed.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricPendingSalary').textContent = `₱${fin.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  // 4. One-Go Action Button
  const disburseBtn = document.getElementById('disburseInOneGoBtn');
  const disburseBtnText = document.getElementById('disburseBtnText');
  if (disburseBtn && disburseBtnText) {
    if (fin.pendingNetSalary > 0) {
      disburseBtn.disabled = false;
      disburseBtnText.textContent = `Disburse ₱${fin.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })} Net Salary in One Go via GCash`;
    } else {
      disburseBtn.disabled = true;
      disburseBtnText.textContent = `All Salaries Fully Disbursed (₱0.00 Pending)`;
    }
  }

  // 5. Render Orders & Sales Table
  renderOrdersTable(fin.orders);

  // 6. Render Payout History Table
  renderPayoutHistoryTable(fin.payoutHistory);
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('sellerOrdersTableBody');
  if (!tbody) return;

  if (!orders || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="loading-td" style="color:#64748b; padding:30px;">No customer purchases on record for this artisan yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  // Sort latest first
  const sorted = [...orders].sort((a, b) => {
    const da = a.createdAt?.seconds ? a.createdAt.seconds : 0;
    const db = b.createdAt?.seconds ? b.createdAt.seconds : 0;
    return db - da;
  });

  sorted.forEach(o => {
    const tr = document.createElement('tr');
    const dateStr = o.createdAt?.seconds 
      ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
      : (o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '-');

    const itemsSummary = o.items.map(it => `${it.quantity}x ${it.name}`).join(', ');

    const statusBadge = o.isDisbursed
      ? `<span class="status-badge delivered" style="font-size:11px;">✓ Disbursed via GCash</span><br><small style="color:#666; font-family:monospace;">Ref: ${o.referenceNumber || '-'}</small>`
      : `<span class="status-badge processing" style="font-size:11px; background:#fef3c7; color:#92400e;">⚡ Pending Disbursement</span>`;

    tr.innerHTML = `
      <td><strong>${o.orderNumber}</strong><br><small style="color:#64748b;">${o.customerName}</small></td>
      <td><small>${dateStr}</small></td>
      <td style="max-width: 220px; font-size:12.5px;">${itemsSummary}</td>
      <td><strong>₱${o.gross.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
      <td style="color:#b45309;">-₱${o.gatewayFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#4338ca;">-₱${o.maintFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#dc2626; font-weight:600;">-₱${o.totalFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#15803d; font-weight:bold; font-size:13.5px;">₱${o.netSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td><span class="status-badge" style="font-size:10.5px; background:#f1f5f9; color:#334155;">${o.paymentMethod}</span></td>
      <td><span class="status-badge" style="font-size:10.5px;">${o.orderStatus}</span></td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPayoutHistoryTable(payouts) {
  const tbody = document.getElementById('sellerDisbursementsTableBody');
  if (!tbody) return;

  if (!payouts || payouts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-td" style="color:#64748b; padding:24px;">No previous GCash salary disbursements recorded for this artisan.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  // Sort latest first
  const sorted = [...payouts].sort((a, b) => {
    const da = a.disbursedAt?.seconds || 0;
    const db = b.disbursedAt?.seconds || 0;
    return db - da;
  });

  sorted.forEach(p => {
    const tr = document.createElement('tr');
    const dateStr = p.disbursedAt?.seconds 
      ? new Date(p.disbursedAt.seconds * 1000).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' })
      : (p.disbursedAt ? new Date(p.disbursedAt).toLocaleString() : '-');

    const ordersSettledCount = Array.isArray(p.orderIds) ? p.orderIds.length : (p.orderCount || 1);
    const grossDisplay = p.grossSales ? `₱${Number(p.grossSales).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-';
    const netDisplay = `₱${Number(p.netSalary || p.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    tr.innerHTML = `
      <td><code style="font-size:11.5px; color:#0f172a;">${p.id}</code></td>
      <td><small>${dateStr}</small></td>
      <td style="color:#15803d; font-weight:800; font-size:14px;">${netDisplay}</td>
      <td>${grossDisplay}</td>
      <td><span class="status-badge" style="background:#e0f2fe; color:#0369a1; font-size:11px;">${ordersSettledCount} order(s)</span></td>
      <td><strong style="font-family:monospace; color:#005ce6; font-size:13px;">${p.referenceNumber || '-'}</strong></td>
      <td><small style="color:#475569;">${p.disbursedBy || 'Admin'}</small></td>
      <td style="font-size:12px; color:#64748b; max-width:200px;">${p.notes || 'GCash Express Send'}</td>
      <td><span class="status-badge delivered" style="font-size:11px;">✓ Disbursed</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function setupUIEventListeners() {
  // Dropdown Change
  const dropdown = document.getElementById('sellerSelectDropdown');
  dropdown?.addEventListener('change', (e) => {
    selectedSellerId = e.target.value;
    renderSelectedSellerView();
  });

  // Search Input
  const searchInput = document.getElementById('sellerSearchInput');
  searchInput?.addEventListener('input', () => {
    renderSellerDropdown();
  });

  // Filter Chips
  const chips = document.querySelectorAll('.seller-chip-btn');
  chips.forEach(btn => {
    btn.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentFilterMode = btn.dataset.filter || 'all';
      renderSellerDropdown();
    });
  });

  // Copy GCash Number
  document.getElementById('copyGcashBtn')?.addEventListener('click', () => {
    const num = document.getElementById('sellerGcashNumber')?.textContent;
    if (num && num !== '-') {
      navigator.clipboard.writeText(num.replace(/[^0-9]/g, ''));
      alert(`GCash mobile number "${num}" copied to clipboard!`);
    }
  });

  document.getElementById('modalCopyGcashBtn')?.addEventListener('click', () => {
    const num = document.getElementById('sellerGcashNumber')?.textContent;
    if (num && num !== '-') {
      navigator.clipboard.writeText(num.replace(/[^0-9]/g, ''));
      alert(`GCash number "${num}" copied to clipboard!`);
    }
  });

  // Open One-Go Modal
  document.getElementById('disburseInOneGoBtn')?.addEventListener('click', () => {
    if (!selectedSellerId) return;
    const fin = computeSellerFinancials(selectedSellerId);
    if (fin.pendingNetSalary <= 0) {
      alert('This artisan does not have any pending salary balance to disburse.');
      return;
    }
    openOneGoDisburseModal(fin);
  });

  // Close Modal
  document.getElementById('closeOneGoModalBtn')?.addEventListener('click', closeOneGoDisburseModal);
  document.getElementById('cancelOneGoModalBtn')?.addEventListener('click', closeOneGoDisburseModal);

  // Logout
  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    if (confirm('Log out of Artisan Aisle Admin Console?')) {
      await ArtisanDB.logout();
      window.location.href = 'login.html';
    }
  });

  // Export Sales Excel & Word
  document.getElementById('exportSellerSalesExcelBtn')?.addEventListener('click', exportSellerSalesExcel);
  document.getElementById('exportSellerSalesWordBtn')?.addEventListener('click', exportSellerSalesWord);
  document.getElementById('exportDisbursementHistoryExcelBtn')?.addEventListener('click', exportDisbursementHistoryExcel);
}

function openOneGoDisburseModal(fin) {
  const modal = document.getElementById('oneGoDisburseModal');
  if (!modal) return;

  document.getElementById('modalShopName').textContent = fin.shopName;
  document.getElementById('modalArtisanName').textContent = fin.artisanName;
  document.getElementById('modalGcashAccount').textContent = `${fin.gcashName} • ${fin.gcashNumber}`;
  document.getElementById('modalOrdersCount').textContent = `${fin.pendingOrders.length} pending orders`;
  
  const pendingGross = fin.pendingOrders.reduce((sum, o) => sum + o.gross, 0);
  document.getElementById('modalGrossTotal').textContent = `₱${pendingGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('modalNetSalaryDisplay').textContent = `₱${fin.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  document.getElementById('modalGcashRefInput').value = '';
  document.getElementById('modalDisburseNotesInput').value = `Total net salary settlement for ${fin.pendingOrders.length} orders via GCash Express Send`;

  modal.style.display = 'flex';
  document.getElementById('modalGcashRefInput').focus();
}

function closeOneGoDisburseModal() {
  const modal = document.getElementById('oneGoDisburseModal');
  if (modal) modal.style.display = 'none';
}

window.handleConfirmOneGoDisbursement = async function(event) {
  event.preventDefault();
  if (!selectedSellerId) return;

  const fin = computeSellerFinancials(selectedSellerId);
  const refNumber = document.getElementById('modalGcashRefInput').value.trim();
  const notes = document.getElementById('modalDisburseNotesInput').value.trim();
  const submitBtn = document.getElementById('submitOneGoDisburseBtn');

  if (!refNumber) {
    alert('Please enter the GCash Transaction / Reference Number from your GCash receipt.');
    return;
  }

  if (fin.pendingNetSalary <= 0) {
    alert('There is no outstanding balance to disburse.');
    return;
  }

  const orderIds = fin.pendingOrders.map(o => o.id);
  const orderNumbers = fin.pendingOrders.map(o => o.orderNumber);
  const pendingGross = fin.pendingOrders.reduce((sum, o) => sum + o.gross, 0);
  const pendingFees = fin.pendingOrders.reduce((sum, o) => sum + o.totalFee, 0);
  const pendingGateway = fin.pendingOrders.reduce((sum, o) => sum + o.gatewayFee, 0);
  const pendingMaint = fin.pendingOrders.reduce((sum, o) => sum + o.maintFee, 0);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Recording GCash Settlement...';

  try {
    await ArtisanDB.disburseSellerTotalNetSalary(selectedSellerId, {
      netSalary: fin.pendingNetSalary,
      grossSales: pendingGross,
      platformFees: pendingFees,
      gatewayFee: pendingGateway,
      maintenanceFee: pendingMaint,
      orderIds,
      orderNumbers,
      referenceNumber: refNumber,
      notes: notes || 'Total net salary settlement via GCash Express Send',
      adminEmail: currentAdmin?.email || 'Administrator',
      gcashName: fin.gcashName,
      gcashNumber: fin.gcashNumber,
      shopName: fin.shopName,
      artisanName: fin.artisanName
    });

    alert(`🎉 Success! GCash salary disbursement of ₱${fin.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })} has been recorded in one go! All ${orderIds.length} orders are marked as Disbursed.`);
    closeOneGoDisburseModal();
    renderSelectedSellerView();
    renderSellerDropdown();
  } catch (err) {
    console.error('Disbursement error:', err);
    alert('Failed to record disbursement: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm & Disburse via GCash →';
  }
};

function exportSellerSalesExcel() {
  if (!selectedSellerId) return;
  const fin = computeSellerFinancials(selectedSellerId);
  const cleanShop = fin.shopName.replace(/[^a-zA-Z0-9]/g, '_');

  const headers = [
    'Order Number', 'Date', 'Customer Name', 'Items Summary', 
    'Gross Total (PHP)', '2% Gateway Fee', '13% Website Fee', 'Total 15% Fees', 
    'Net Salary (85%)', 'Payment Method', 'Fulfillment Status', 'Disbursement Status', 'GCash Ref #'
  ];

  const rows = fin.orders.map(o => [
    o.orderNumber,
    o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('en-PH') : '-',
    o.customerName,
    o.items.map(it => `${it.quantity}x ${it.name}`).join('; '),
    o.gross.toFixed(2),
    o.gatewayFee.toFixed(2),
    o.maintFee.toFixed(2),
    o.totalFee.toFixed(2),
    o.netSalary.toFixed(2),
    o.paymentMethod,
    o.orderStatus,
    o.isDisbursed ? 'Disbursed' : 'Pending',
    o.referenceNumber || '-'
  ]);

  exportToExcel(`ArtisanAisle_${cleanShop}_Sales_Audit_${Date.now()}`, `${fin.shopName} - Sales Ledger & Net Salary Audit`, headers, rows);
}

function exportSellerSalesWord() {
  if (!selectedSellerId) return;
  const fin = computeSellerFinancials(selectedSellerId);
  const cleanShop = fin.shopName.replace(/[^a-zA-Z0-9]/g, '_');

  const headers = ['Order #', 'Date', 'Customer', 'Gross Sales', 'Fees (15%)', 'Net Salary (85%)', 'Status'];
  const rows = fin.orders.map(o => [
    o.orderNumber,
    o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000).toLocaleDateString('en-PH') : '-',
    o.customerName,
    `PHP ${o.gross.toFixed(2)}`,
    `-PHP ${o.totalFee.toFixed(2)}`,
    `PHP ${o.netSalary.toFixed(2)}`,
    o.isDisbursed ? `Disbursed (Ref: ${o.referenceNumber || '-'})` : 'Pending Disbursement'
  ]);

  const metadata = {
    'Report Title': 'Artisan Workshop Sales & Salary Disbursement Statement',
    'Shop Name': fin.shopName,
    'Master Artisan': fin.artisanName,
    'GCash Account': `${fin.gcashName} (${fin.gcashNumber})`,
    'Lifetime Gross Sales': `PHP ${fin.grossSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    'Total 15% Fees': `PHP ${fin.totalFees.toLocaleString('en-US', { minimumFractionDigits: 2 })} (2% Gateway, 13% Maintenance)`,
    'Total Net Salary (85%)': `PHP ${fin.lifetimeNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    'Already Disbursed': `PHP ${fin.alreadyDisbursed.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    'Pending Net Salary': `PHP ${fin.pendingNetSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    'Audited By': currentAdmin?.email || 'Platform Administrator'
  };

  exportToWord(`ArtisanAisle_${cleanShop}_SalaryStatement_${Date.now()}`, `${fin.shopName} - Formal Salary Disbursement Statement`, metadata, headers, rows);
}

function exportDisbursementHistoryExcel() {
  if (!selectedSellerId) return;
  const fin = computeSellerFinancials(selectedSellerId);
  const cleanShop = fin.shopName.replace(/[^a-zA-Z0-9]/g, '_');

  const headers = [
    'Disbursement ID', 'Date & Time', 'Net Salary Transferred (PHP)', 
    'Gross Volume Settled', 'Orders Settled', 'GCash Reference #', 
    'Disbursed By', 'Notes / Remarks', 'Status'
  ];

  const rows = fin.payoutHistory.map(p => [
    p.id,
    p.disbursedAt?.seconds ? new Date(p.disbursedAt.seconds * 1000).toLocaleString('en-PH') : '-',
    (Number(p.netSalary || p.amount || 0)).toFixed(2),
    p.grossSales ? Number(p.grossSales).toFixed(2) : '-',
    Array.isArray(p.orderIds) ? p.orderIds.length : (p.orderCount || 1),
    p.referenceNumber || '-',
    p.disbursedBy || 'Admin',
    p.notes || 'GCash Express Send',
    p.status || 'Disbursed'
  ]);

  exportToExcel(`ArtisanAisle_${cleanShop}_GCash_Disbursement_Ledger_${Date.now()}`, `${fin.shopName} - Official GCash Salary Disbursement Ledger`, headers, rows);
}

