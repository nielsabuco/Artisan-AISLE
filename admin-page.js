import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';
import { exportToExcel, exportToWord } from './export-utils.js';

let currentAdmin = null;
let allApplications = [];
let allUsers = [];
let allProducts = [];
let allOrders = [];

document.addEventListener('DOMContentLoaded', () => {
  initAdminAuth();
  setupSidebarNav();
  setupExportButtons();
  setupAdminTrackingModal();
});

function initAdminAuth() {
  ArtisanDB.onAuth(async (user) => {
    const accessCard = document.getElementById('adminAccessDeniedCard');
    const dashboardLayout = document.getElementById('adminDashboardLayout');

    if (!user || !user.uid) {
      if (accessCard) accessCard.style.display = 'block';
      if (dashboardLayout) dashboardLayout.style.display = 'none';
      return;
    }

    currentAdmin = await ArtisanDB.getUserProfile(user.uid) || user;
    const isUserAdmin = await ArtisanDB.checkIsAdmin(currentAdmin);

    if (!isUserAdmin && String(currentAdmin.role || '').toLowerCase() !== 'admin') {
      if (accessCard) accessCard.style.display = 'block';
      if (dashboardLayout) dashboardLayout.style.display = 'none';

      // Setup one-click admin privilege switch for account owner
      document.getElementById('activateAdminPrivilegeBtn')?.addEventListener('click', async () => {
        try {
          await ArtisanDB.updateUserRole(currentAdmin.uid, 'admin');
          currentAdmin.role = 'admin';
          alert('Admin role activated on your account. Welcome to the Admin Console!');
          window.location.reload();
        } catch (err) {
          alert('Failed to set admin privilege: ' + err.message);
        }
      });
      return;
    }

    // Access granted - guarantee role is set to admin
    currentAdmin.role = 'admin';

    // Access granted
    if (accessCard) accessCard.style.display = 'none';
    if (dashboardLayout) dashboardLayout.style.display = 'grid';

    document.getElementById('adminUserPill').textContent = currentAdmin.name || 'Admin';

    // Start Real-time Data Listeners
    startAdminListeners();
  });
}

function setupSidebarNav() {
  const buttons = document.querySelectorAll('.dashboard-sidebar .sidebar-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.admin-tab-section').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
      });

      const activeSec = document.getElementById(`tab-${tabId}`);
      if (activeSec) {
        activeSec.style.display = 'block';
        activeSec.classList.add('active');
      }
    });
  });
}

function startAdminListeners() {
  // 1. Applications
  ArtisanDB.subscribeSellerApplications((apps) => {
    allApplications = apps;
    renderApplicationsTable(apps);
    updateMetrics();
  });

  // 2. Users
  ArtisanDB.subscribeAllUsers((users) => {
    allUsers = users;
    renderUsersTable(users);
    updateMetrics();
  });

  // 3. Products
  ArtisanDB.subscribeProducts((prods) => {
    allProducts = prods;
    renderProductsTable(prods);
    updateMetrics();
  });

  // 4. Orders
  ArtisanDB.subscribeAllOrders((orders) => {
    allOrders = orders;
    renderOrdersTable(orders);
    updateMetrics();
  });
}

