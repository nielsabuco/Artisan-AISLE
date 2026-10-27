import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';

let currentAdmin = null;
let allApplications = [];
let allUsers = [];
let allProducts = [];
let allOrders = [];

document.addEventListener('DOMContentLoaded', () => {
  initAdminAuth();
  setupSidebarNav();
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
            alert(`Application for "${app.shopName}" approved successfully! Password setup email dispatched.`);
          } catch (err) {
            alert('Approval error: ' + err.message);
          }
        }
      });

      tr.querySelector('.reject-btn')?.addEventListener('click', async () => {
        const reason = prompt(`Enter rejection reason for "${app.shopName}":`, 'Incomplete documentation or unverified business permit.');
        if (reason !== null) {
          try {
            await ArtisanDB.rejectSellerApplication(app.id, app, reason);
            alert(`Application for "${app.shopName}" rejected. Notification sent.`);
          } catch (err) {
            alert('Rejection error: ' + err.message);
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
        <div class="table-product-row">
          <img src="${p.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=150&q=80'}" alt="${p.name}" class="table-product-thumb" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=150&q=80'">
          <div>
            <strong>${p.name}</strong><br>
            <small>ID: ${p.id}</small>
          </div>
        </div>
      </td>
      <td>${p.category || 'General'}</td>
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
        <span class="status-badge ${(o.orderStatus || 'processing').toLowerCase()}">${o.orderStatus || 'Processing'}</span>
      </td>
      <td>
        <select class="order-status-selector" data-id="${o.id}">
          <option value="Processing" ${o.orderStatus === 'Processing' ? 'selected' : ''}>Processing</option>
          <option value="Confirmed" ${o.orderStatus === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="Shipped" ${o.orderStatus === 'Shipped' ? 'selected' : ''}>Shipped</option>
          <option value="Delivered" ${o.orderStatus === 'Delivered' ? 'selected' : ''}>Delivered</option>
          <option value="Cancelled" ${o.orderStatus === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </td>
    `;

    tr.querySelector('.order-status-selector')?.addEventListener('change', async (e) => {
      const newStatus = e.target.value;
      await ArtisanDB.updateOrderStatus(o.id, newStatus);
      alert(`Order ${o.orderNumber || o.id} marked as ${newStatus}.`);
    });

    tbody.appendChild(tr);
  });
}