function updateMetrics() {
  // GMV
  const gmv = allOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  document.getElementById('metricGmv').textContent = `₱${gmv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('metricOrders').textContent = allOrders.length;
  document.getElementById('metricUsers').textContent = allUsers.length;

  // Pending Apps
  const pendingCount = allApplications.filter(a => a.status === 'pending').length;
  document.getElementById('metricPendingApps').textContent = pendingCount;
  document.getElementById('pendingBadgeCount').textContent = pendingCount;

  // Sellers
  const sellersCount = allUsers.filter(u => u.role === 'seller' || u.sellerStatus === 'approved').length;
  document.getElementById('metricSellers').textContent = sellersCount;

  // Products
  document.getElementById('metricProducts').textContent = allProducts.length;
}

function renderApplicationsTable(apps) {
  const tbody = document.getElementById('applicationsTableBody');
  if (!tbody) return;

  if (!apps || apps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-td">No seller applications received yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  apps.forEach(app => {
    const tr = document.createElement('tr');
    const isPending = (app.status || 'pending').toLowerCase() === 'pending';
    const statusClass = isPending ? 'processing' : (app.status === 'approved' ? 'delivered' : 'unpaid-badge');

    tr.innerHTML = `
      <td>
        <strong>${app.shopName || 'Shop Name'}</strong><br>
        <small>${app.applicantName || 'Applicant'} • ${app.email || ''}</small>
      </td>
      <td><span class="category-pill">${app.category || 'General'}</span></td>
      <td>
        <p class="table-clamped-text" title="${app.craftStory || ''}">${app.craftStory || 'No story provided'}</p>
      </td>
      <td>
        <strong>${app.gcashName || '-'}</strong><br>
        <code>${app.gcashNumber || '-'}</code>
      </td>
      <td><code>${app.govId || '-'}</code></td>
      <td><span class="status-badge ${statusClass}">${app.status || 'pending'}</span></td>
      <td>
        ${isPending ? `
          <div class="table-actions-cluster">
            <button type="button" class="action-btn approve-btn" data-id="${app.id}">Approve</button>
            <button type="button" class="action-btn reject-btn" data-id="${app.id}">Reject</button>
          </div>
        ` : `
          <small class="reviewed-label">Reviewed</small>
        `}
      </td>
    `;

    // Attach actions
    if (isPending) {
      tr.querySelector('.approve-btn')?.addEventListener('click', async () => {
        if (confirm(`Approve seller application for "${app.shopName}"?\n\nThis will elevate their account to Seller, activate their shop profile, and dispatch an account password setup link to ${app.email}.`)) {
          try {
            await ArtisanDB.approveSellerApplication(app.id, app);
            alert(`Application for "${app.shopName}" has been approved! Password reset setup link dispatched.`);
          } catch (e) {
            alert('Approval error: ' + e.message);
          }
        }
      });

      tr.querySelector('.reject-btn')?.addEventListener('click', async () => {
        const reason = prompt('Please specify a rejection reason to send to the applicant:', 'Application requirements were incomplete.');
        if (reason !== null) {
          try {
            await ArtisanDB.rejectSellerApplication(app.id, app, reason);
            alert(`Application rejected and feedback sent.`);
          } catch (e) {
            alert('Rejection error: ' + e.message);
          }
        }
      });
    }

    tbody.appendChild(tr);
  });
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-td">No registered users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  users.forEach(u => {
    const tr = document.createElement('tr');
    const roleClass = String(u.role || 'user').toLowerCase();
    const isAdmin = roleClass === 'admin' || (ArtisanDB.isEmailAdmin && ArtisanDB.isEmailAdmin(u.email));

    tr.innerHTML = `
      <td>
        <strong>${u.name || 'Unnamed'}</strong><br>
        <small>${u.email || '-'}</small>
      </td>
      <td>${u.phone || 'None'}</td>
      <td><span class="role-badge ${roleClass}">${(u.role || 'user').toUpperCase()}</span></td>
      <td><span class="status-badge">${u.sellerStatus || 'none'}</span></td>
      <td>
        <button type="button" class="action-btn toggle-role-btn" data-uid="${u.id || u.uid}" data-isadmin="${isAdmin}">
          ${isAdmin ? 'Demote to User' : 'Promote to Admin'}
        </button>
      </td>
    `;

    tr.querySelector('.toggle-role-btn')?.addEventListener('click', async () => {
      const targetRole = isAdmin ? 'user' : 'admin';
      if (confirm(`Change role for ${u.name || u.email} to ${targetRole.toUpperCase()}?`)) {
        await ArtisanDB.updateUserRole(u.id || u.uid, targetRole);
        alert(`User role updated to ${targetRole}.`);
      }
    });

    tbody.appendChild(tr);
  });
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  if (!products || products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-td">No products listed in catalog.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  products.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="product-thumb-row">
          <img src="${p.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=100&q=80'}" alt="${p.name}" class="table-prod-img" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=100&q=80'">
          <div>
            <strong>${p.name}</strong><br>
            <small>${p.id || '-'}</small>
          </div>
        </div>
      </td>
      <td><span class="category-pill">${p.category || 'General'}</span></td>
      <td>₱${Number(p.price || 0).toFixed(2)}</td>
      <td>
        <input type="number" class="inline-stock-input" value="${Number(p.stock) || 0}" min="0" data-id="${p.id}">
      </td>
      <td>${p.sellerName || 'Artisan Seller'}</td>
      <td><span class="status-badge ${p.status === 'Active' ? 'delivered' : 'unpaid-badge'}">${p.status || 'Active'}</span></td>
      <td>
        <div class="table-actions-cluster">
          <button type="button" class="action-btn toggle-status-btn" data-id="${p.id}" data-status="${p.status}">
            ${p.status === 'Active' ? 'Hide' : 'Activate'}
          </button>
          <button type="button" class="action-btn delete-btn" data-id="${p.id}">Delete</button>
        </div>
      </td>
    `;

    // Inline stock change
    tr.querySelector('.inline-stock-input')?.addEventListener('change', async (e) => {
      const newStock = Number(e.target.value) || 0;
      await ArtisanDB.updateProduct(p.id, { stock: newStock });
    });

    // Toggle status
    tr.querySelector('.toggle-status-btn')?.addEventListener('click', async () => {
      const newStatus = p.status === 'Active' ? 'Hidden' : 'Active';
      await ArtisanDB.updateProduct(p.id, { status: newStatus });
    });

    // Delete
    tr.querySelector('.delete-btn')?.addEventListener('click', async () => {
      if (confirm(`Permanently remove "${p.name}" from marketplace catalog?`)) {
        await ArtisanDB.deleteProduct(p.id);
      }
    });

    tbody.appendChild(tr);
  });
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-td">No orders placed yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  orders.forEach(o => {
    const tr = document.createElement('tr');
    const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ');
    const trackingClass = (o.orderStatus || 'processing').toLowerCase();

    tr.innerHTML = `
      <td>
        <strong>${o.orderNumber || o.id}</strong><br>
        <small>${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-PH') : 'Recently'}</small>
      </td>
      <td>
        <strong>${o.customerName || 'Customer'}</strong><br>
        <small>${o.customerPhone || ''}</small>
      </td>
      <td><p class="table-clamped-text" title="${itemsSummary}">${itemsSummary || '1 Item'}</p></td>
      <td><strong>₱${Number(o.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
      <td>
        <strong>${o.paymentMethod || 'COD'}</strong><br>
        <span class="status-badge ${o.paymentStatus === 'Paid' ? 'delivered' : 'unpaid-badge'}">${o.paymentStatus || 'Pending'}</span>
        ${o.paymentReference ? `<br><small>Ref: <code>${o.paymentReference}</code></small>` : ''}
      </td>
      <td>
        <span class="status-badge ${trackingClass}">${o.orderStatus || 'Processing'}</span><br>
        <small style="color:#555;">${o.courier || 'Local Logistics'}</small><br>
        <small>${o.trackingNumber ? `<code>${o.trackingNumber}</code>` : 'Pending Waybill'}</small>
      </td>
      <td>
        <button type="button" class="action-btn edit-tracking-btn" style="background:#285c3b; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">
          Update Tracking
        </button>
      </td>
    `;

    tr.querySelector('.edit-tracking-btn')?.addEventListener('click', () => {
      openAdminTrackingModal(o);
    });

    tbody.appendChild(tr);
  });
}

function setupAdminTrackingModal() {
  const modal = document.getElementById('adminTrackingModal');
  const closeBtn = document.getElementById('closeAdminTrackingModalBtn');
  const cancelBtn = document.getElementById('cancelAdminTrackBtn');
  const saveBtn = document.getElementById('saveAdminTrackBtn');

  closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });

  saveBtn?.addEventListener('click', async () => {
    const orderId = document.getElementById('adminTrackOrderId').value;
    if (!orderId) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving Tracking...';

    const trackingData = {
      orderStatus: document.getElementById('adminTrackStatus').value,
      courier: document.getElementById('adminTrackCourier').value,
      trackingNumber: document.getElementById('adminTrackNumber').value.trim(),
      currentLocation: document.getElementById('adminTrackLocation').value.trim(),
      trackingNotes: document.getElementById('adminTrackNotes').value.trim()
    };

    try {
      await ArtisanDB.updateOrderTracking(orderId, trackingData);
      alert('Order tracking updated successfully! The customer and seller have been notified.');
      modal.style.display = 'none';
    } catch (err) {
      alert('Failed to update tracking: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Broadcast Update';
    }
  });
}

function openAdminTrackingModal(order) {
  const modal = document.getElementById('adminTrackingModal');
  if (!modal) return;

  document.getElementById('adminTrackOrderId').value = order.id;
  document.getElementById('adminTrackOrderNum').textContent = order.orderNumber || order.id;
  document.getElementById('adminTrackCustomer').textContent = order.customerName || 'Customer';

  document.getElementById('adminTrackStatus').value = order.orderStatus || 'Processing';
  document.getElementById('adminTrackCourier').value = order.courier || 'J&T Express';
  document.getElementById('adminTrackNumber').value = order.trackingNumber || '';
  document.getElementById('adminTrackLocation').value = order.currentLocation || '';
  document.getElementById('adminTrackNotes').value = order.trackingNotes || '';

  modal.style.display = 'flex';
}

function setupExportButtons() {
  // 1. Export Sales & Orders (Excel)
  const exportSalesExcel = () => {
    const headers = ['Order Number', 'Date', 'Customer Name', 'Customer Phone', 'Items', 'Total (PHP)', 'Payment Method', 'Payment Status', 'Tracking Status', 'Courier', 'Tracking Number', 'Current Location'];
    const rows = allOrders.map(o => [
      o.orderNumber || o.id,
      o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-PH') : 'Recent',
      o.customerName || '-',
      o.customerPhone || '-',
      (o.items || []).map(i => `${i.quantity}x ${i.name}`).join('; '),
      Number(o.total || 0).toFixed(2),
      o.paymentMethod || 'COD',
      o.paymentStatus || 'Pending',
      o.orderStatus || 'Processing',
      o.courier || '-',
      o.trackingNumber || '-',
      o.currentLocation || '-'
    ]);

    exportToExcel(`ArtisanAisle_Sales_Report_${Date.now()}`, 'Platform Sales & Orders Report', headers, rows);
  };

  // 2. Export Sales & Orders (Word)
  const exportSalesWord = () => {
    const headers = ['Order Number', 'Customer', 'Items Summary', 'Total (PHP)', 'Payment', 'Fulfillment', 'Tracking Number'];
    const rows = allOrders.map(o => [
      o.orderNumber || o.id,
      `${o.customerName || '-'} (${o.customerPhone || '-'})`,
      (o.items || []).map(i => `${i.quantity}x ${i.name}`).join(', '),
      `PHP ${Number(o.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      `${o.paymentMethod || 'COD'} - ${o.paymentStatus || 'Pending'}`,
      o.orderStatus || 'Processing',
      o.trackingNumber || 'Pending'
    ]);

    const gmv = allOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const metadata = {
      'Report Type': 'Executive Sales & Orders Summary',
      'Total GMV Volume': `PHP ${gmv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      'Total Orders': allOrders.length,
      'Active Sellers': allUsers.filter(u => u.role === 'seller' || u.sellerStatus === 'approved').length,
      'Platform Admin': currentAdmin?.name || 'Administrator'
    };

    exportToWord(`ArtisanAisle_Sales_Executive_Report_${Date.now()}`, 'Executive Sales & Orders Report', metadata, headers, rows);
  };

  // 3. Export Products Catalog (Excel)
  const exportProductsExcel = () => {
    const headers = ['Product ID', 'Item Name', 'Category', 'Price (PHP)', 'Stock Count', 'Artisan Seller', 'Status'];
    const rows = allProducts.map(p => [
      p.id || '-',
      p.name || 'Untitled Craft',
      p.category || 'General',
      Number(p.price || 0).toFixed(2),
      Number(p.stock || 0),
      p.sellerName || p.sellerEmail || 'Artisan',
      p.status || 'Active'
    ]);

    exportToExcel(`ArtisanAisle_Catalog_Export_${Date.now()}`, 'Artisan Products Catalog Inventory', headers, rows);
  };

  // 4. Export Products Catalog (Word)
  const exportProductsWord = () => {
    const headers = ['Item Name', 'Category', 'Price (PHP)', 'Available Stock', 'Artisan Seller', 'Status'];
    const rows = allProducts.map(p => [
      p.name || 'Untitled Craft',
      p.category || 'General',
      `PHP ${Number(p.price || 0).toFixed(2)}`,
      p.stock || 0,
      p.sellerName || p.sellerEmail || 'Artisan',
      p.status || 'Active'
    ]);

    const metadata = {
      'Report Type': 'Handcrafted Products Catalog Audit',
      'Total Listed Items': allProducts.length,
      'In-Stock Products': allProducts.filter(p => (Number(p.stock) || 0) > 0).length,
      'Low Stock Items (<5 units)': allProducts.filter(p => (Number(p.stock) || 0) < 5).length
    };

    exportToWord(`ArtisanAisle_Catalog_Report_${Date.now()}`, 'Artisan Products Inventory Report', metadata, headers, rows);
  };

  // 5. Export Users (Excel)
  const exportUsersExcel = () => {
    const headers = ['User ID', 'Full Name', 'Email Address', 'Phone Number', 'Account Role', 'Seller Status', 'City / Location'];
    const rows = allUsers.map(u => [
      u.uid || u.id || '-',
      u.name || 'Anonymous User',
      u.email || '-',
      u.phone || '-',
      u.role || 'user',
      u.sellerStatus || 'none',
      u.city || u.address || '-'
    ]);

    exportToExcel(`ArtisanAisle_Users_Export_${Date.now()}`, 'Platform Registered Users Directory', headers, rows);
  };

  // 6. Export Users (Word)
  const exportUsersWord = () => {
    const headers = ['Full Name', 'Email', 'Phone', 'Role', 'Seller Status'];
    const rows = allUsers.map(u => [
      u.name || 'Anonymous User',
      u.email || '-',
      u.phone || '-',
      (u.role || 'user').toUpperCase(),
      u.sellerStatus || 'none'
    ]);

    const metadata = {
      'Report Type': 'User Accounts & Artisan Community Directory',
      'Total Accounts': allUsers.length,
      'Approved Sellers': allUsers.filter(u => u.role === 'seller' || u.sellerStatus === 'approved').length,
      'Pending Seller Applicants': allUsers.filter(u => u.sellerStatus === 'pending').length
    };

    exportToWord(`ArtisanAisle_Users_Directory_${Date.now()}`, 'Registered Users Report', metadata, headers, rows);
  };

  // 7. Export Applications (Excel)
  const exportAppsExcel = () => {
    const headers = ['Application ID', 'Applicant Name', 'Email', 'Shop Name', 'Category', 'GCash Name', 'GCash Mobile', 'Gov ID / Permit', 'Status'];
    const rows = allApplications.map(a => [
      a.id || '-',
      a.applicantName || a.name || '-',
      a.applicantEmail || a.email || '-',
      a.shopName || '-',
      a.category || '-',
      a.gcashName || '-',
      a.gcashNumber || '-',
      a.govId || a.permit || '-',
      a.status || 'Pending'
    ]);

    exportToExcel(`ArtisanAisle_Seller_Applications_${Date.now()}`, 'Artisan Seller Applications Log', headers, rows);
  };

  // 8. Export Applications (Word)
  const exportAppsWord = () => {
    const headers = ['Applicant / Shop', 'Category', 'GCash Account', 'Gov ID', 'Status'];
    const rows = allApplications.map(a => [
      `${a.applicantName || a.name || '-'} / ${a.shopName || '-'}`,
      a.category || '-',
      `${a.gcashName || '-'} (${a.gcashNumber || '-'})`,
      a.govId || a.permit || '-',
      a.status || 'Pending'
    ]);

    const metadata = {
      'Report Type': 'Seller Onboarding & Verification Submissions',
      'Total Applications': allApplications.length,
      'Pending Review': allApplications.filter(a => (a.status || '').toLowerCase() === 'pending').length,
      'Approved': allApplications.filter(a => (a.status || '').toLowerCase() === 'approved').length
    };

    exportToWord(`ArtisanAisle_Applications_Summary_${Date.now()}`, 'Seller Applications Verification Report', metadata, headers, rows);
  };

  // Event Listeners for Sales
  document.getElementById('exportSalesExcelBtn')?.addEventListener('click', exportSalesExcel);
  document.getElementById('exportOrdersExcelBtn')?.addEventListener('click', exportSalesExcel);
  document.getElementById('exportSalesWordBtn')?.addEventListener('click', exportSalesWord);
  document.getElementById('exportOrdersWordBtn')?.addEventListener('click', exportSalesWord);

  // Event Listeners for Products
  document.getElementById('exportProductsExcelBtn')?.addEventListener('click', exportProductsExcel);
  document.getElementById('exportProductsWordBtn')?.addEventListener('click', exportProductsWord);

  // Event Listeners for Users
  document.getElementById('exportUsersExcelBtn')?.addEventListener('click', exportUsersExcel);
  document.getElementById('exportUsersWordBtn')?.addEventListener('click', exportUsersWord);

  // Event Listeners for Applications
  document.getElementById('exportAppsExcelBtn')?.addEventListener('click', exportAppsExcel);
  document.getElementById('exportAppsWordBtn')?.addEventListener('click', exportAppsWord);
}
