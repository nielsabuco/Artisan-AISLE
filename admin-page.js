import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';
import { exportToExcel, exportToWord, exportToJSON, exportMultiTableExcel } from './export-utils.js';

let currentAdmin = null;
let allApplications = [];
let allUsers = [];
let allProducts = [];
let allOrders = [];
let allArtisans = [];

document.addEventListener('DOMContentLoaded', () => {
  initAdminAuth();
  setupSidebarNav();
  setupExportButtons();
  setupAdminTrackingModal();
  setupAdminPromotionModal();
  setupAdminProductManagement();
  setupAdminArtisansManagement();
  setupAdminPayoutsManagement();
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
    initPaymentGatewaySettings();
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
    renderAdminPayouts();
  });

  // 5. Artisans Directory
  ArtisanDB.subscribeSellers((sellers) => {
    allArtisans = sellers;
    renderArtisansTable(sellers);
    renderAdminPayouts();
    const badge = document.getElementById('artisansCountBadge');
    if (badge) badge.textContent = sellers.length;
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
        if (confirm(`Approve seller application for "${app.shopName}"?\n\nThis will elevate their account to Seller, generate their temporary login credentials, and dispatch the auto-generated onboarding email.`)) {
          try {
            const res = await ArtisanDB.approveSellerApplication(app.id, app);
            
            // Populate and show the dedicated approval success modal
            const modal = document.getElementById('sellerApprovalSuccessModal');
            if (modal) {
              document.getElementById('modalApprovedShopName').textContent = res.shopName || app.shopName;
              document.getElementById('modalApprovedEmail').textContent = res.cleanEmail || app.email;
              document.getElementById('modalApprovedPassword').textContent = res.temporaryPassword || 'Generated';

              const copyBtn = document.getElementById('copyApprovedCredentialsBtn');
              if (copyBtn) {
                copyBtn.onclick = () => {
                  const copyText = `Artisan Aisle Seller Credentials\nShop: ${res.shopName}\nEmail: ${res.cleanEmail}\nTemporary Password: ${res.temporaryPassword}\nLogin URL: ${res.loginUrl}`;
                  navigator.clipboard.writeText(copyText).then(() => {
                    copyBtn.textContent = '✓ Copied to Clipboard!';
                    setTimeout(() => { copyBtn.textContent = '📋 Copy Credentials'; }, 2500);
                  }).catch(() => {
                    alert('Credentials:\n' + copyText);
                  });
                };
              }

              const gmailBtn = document.getElementById('openGmailDirectBtn');
              if (gmailBtn) {
                const subject = encodeURIComponent(`🎉 Congratulations! Your Artisan Aisle Seller Account for "${res.shopName}" is Approved`);
                const body = encodeURIComponent(
`Mabuhay ${res.applicantName || 'Artisan Partner'},

Congratulations! Your artisan seller application for "${res.shopName}" has been approved on Artisan Aisle!

For your account security, your previous session has been automatically logged out. Please log in using your new temporary seller credentials:

• Registered Email: ${res.cleanEmail}
• Temporary Password: ${res.temporaryPassword}
• Seller Login Link: ${res.loginUrl}

IMPORTANT: Please log in using this temporary password (your old registration password is now disabled for security). On your first login, you will be prompted once to set your own new permanent password before entering your Seller Portal.

Welcome to the Artisan Aisle community!

Warm regards,
Artisan Aisle Team`
                );
                gmailBtn.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(res.cleanEmail)}&su=${subject}&body=${body}`;
              }

              modal.style.display = 'flex';
            } else {
              alert(`Application for "${app.shopName}" has been APPROVED!\n\nEmail: ${res.cleanEmail}\nTemporary Password: ${res.temporaryPassword}\n\nAuto-generated email was dispatched with their login link.`);
            }
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
    const isMasterEmail = ArtisanDB.isEmailAdmin && ArtisanDB.isEmailAdmin(u.email);
    const isAdmin = roleClass === 'admin' || isMasterEmail;

    // Badges for specific admin tier
    let badgeHtml = '';
    if (isAdmin) {
      const tier = u.adminRole || (isMasterEmail ? 'super_admin' : 'super_admin');
      if (tier === 'super_admin') {
        badgeHtml = `<span style="background: #285c3b; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block;">⭐ SUPER ADMIN</span>`;
      } else if (tier === 'operations_admin') {
        badgeHtml = `<span style="background: #185abd; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block;">📦 OPERATIONS ADMIN</span>`;
      } else if (tier === 'moderator_admin') {
        badgeHtml = `<span style="background: #d97706; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block;">🎨 MODERATOR ADMIN</span>`;
      } else if (tier === 'finance_admin') {
        badgeHtml = `<span style="background: #0f766e; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block;">📊 FINANCE AUDITOR</span>`;
      } else {
        badgeHtml = `<span class="role-badge admin">ADMIN</span>`;
      }

      if (u.adminTitle) {
        badgeHtml += `<br><small style="color: #285c3b; font-weight: 600;">${u.adminTitle}</small>`;
      }
      if (u.adminPromotedBy) {
        badgeHtml += `<br><small style="color: #777;">by ${u.adminPromotedBy}</small>`;
      }
    } else if (roleClass === 'seller' || u.sellerStatus === 'approved') {
      badgeHtml = `<span class="role-badge seller">ARTISAN SELLER</span>`;
    } else if (u.sellerStatus === 'suspended') {
      badgeHtml = `<span class="role-badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a;">SELLER (SUSPENDED)</span>`;
    } else if (u.sellerStatus === 'revoked') {
      badgeHtml = `<span class="role-badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">SELLER (REVOKED)</span>`;
    } else {
      badgeHtml = `<span class="role-badge user">CUSTOMER</span>`;
    }

    const isSeller = roleClass === 'seller' || u.sellerStatus === 'approved' || u.sellerStatus === 'suspended' || u.sellerStatus === 'revoked';
    const isSuspended = u.sellerStatus === 'suspended' || u.isSuspended;
    const isRevoked = u.sellerStatus === 'revoked';

    let sellerControlsHtml = '';
    if (isSeller) {
      sellerControlsHtml = `
        <div class="user-seller-actions-cluster" style="display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px;">
          ${isSuspended ? `
            <button type="button" class="action-btn unsuspend-seller-btn" title="Reactivate this seller account and restore their products" style="background: #10b981; color: white; border: none; padding: 5px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;">
              ✓ Unsuspend
            </button>
          ` : `
            <button type="button" class="action-btn suspend-seller-btn" title="Temporarily suspend seller privileges and hide products" style="background: #f59e0b; color: #1e293b; border: none; padding: 5px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;">
              ⚠️ Suspend
            </button>
          `}
          ${!isRevoked ? `
            <button type="button" class="action-btn revoke-seller-btn" title="Revoke seller privileges and demote back to customer" style="background: #f1ebd8; color: #78350f; border: 1px solid #dcd1be; padding: 5px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;">
              🚫 Revoke Seller
            </button>
          ` : ''}
          <button type="button" class="action-btn delete-seller-btn" title="Permanently delete this seller account and remove all their listed products" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; padding: 5px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer;">
            🗑️ Delete Seller & Products
          </button>
        </div>
      `;
    }

    tr.innerHTML = `
      <td>
        <strong>${u.name || 'Unnamed'}</strong><br>
        <small>${u.email || '-'}</small>
      </td>
      <td>${u.phone || 'None'}</td>
      <td>${badgeHtml}</td>
      <td><span class="status-badge ${(u.sellerStatus || 'none').toLowerCase()}">${u.sellerStatus || 'none'}</span></td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div>
            <button type="button" class="action-btn manage-promo-btn" style="background: ${isAdmin ? '#185abd' : '#285c3b'}; color: white; border: none; padding: 6px 11px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 11.5px; white-space: nowrap;">
              ${isAdmin ? '👑 Manage Admin Rights' : '+ Promote to Admin'}
            </button>
          </div>
          ${sellerControlsHtml}
        </div>
      </td>
    `;

    tr.querySelector('.manage-promo-btn')?.addEventListener('click', () => {
      openAdminPromotionModal(u);
    });

    // Suspend Seller
    tr.querySelector('.suspend-seller-btn')?.addEventListener('click', async () => {
      const reason = prompt(`Enter reason for suspending seller "${u.name || u.email}":`, 'Policy compliance review');
      if (reason === null) return;
      try {
        const res = await ArtisanDB.suspendSeller(u.id || u.uid, u.email, reason);
        alert(`Seller "${u.name || u.email}" has been suspended.\n${res.affectedProducts || 0} product(s) are now hidden from the storefront.`);
      } catch (err) {
        alert('Failed to suspend seller: ' + err.message);
      }
    });

    // Unsuspend Seller
    tr.querySelector('.unsuspend-seller-btn')?.addEventListener('click', async () => {
      if (!confirm(`Reactivate seller "${u.name || u.email}"?\n\nTheir seller portal access and ${u.name || 'their'}'s products will be restored to Active status.`)) return;
      try {
        const res = await ArtisanDB.unsuspendSeller(u.id || u.uid, u.email);
        alert(`Seller "${u.name || u.email}" has been reactivated successfully.\n${res.restoredProducts || 0} product(s) are active once again.`);
      } catch (err) {
        alert('Failed to unsuspend seller: ' + err.message);
      }
    });

    // Revoke Seller Access
    tr.querySelector('.revoke-seller-btn')?.addEventListener('click', async () => {
      if (!confirm(`Revoke seller privileges for "${u.name || u.email}"?\n\nThey will be demoted to a regular customer and their products will be deactivated.`)) return;
      try {
        const res = await ArtisanDB.revokeSellerAccess(u.id || u.uid, u.email);
        alert(`Seller access revoked for "${u.name || u.email}".\n${res.updatedProductsCount || 0} product(s) were set to Inactive.`);
      } catch (err) {
        alert('Failed to revoke seller access: ' + err.message);
      }
    });

    // Delete Seller & All Products
    tr.querySelector('.delete-seller-btn')?.addEventListener('click', async () => {
      const warningText = `⚠️ CRITICAL ACTION ⚠️\n\nAre you sure you want to permanently DELETE seller "${u.name || u.email}"?\n\nThis will permanently delete their account AND delete all products they listed from the database!\n\nType DELETE to confirm:`;
      const confirmed = prompt(warningText);
      if (confirmed !== 'DELETE') {
        if (confirmed !== null) alert('Action cancelled: You must type DELETE in capital letters to confirm.');
        return;
      }

      try {
        const res = await ArtisanDB.deleteSellerAndProducts(u.id || u.uid, u.email);
        alert(`Seller "${u.name || u.email}" and ${res.deletedProductsCount || 0} listed product(s) were permanently deleted from the database.`);
      } catch (err) {
        alert('Failed to delete seller and products: ' + err.message);
      }
    });

    tbody.appendChild(tr);
  });
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  const countBadge = document.getElementById('adminProductCountBadge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `Showing ${products ? products.length : 0} catalog item${products && products.length === 1 ? '' : 's'}`;
  }

  if (!products || products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 16px;">
          <p style="font-size: 15px; color: #555; margin-bottom: 14px;">No products found in Firestore catalog.</p>
          <button type="button" class="btn-seed-catalog" id="seedCatalogEmptyBtn">Seed Initial Artisan Catalog (8 Products)</button>
        </td>
      </tr>
    `;
    document.getElementById('seedCatalogEmptyBtn')?.addEventListener('click', seedDefaultCatalog);
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
            <small style="color:#777;">ID: ${p.id || '-'}</small>
          </div>
        </div>
      </td>
      <td><span class="category-pill">${p.category || 'General'}</span></td>
      <td><strong>₱${Number(p.price || 0).toFixed(2)}</strong></td>
      <td>
        <input type="number" class="inline-stock-input" value="${Number(p.stock) || 0}" min="0" data-id="${p.id}" title="Edit stock in real-time">
      </td>
      <td>${p.sellerName || 'Artisan Seller'}</td>
      <td><span class="status-badge ${p.status === 'Active' ? 'delivered' : 'unpaid-badge'}">${p.status || 'Active'}</span></td>
      <td>
        <div class="table-actions-cluster">
          <button type="button" class="action-btn edit-prod-btn" style="background:#f1ebd8; color:#285c3b; border:1px solid #dcd1be;">
            Edit
          </button>
          <button type="button" class="action-btn toggle-status-btn" data-id="${p.id}" data-status="${p.status}">
            ${p.status === 'Active' ? 'Hide' : 'Activate'}
          </button>
          <button type="button" class="action-btn delete-btn" data-id="${p.id}">Delete</button>
        </div>
      </td>
    `;

    // Edit product in modal
    tr.querySelector('.edit-prod-btn')?.addEventListener('click', () => {
      openAdminProductModal(p);
    });

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

  // 9. Export All Platform Data (Complete Database Backup in JSON)
  const exportAllDataJSON = () => {
    const gmv = allOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const backupData = {
      platform: "ArtisanAisle Filipino Handicraft Marketplace",
      backupVersion: "2.0",
      exportTimestamp: new Date().toISOString(),
      exportDateFormatted: new Date().toLocaleString('en-PH'),
      exportedBy: currentAdmin?.email || currentAdmin?.name || 'Platform Administrator',
      summaryMetrics: {
        totalGmv: gmv,
        totalGmvFormatted: `PHP ${gmv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        totalOrders: allOrders.length,
        totalUsers: allUsers.length,
        totalActiveSellers: allUsers.filter(u => u.role === 'seller' || u.sellerStatus === 'approved').length,
        totalProducts: allProducts.length,
        totalMasterArtisans: allArtisans.length,
        totalSellerApplications: allApplications.length,
        pendingApplications: allApplications.filter(a => (a.status || '').toLowerCase() === 'pending').length
      },
      datasets: {
        users: allUsers,
        products: allProducts,
        orders: allOrders,
        artisans: allArtisans,
        sellerApplications: allApplications
      }
    };

    exportToJSON(`ArtisanAisle_CompleteDatabaseBackup_${Date.now()}`, backupData);
  };

  // 10. Export All Platform Data (Multi-Table Excel Workbook)
  const exportAllDataExcel = () => {
    const gmv = allOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const tables = [
      {
        tableName: 'Platform Summary & KPIs',
        headers: ['Metric Name', 'Value'],
        rows: [
          ['Platform Gross Merchandise Value (GMV)', `PHP ${gmv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
          ['Total Customer Orders', allOrders.length],
          ['Total Registered Users', allUsers.length],
          ['Total Active Sellers', allUsers.filter(u => u.role === 'seller' || u.sellerStatus === 'approved').length],
          ['Total Products in Catalog', allProducts.length],
          ['Total Master Artisans Directory', allArtisans.length],
          ['Total Seller Applications', allApplications.length],
          ['Pending Seller Applications', allApplications.filter(a => (a.status || '').toLowerCase() === 'pending').length],
          ['Export Generated At', new Date().toLocaleString('en-PH')]
        ]
      },
      {
        tableName: 'Registered Users',
        headers: ['User ID', 'Full Name', 'Email Address', 'Phone Number', 'Account Role', 'Seller Status', 'Location'],
        rows: allUsers.map(u => [
          u.uid || u.id || '-',
          u.name || 'Anonymous User',
          u.email || '-',
          u.phone || '-',
          u.role || 'user',
          u.sellerStatus || 'none',
          u.city || u.address || '-'
        ])
      },
      {
        tableName: 'Product Catalog Inventory',
        headers: ['Product ID', 'Item Name', 'Category', 'Price (PHP)', 'Stock Level', 'Artisan Seller', 'Status'],
        rows: allProducts.map(p => [
          p.id || '-',
          p.name || 'Untitled Craft',
          p.category || 'General',
          Number(p.price || 0).toFixed(2),
          Number(p.stock || 0),
          p.sellerName || p.sellerEmail || 'Artisan',
          p.status || 'Active'
        ])
      },
      {
        tableName: 'Customer Orders & Fulfillment',
        headers: ['Order Number', 'Date', 'Customer Name', 'Customer Phone', 'Purchased Items', 'Total (PHP)', 'Payment Method', 'Payment Status', 'Fulfillment Status', 'Courier', 'Tracking Number'],
        rows: allOrders.map(o => [
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
          o.trackingNumber || '-'
        ])
      },
      {
        tableName: 'Master Artisans Directory',
        headers: ['Artisan ID', 'Full Name', 'Shop / Workshop Name', 'Region / Province', 'Specialization', 'GCash Name', 'GCash Number', 'Status'],
        rows: allArtisans.map(a => [
          a.id || '-',
          a.name || '-',
          a.shopName || '-',
          a.region || '-',
          a.category || '-',
          a.gcashName || '-',
          a.gcashNumber || '-',
          a.status || 'Active'
        ])
      },
      {
        tableName: 'Seller Applications Log',
        headers: ['Application ID', 'Applicant Name', 'Email', 'Shop Name', 'Craft Category', 'GCash Name', 'GCash Number', 'Government ID', 'Status'],
        rows: allApplications.map(a => [
          a.id || '-',
          a.applicantName || a.name || '-',
          a.applicantEmail || a.email || '-',
          a.shopName || '-',
          a.category || '-',
          a.gcashName || '-',
          a.gcashNumber || '-',
          a.govId || a.permit || '-',
          a.status || 'Pending'
        ])
      }
    ];

    exportMultiTableExcel(`ArtisanAisle_CompleteDatabase_${Date.now()}`, 'ArtisanAisle Platform Database Complete Backup', tables);
  };

  // 11. Export Artisans Directory (Excel)
  const exportArtisansExcel = () => {
    const headers = ['Artisan ID', 'Artisan Name', 'Shop / Workshop', 'Region / Province', 'Craft Specialization', 'GCash Name', 'GCash Number', 'Status'];
    const rows = allArtisans.map(a => [
      a.id || '-',
      a.name || 'Artisan',
      a.shopName || 'Workshop',
      a.region || 'Philippines',
      a.category || 'Handicrafts',
      a.gcashName || '-',
      a.gcashNumber || '-',
      a.status || 'Active'
    ]);

    exportToExcel(`ArtisanAisle_Artisans_Directory_${Date.now()}`, 'Artisans Directory & Creator Profiles', headers, rows);
  };

  // 12. Export Artisans Directory (Word)
  const exportArtisansWord = () => {
    const headers = ['Artisan Name', 'Shop / Workshop', 'Region', 'Specialization', 'Status'];
    const rows = allArtisans.map(a => [
      a.name || 'Artisan',
      a.shopName || 'Workshop',
      a.region || 'Philippines',
      a.category || 'Handicrafts',
      a.status || 'Active'
    ]);

    const metadata = {
      'Report Type': 'Master Artisans & Regional Workshops Directory',
      'Total Verified Artisans': allArtisans.length,
      'Active Workshops': allArtisans.filter(a => a.status === 'Active').length
    };

    exportToWord(`ArtisanAisle_Artisans_Report_${Date.now()}`, 'Master Artisans Directory Report', metadata, headers, rows);
  };

  // Event Listeners for Complete Database Backup
  document.getElementById('exportAllDataJsonBtn')?.addEventListener('click', exportAllDataJSON);
  document.getElementById('exportAllDataExcelBtn')?.addEventListener('click', exportAllDataExcel);

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

  // Event Listeners for Artisans
  document.getElementById('exportArtisansExcelBtn')?.addEventListener('click', exportArtisansExcel);
  document.getElementById('exportArtisansWordBtn')?.addEventListener('click', exportArtisansWord);

  // 13. Export Admin Salary Payouts (Excel)
  const exportAdminPayoutsExcel = () => {
    const payouts = computeAllAdminPayouts();
    const headers = ['Artisan / Shop Name', 'Payout Period', 'Orders Count', 'Gross Sales (PHP)', '2% Gateway Fee', '13% Website Fee', 'Total 15% Fees', 'Net Salary (85%)', 'GCash Account', 'Status', 'Reference #'];
    const rows = payouts.map(p => [
      p.shopName || p.artisanName || 'Artisan',
      p.monthLabel,
      p.orderCount,
      p.grossSales.toFixed(2),
      p.gatewayFee.toFixed(2),
      p.maintenanceFee.toFixed(2),
      p.totalDeductions.toFixed(2),
      p.netSalary.toFixed(2),
      `${p.gcashName || '-'} (${p.gcashNumber || '-'})`,
      p.status || 'Scheduled',
      p.referenceNumber || '-'
    ]);

    exportToExcel(`ArtisanAisle_Seller_Salary_Payouts_${Date.now()}`, 'Artisan Salary Payouts & Fee Revenue Log', headers, rows);
  };

  // 14. Export Admin Salary Payouts (Word)
  const exportAdminPayoutsWord = () => {
    const payouts = computeAllAdminPayouts();
    const headers = ['Artisan / Shop', 'Period', 'Orders', 'Gross Sales', 'Fees (15%)', 'Net Salary (85%)', 'Status'];
    const rows = payouts.map(p => [
      p.shopName || p.artisanName || 'Artisan',
      p.monthLabel,
      p.orderCount,
      `PHP ${p.grossSales.toFixed(2)}`,
      `-PHP ${p.totalDeductions.toFixed(2)}`,
      `PHP ${p.netSalary.toFixed(2)}`,
      p.status || 'Scheduled'
    ]);

    const totalGross = payouts.reduce((acc, p) => acc + p.grossSales, 0);
    const totalFees = payouts.reduce((acc, p) => acc + p.totalDeductions, 0);
    const totalNet = payouts.reduce((acc, p) => acc + p.netSalary, 0);

    const metadata = {
      'Report Type': 'Seller Salary Payouts & Fee Revenue Audit',
      'Platform Volume': `PHP ${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      'Total 15% Fees Collected': `PHP ${totalFees.toLocaleString('en-US', { minimumFractionDigits: 2 })} (2% Gateway, 13% Maintenance)`,
      'Total Net Salaries Payable (85%)': `PHP ${totalNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      'Generated By': currentAdmin?.email || 'Platform Administrator'
    };

    exportToWord(`ArtisanAisle_Payouts_Report_${Date.now()}`, 'Artisan Salary Payouts & Fee Revenue Summary', metadata, headers, rows);
  };

  // Event Listeners for Salary Payouts
  document.getElementById('exportAdminPayoutsExcelBtn')?.addEventListener('click', exportAdminPayoutsExcel);
  document.getElementById('exportAdminPayoutsWordBtn')?.addEventListener('click', exportAdminPayoutsWord);
}

function setupAdminPromotionModal() {
  const modal = document.getElementById('adminPromotionModal');
  const closeBtn = document.getElementById('closeAdminPromoModalBtn');
  const cancelBtn = document.getElementById('cancelPromoBtn');
  const saveBtn = document.getElementById('savePromoBtn');
  const demoteBtn = document.getElementById('demoteUserBtn');
  const tierSelect = document.getElementById('promoAdminTier');
  const descEl = document.getElementById('promoPrivilegesDescription');

  const tierDescriptions = {
    super_admin: 'Full unrestricted master platform control: user role delegation, seller verification, order tracking, financial audits, and platform configuration.',
    operations_admin: 'Operations & logistics management: order fulfillment updates, courier assignment, live delivery tracking, and buyer notifications.',
    moderator_admin: 'Catalog & artisan community moderation: reviewing handcrafted product listings, approving/rejecting seller applications, and inventory supervision.',
    finance_admin: 'Finance & sales analytics: viewing platform revenue, order transaction audits, and downloading executive financial reports (Excel / Word).'
  };

  tierSelect?.addEventListener('change', () => {
    const val = tierSelect.value;
    if (descEl) descEl.textContent = tierDescriptions[val] || tierDescriptions.super_admin;
  });

  closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });

  document.getElementById('openAddAdminBtn')?.addEventListener('click', () => {
    openAdminPromotionModal(null);
  });

  saveBtn?.addEventListener('click', async () => {
    const uid = document.getElementById('promoUserId').value;
    const email = document.getElementById('promoUserEmail').value.trim();
    const adminTier = document.getElementById('promoAdminTier').value;
    const customTitle = document.getElementById('promoCustomTitle').value.trim();
    const notes = document.getElementById('promoNotes').value.trim();

    if (!email) {
      alert('Please enter a valid user email address.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Granting Access...';

    try {
      if (uid) {
        await ArtisanDB.promoteUserToAdmin(uid, {
          adminRole: adminTier,
          title: customTitle,
          notes: notes,
          promotedByAdmin: currentAdmin
        });
        alert(`User (${email}) has been successfully appointed to ${customTitle || adminTier.toUpperCase()}!`);
      } else {
        const res = await ArtisanDB.promoteUserByEmail(email, {
          adminRole: adminTier,
          title: customTitle,
          notes: notes,
          promotedByAdmin: currentAdmin
        });
        if (res.preAuthorized) {
          alert(`Account for "${email}" has been pre-authorized as an Administrator! When they register or sign in with Google, they will immediately receive full administrative privileges.`);
        } else {
          alert(`User (${email}) has been successfully appointed as ${customTitle || adminTier.toUpperCase()}!`);
        }
      }
      modal.style.display = 'none';
    } catch (err) {
      alert('Promotion error: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Grant Admin Position';
    }
  });

  demoteBtn?.addEventListener('click', async () => {
    const uid = document.getElementById('promoUserId').value;
    const email = document.getElementById('promoUserEmail').value.trim();
    if (!uid) return;

    if (currentAdmin && (currentAdmin.uid === uid || currentAdmin.id === uid)) {
      alert('Safety Lockout Prevention: You cannot revoke your own administrator account.');
      return;
    }

    if (!confirm(`Are you sure you want to revoke administrator privileges for "${email}"? They will return to a standard user account.`)) {
      return;
    }

    demoteBtn.disabled = true;
    demoteBtn.textContent = 'Revoking...';

    try {
      await ArtisanDB.demoteAdminToUser(uid, 'user', currentAdmin);
      alert(`Administrator privileges for ${email} have been revoked.`);
      modal.style.display = 'none';
    } catch (err) {
      alert('Demotion error: ' + err.message);
    } finally {
      demoteBtn.disabled = false;
      demoteBtn.textContent = 'Revoke Admin Position';
    }
  });
}

function openAdminPromotionModal(user) {
  const modal = document.getElementById('adminPromotionModal');
  if (!modal) return;

  const uidInput = document.getElementById('promoUserId');
  const emailInput = document.getElementById('promoUserEmail');
  const nameInput = document.getElementById('promoUserName');
  const tierSelect = document.getElementById('promoAdminTier');
  const titleInput = document.getElementById('promoCustomTitle');
  const notesInput = document.getElementById('promoNotes');
  const demoteBtn = document.getElementById('demoteUserBtn');
  const saveBtn = document.getElementById('savePromoBtn');

  if (user) {
    uidInput.value = user.id || user.uid || '';
    emailInput.value = user.email || '';
    emailInput.readOnly = true;
    emailInput.style.background = '#f5f5f5';
    nameInput.value = user.name || '';
    nameInput.readOnly = true;
    nameInput.style.background = '#f5f5f5';

    tierSelect.value = user.adminRole || 'super_admin';
    titleInput.value = user.adminTitle || '';
    notesInput.value = user.adminPromotionNotes || '';

    const roleClass = String(user.role || 'user').toLowerCase();
    const isAdmin = roleClass === 'admin' || (ArtisanDB.isEmailAdmin && ArtisanDB.isEmailAdmin(user.email));

    if (isAdmin) {
      demoteBtn.style.display = 'inline-block';
      saveBtn.textContent = 'Update Admin Position';
    } else {
      demoteBtn.style.display = 'none';
      saveBtn.textContent = 'Grant Admin Position';
    }
  } else {
    // New Admin Appointment by Email
    uidInput.value = '';
    emailInput.value = '';
    emailInput.readOnly = false;
    emailInput.style.background = '#ffffff';
    nameInput.value = '';
    nameInput.readOnly = false;
    nameInput.style.background = '#ffffff';

    tierSelect.value = 'super_admin';
    titleInput.value = '';
    notesInput.value = '';
    demoteBtn.style.display = 'none';
    saveBtn.textContent = 'Grant Admin Position';
  }

  // Trigger description update
  tierSelect.dispatchEvent(new Event('change'));
  modal.style.display = 'flex';
}

/* ================= CATALOG MANAGEMENT & SEEDING ================= */

const DEFAULT_CATALOG_SEEDS = [
  {
    name: "Handcrafted Abaca Tote Bag",
    category: "Bags",
    price: 850,
    stock: 15,
    status: "Active",
    image: "https://i.etsystatic.com/50829130/r/il/396bf3/6117942828/il_1140xN.6117942828_ptjd.jpg?fbclid=IwY2xjawTmgCBwZG9mBWV4dG4DYWVtAjEwAGJyaWQRMUF6QkdJNXFvcWw5M0xlV0NzcnRjBmFwcF9pZBAyMjIwMzkxNzg4MjAwODkyAAEepg7OtAA_5JhHMhJqL_XIzEEom92qhWgEd4AEJ7TxrttW8ZZmGGJSA_tmg74_aem_i2m_YqwCVhogIjT-bLyvqg",
    sellerName: "Bicol Heritage Weavers",
    sellerGCash: "09764948458",
    sellerGCashName: "Eugene Marciene Jerusalem",
    description: "Handcrafted from native pandan and abaca fibers by local artisans in Bicol. Durable, lightweight, eco-friendly, and perfect for everyday use."
  },
  {
    name: "Woven Rattan Planter Basket",
    category: "Woven Items",
    price: 550,
    stock: 12,
    status: "Active",
    image: "https://m.media-amazon.com/images/I/81UngKI1lIL._AC_SL1500_.jpg?fbclid=IwY2xjawTmgWdwZG9mBWV4dG4DYWVtAjEwAGJyaWQRMUF6QkdJNXFvcWw5M0xlV0NzcnRjBmFwcF9pZBAyMjIwMzkxNzg4MjAwODkyAAEeWVpYX8HSDQvhT0gD7NiiQO_-mBeOKCTr41F78gxYlzRELsZ6K7FY92N4fPk_aem_hWcjV0vWrzKBYQjGOwHnow",
    sellerName: "Samar Community Crafters",
    sellerGCash: "09764948458",
    sellerGCashName: "Maer Jerusalem",
    description: "Handcrafted rattan basket woven with care for plant storage, interior decor, and sustainable home organization."
  },
  {
    name: "Hand-Carved Wooden Spoon Set",
    category: "Wood Crafts",
    price: 380,
    stock: 20,
    status: "Active",
    image: "https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=500&q=80",
    sellerName: "Cordillera Wood Carvers",
    sellerGCash: "09853551524",
    sellerGCashName: "Reniel Sabuco",
    description: "Solid hardwood kitchen utensils hand-carved by indigenous artisans in Benguet. Coated with organic food-safe beeswax."
  },
  {
    name: "Bamboo & Capiz Ambient Lamp",
    category: "Home Decor",
    price: 750,
    stock: 10,
    status: "Active",
    image: "https://warisanlighting.com/wp-content/uploads/parser/custom-lamps-2.jpg?fbclid=IwY2xjawTmgGtwZG9mBWV4dG4DYWVtAjEwAGJyaWQRMUF6QkdJNXFvcWw5M0xlV0NzcnRjBmFwcF9pZBAyMjIwMzkxNzg4MjAwODkyAAEeWVpYX8HSDQvhT0gD7NiiQO_-mBeOKCTr41F78gxYlzRELsZ6K7FY92N4fPk_aem_hWcjV0vWrzKBYQjGOwHnow",
    sellerName: "Panay Shell & Woodworks",
    sellerGCash: "09764948458",
    sellerGCashName: "Marciene Jerusalem",
    description: "Warm atmospheric ambient lamp made from harvested bamboo slats and shimmering Capiz shell accents from Roxas City."
  },
  {
    name: "Handwoven Native Accented Wallet",
    category: "Accessories",
    price: 240,
    stock: 18,
    status: "Active",
    image: "https://nphikwtyvmrlvudxmdre.supabase.co/storage/v1/object/public/product-images/products/f39bb4c2-806b-4c50-bb61-f9606b2a6ebd.webp",
    sellerName: "Mindanao Artisan Collective",
    sellerGCash: "09175551234",
    sellerGCashName: "Pierce Estrada",
    description: "Handcrafted compact bifold wallet with traditional geometric weave patterns and genuine local leather trimming."
  },
  {
    name: "Yakan Weave Table Runner",
    category: "Woven Items",
    price: 1250,
    stock: 8,
    status: "Active",
    image: "https://images.unsplash.com/photo-1606744824163-985d376605aa?auto=format&fit=crop&w=500&q=80",
    sellerName: "Basilan Yakan Weavers",
    sellerGCash: "09764948458",
    sellerGCashName: "Marciene Jerusalem",
    description: "Vibrant table runner featuring authentic Yakan Seputangan weave patterns passed down through generations of Zamboanga artisans."
  },
  {
    name: "Capiz Shell Chime & Suncatcher",
    category: "Home Decor",
    price: 420,
    stock: 25,
    status: "Active",
    image: "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=500&q=80",
    sellerName: "Visayan Coastal Crafts",
    sellerGCash: "09853551524",
    sellerGCashName: "Reniel Sabuco",
    description: "Iridescent Capiz shells that produce a soothing melody in the breeze. Perfect for balconies, gardens, and windows."
  },
  {
    name: "Terracotta Clay Pottery Planter",
    category: "Home Decor",
    price: 540,
    stock: 14,
    status: "Active",
    image: "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=500&q=80",
    sellerName: "Vigan Burnay Pottery",
    sellerGCash: "09175551234",
    sellerGCashName: "Pierce Estrada",
    description: "Traditional kiln-fired terracotta clay pot molded by master potters using time-honored artisanal pottery wheels."
  }
];

function setupAdminProductManagement() {
  const modal = document.getElementById('adminProductModal');
  const openBtn = document.getElementById('openAddProductModalBtn');
  const closeBtn = document.getElementById('closeAdminProductModalBtn');
  const cancelBtn = document.getElementById('cancelAdminProdBtn');
  const saveBtn = document.getElementById('saveAdminProdBtn');
  const seedBtn = document.getElementById('seedCatalogBtn');
  const searchInput = document.getElementById('adminProductSearch');

  openBtn?.addEventListener('click', () => {
    openAdminProductModal(null);
  });

  closeBtn?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  cancelBtn?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  seedBtn?.addEventListener('click', seedDefaultCatalog);

  searchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      renderProductsTable(allProducts);
      return;
    }
    const filtered = allProducts.filter(p => {
      const text = `${p.name || ''} ${p.category || ''} ${p.sellerName || ''} ${p.id || ''}`.toLowerCase();
      return text.includes(query);
    });
    renderProductsTable(filtered);
  });

  saveBtn?.addEventListener('click', async () => {
    const id = document.getElementById('adminProdId').value;
    const name = document.getElementById('adminProdName').value.trim();
    const category = document.getElementById('adminProdCategory').value;
    const price = Number(document.getElementById('adminProdPrice').value) || 0;
    const stock = Number(document.getElementById('adminProdStock').value) || 0;
    const status = document.getElementById('adminProdStatus').value;
    const image = document.getElementById('adminProdImage').value.trim();
    const sellerName = document.getElementById('adminProdSellerName').value.trim();
    const description = document.getElementById('adminProdDesc').value.trim();

    if (!name) {
      alert('Please enter a product title.');
      return;
    }
    if (price <= 0) {
      alert('Please enter a valid price.');
      return;
    }

    const payload = {
      name,
      category,
      price,
      stock,
      status,
      image: image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=500&q=80',
      sellerName: sellerName || currentAdmin?.name || 'Artisan Marketplace',
      sellerId: currentAdmin?.uid || 'admin-catalog',
      description: description || 'Handcrafted by skilled Filipino artisans using traditional techniques.'
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (id) {
        await ArtisanDB.updateProduct(id, payload);
        alert(`Product "${name}" updated successfully.`);
      } else {
        await ArtisanDB.addProduct(payload);
        alert(`Product "${name}" added to marketplace catalog!`);
      }
      modal.style.display = 'none';
    } catch (err) {
      alert('Failed to save product: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Product';
    }
  });
}

function openAdminProductModal(product = null) {
  const modal = document.getElementById('adminProductModal');
  const title = document.getElementById('adminProductModalTitle');
  if (!modal) return;

  if (product) {
    title.textContent = 'Edit Catalog Product';
    document.getElementById('adminProdId').value = product.id || '';
    document.getElementById('adminProdName').value = product.name || '';
    document.getElementById('adminProdCategory').value = product.category || 'Bags';
    document.getElementById('adminProdPrice').value = product.price || '';
    document.getElementById('adminProdStock').value = product.stock ?? 0;
    document.getElementById('adminProdStatus').value = product.status || 'Active';
    document.getElementById('adminProdImage').value = product.image || '';
    document.getElementById('adminProdSellerName').value = product.sellerName || '';
    document.getElementById('adminProdDesc').value = product.description || '';
  } else {
    title.textContent = 'Add New Product to Catalog';
    document.getElementById('adminProdId').value = '';
    document.getElementById('adminProdName').value = '';
    document.getElementById('adminProdCategory').value = 'Bags';
    document.getElementById('adminProdPrice').value = '';
    document.getElementById('adminProdStock').value = 10;
    document.getElementById('adminProdStatus').value = 'Active';
    document.getElementById('adminProdImage').value = '';
    document.getElementById('adminProdSellerName').value = currentAdmin?.name || 'Artisan Creator';
    document.getElementById('adminProdDesc').value = '';
  }

  modal.style.display = 'flex';
}

async function seedDefaultCatalog() {
  if (!confirm('Seed the 8 authentic Philippine handicrafts into the Firestore catalog?\n\nThis will populate products with high-resolution imagery, artisan bios, stock, and descriptions.')) {
    return;
  }

  const seedBtn = document.getElementById('seedCatalogBtn');
  if (seedBtn) {
    seedBtn.disabled = true;
    seedBtn.textContent = 'Seeding...';
  }

  let addedCount = 0;
  try {
    for (const item of DEFAULT_CATALOG_SEEDS) {
      // Check if product with this name already exists in current list
      const exists = allProducts.some(p => (p.name || '').toLowerCase() === item.name.toLowerCase());
      if (!exists) {
        await ArtisanDB.addProduct(item);
        addedCount++;
      }
    }
    alert(`Catalog Seeding Complete!\n\nAdded ${addedCount} new handcrafted products directly to Firestore.`);
  } catch (err) {
    alert('Seeding error: ' + err.message);
  } finally {
    if (seedBtn) {
      seedBtn.disabled = false;
      seedBtn.textContent = 'Seed Default Catalog';
    }
  }
}

async function initPaymentGatewaySettings() {
  const form = document.getElementById('adminPaymentSettingsForm');
  const secretInput = document.getElementById('pmSecretKeyInput');
  const publicInput = document.getElementById('pmPublicKeyInput');
  const testRadio = document.getElementById('modeRadioTest');
  const liveRadio = document.getElementById('modeRadioLive');
  const statusVal = document.getElementById('adminPmStatusVal');
  const statusSub = document.getElementById('adminPmStatusSub');
  const modeVal = document.getElementById('adminPmModeVal');
  const alertBox = document.getElementById('pmSettingsAlert');
  const testBtn = document.getElementById('testPmConnectionBtn');

  if (!form || !secretInput) return;

  // Load existing settings from database
  try {
    const settings = await ArtisanDB.getPaymentSettings();
    if (settings) {
      if (settings.secretKey) secretInput.value = settings.secretKey;
      if (settings.publicKey) publicInput.value = settings.publicKey;
      if (settings.isLiveMode) {
        liveRadio.checked = true;
      } else {
        testRadio.checked = true;
      }
    }
  } catch (e) {
    console.warn('Error loading payment settings:', e);
  }

  updateStatusDisplay();

  function updateStatusDisplay() {
    const key = secretInput.value.trim();
    const isConfigured = (key.startsWith('sk_test_') || key.startsWith('sk_live_')) && !key.includes('placeholder');
    const isLive = liveRadio.checked;

    if (isConfigured) {
      statusVal.textContent = 'Configured & Ready';
      statusVal.style.color = '#285c3b';
      statusSub.textContent = `Active Key: ${key.slice(0, 7)}••••`;
    } else {
      statusVal.textContent = 'Not Configured';
      statusVal.style.color = '#d97706';
      statusSub.textContent = 'Add your sk_test_ or sk_live_ key to enable real checkout';
    }

    if (isLive) {
      modeVal.textContent = 'Live Mode (Real Money)';
      modeVal.style.color = '#007DFE';
    } else {
      modeVal.textContent = 'Sandbox (Test Mode)';
      modeVal.style.color = '#285c3b';
    }
  }

  secretInput.addEventListener('input', updateStatusDisplay);
  testRadio.addEventListener('change', updateStatusDisplay);
  liveRadio.addEventListener('change', updateStatusDisplay);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('savePmSettingsBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving Settings...';

    const secretKey = secretInput.value.trim();
    const publicKey = publicInput.value.trim();
    const isLiveMode = liveRadio.checked;

    try {
      await ArtisanDB.updatePaymentSettings({
        secretKey,
        publicKey,
        isLiveMode,
        enabled: true
      });

      alertBox.textContent = '✓ Payment gateway settings successfully saved! Orders will now process through PayMongo with these credentials.';
      alertBox.style.background = '#e7eee8';
      alertBox.style.color = '#285c3b';
      alertBox.style.border = '1px solid #c2d6c5';
      alertBox.style.display = 'block';
      updateStatusDisplay();
    } catch (err) {
      alertBox.textContent = 'Failed to save settings: ' + err.message;
      alertBox.style.background = '#fef2f2';
      alertBox.style.color = '#b91c1c';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Gateway Settings';
    }
  });

  testBtn?.addEventListener('click', async () => {
    const key = secretInput.value.trim();
    if (!key) {
      alert('Please enter a PayMongo Secret Key before testing.');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing Key...';
    try {
      const authHeader = 'Basic ' + btoa(key + ':');
      const res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
        },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [{ name: 'Test Key Validation', amount: 10000, currency: 'PHP', quantity: 1 }],
              payment_method_types: ['gcash'],
              success_url: window.location.href,
              cancel_url: window.location.href
            }
          }
        })
      });

      const data = await res.json();
      if (res.ok && data.data) {
        alert('🎉 PayMongo Connection SUCCESSFUL!\n\nYour Secret Key is valid and active. Real GCash payments can now be processed.');
      } else {
        const msg = (data.errors && data.errors[0]?.detail) || 'Could not validate key.';
        alert('PayMongo Notice:\n\n' + msg + '\n\nNote: If testing in the browser causes CORS restrictions, test via the checkout flow directly after saving.');
      }
    } catch (e) {
      alert('Connection test sent! Save the key and test in checkout to complete verification.');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test PayMongo Connection';
    }
  });
}

/* ================= ARTISANS DIRECTORY & PHOTO MANAGEMENT ================= */
function setupAdminArtisansManagement() {
  const searchInput = document.getElementById('adminArtisanSearchInput');
  const openAddBtn = document.getElementById('openAddArtisanModalBtn');
  const closeBtn = document.getElementById('closeAdminArtisanModalBtn');
  const cancelBtn = document.getElementById('cancelAdminArtisanModalBtn');
  const saveBtn = document.getElementById('saveAdminArtisanBtn');
  const seedBtn = document.getElementById('seedArtisansBtn');
  const photoFileInput = document.getElementById('adminArtisanPhotoFile');
  const photoUrlInput = document.getElementById('adminArtisanPhotoUrl');
  const photoPreview = document.getElementById('adminArtisanPhotoPreview');

  // Search filter
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderArtisansTable(allArtisans);
    });
  }

  // Open Add Artisan Modal
  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => {
      openArtisanModal(null);
    });
  }

  // Close modal buttons
  if (closeBtn) closeBtn.addEventListener('click', closeArtisanModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeArtisanModal);

  // File Upload with FileReader to base64 data URL
  if (photoFileInput) {
    photoFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('Please choose an image smaller than 2MB.');
        photoFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        if (photoPreview) photoPreview.src = base64;
        if (photoUrlInput) photoUrlInput.value = base64;
      };
      reader.readAsDataURL(file);
    });
  }

  // Manual URL input change
  if (photoUrlInput) {
    photoUrlInput.addEventListener('input', () => {
      const val = photoUrlInput.value.trim();
      if (photoPreview) photoPreview.src = val || 'images/emblem.svg';
    });
  }

  // Save Artisan
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const aId = document.getElementById('adminArtisanId').value;
      const name = document.getElementById('adminArtisanNameInput').value.trim();
      const shopName = document.getElementById('adminArtisanShopInput').value.trim();
      const region = document.getElementById('adminArtisanRegionInput').value.trim();
      const category = document.getElementById('adminArtisanCategoryInput').value.trim();
      const bio = document.getElementById('adminArtisanBioInput').value.trim();
      const gcashName = document.getElementById('adminArtisanGCashNameInput').value.trim();
      const gcashNumber = document.getElementById('adminArtisanGCashNumberInput').value.trim();
      const status = document.getElementById('adminArtisanStatusInput').value;
      const photo = photoUrlInput.value.trim() || 'images/emblem.svg';

      if (!name || !shopName) {
        alert('Please provide both the Artisan Name and Shop/Collective Name.');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving Artisan...';

      try {
        const payload = {
          name,
          shopName,
          region: region || 'Philippines',
          category: category || 'Handmade Crafts',
          bio: bio || 'Dedicated local artisan preserving traditional craftsmanship.',
          gcashName: gcashName || name,
          gcashNumber: gcashNumber || '',
          status: status || 'Active',
          photo: photo,
          verified: true
        };

        if (aId) {
          await ArtisanDB.saveSellerProfile(aId, payload);
          alert(`Artisan profile "${name}" successfully updated!`);
        } else {
          await ArtisanDB.createArtisan(payload);
          alert(`New artisan "${name}" successfully registered into directory!`);
        }
        closeArtisanModal();
      } catch (err) {
        alert('Failed to save artisan profile: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Artisan Profile';
      }
    });
  }

  // Seed default authentic Philippine artisans into Firestore
  if (seedBtn) {
    seedBtn.addEventListener('click', async () => {
      if (!confirm('Populate the 6 master Philippine artisans with verified stories, regional workshop details, and photos into Firestore?')) {
        return;
      }

      seedBtn.disabled = true;
      seedBtn.textContent = 'Seeding Artisans...';

      const SEED_ARTISANS = [
        {
          id: 'artisan-jerusalem',
          name: 'Eugene Marciene M. Jerusalem',
          shopName: 'Bicol Heritage Weavers',
          region: 'Albay, Bicol (Luzon)',
          category: 'Traditional Handloom Weaving & Abaca Bags',
          bio: 'Preserving over three generations of authentic Bicolano abaca weaving. Each bag, basket, and runner is crafted with natural fiber sustainably harvested in Albay.',
          photo: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Eugene Marciene Jerusalem',
          gcashNumber: '09764948458',
          status: 'Active',
          verified: true
        },
        {
          id: 'artisan-sabuco',
          name: 'Reniel M. Sabuco',
          shopName: 'Samar Community Crafters',
          region: 'Calbiga, Western Samar (Visayas)',
          category: 'Handcrafted Woodworks & Heritage Decor',
          bio: 'Rooted in Calbiga, Samar woodcraft traditions. Shaping sustainable Philippine mahogany and acacia into functional home decor and polished ancestral keepsakes.',
          photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Reniel Sabuco',
          gcashNumber: '09853551524',
          status: 'Active',
          verified: true
        },
        {
          id: 'artisan-dacdac',
          name: 'Robert G. Dacdac',
          shopName: 'Cordillera Wood Carvers',
          region: 'Benguet, Cordillera (Luzon)',
          category: 'Carved Wooden Statues, Bowls & Wall Art',
          bio: 'Honoring indigenous Ifugao and Igorot wood carving traditions. Every chisel mark pays homage to the misty mountain ranges and ancestral craftsmanship of Northern Luzon.',
          photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Robert Dacdac',
          gcashNumber: '09175551234',
          status: 'Active',
          verified: true
        },
        {
          id: 'artisan-estrada',
          name: 'Pierce P. Estrada',
          shopName: 'Panay Shell & Woodworks',
          region: 'Iloilo, Panay (Visayas)',
          category: 'Capiz Shell Decor & Handcrafted Souvenirs',
          bio: 'Master artisan transforming translucent indigenous Capiz shells and coastal driftwood into radiant lamps, jewelry holders, and Philippine cultural keepsakes.',
          photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Pierce Estrada',
          gcashNumber: '09175551234',
          status: 'Active',
          verified: true
        },
        {
          id: 'artisan-acbo',
          name: 'Kia Vanette A. Acbo',
          shopName: 'Visayan Coastal Crafts',
          region: 'Cebu, Central Visayas',
          category: 'Macrame, Shell Accents & Native Accessories',
          bio: 'Coordinating artisan women weavers in Cebu to produce contemporary beachwear accessories, handmade shell tassels, and modern eco-friendly lifestyle crafts.',
          photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Kia Vanette Acbo',
          gcashNumber: '09853551524',
          status: 'Active',
          verified: true
        },
        {
          id: 'artisan-mindanao',
          name: 'Nanay Lucia B. & Yakan Guild',
          shopName: 'Basilan Yakan Weavers',
          region: 'Lamitan, Basilan (Mindanao)',
          category: 'Intricate Yakan Tennun Textile & Tribal Tapestry',
          bio: 'Master of the backstrap loom. Weaving kaleidoscopic geometric motifs (Seputangan and Sinaluan) handed down through centuries of indigenous Mindanao Yakan heritage.',
          photo: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
          gcashName: 'Lucia Basilan',
          gcashNumber: '09764948458',
          status: 'Active',
          verified: true
        }
      ];

      try {
        for (const item of SEED_ARTISANS) {
          const { id, ...data } = item;
          await ArtisanDB.saveSellerProfile(id, data);
        }
        alert('Master artisans successfully seeded into the directory!');
      } catch (err) {
        alert('Seeding error: ' + err.message);
      } finally {
        seedBtn.disabled = false;
        seedBtn.textContent = '🌱 Seed Master Artisans';
      }
    });
  }
}

function openArtisanModal(artisan) {
  const modal = document.getElementById('adminArtisanModal');
  if (!modal) return;

  const titleEl = document.getElementById('adminArtisanModalTitle');
  const idInput = document.getElementById('adminArtisanId');
  const nameInput = document.getElementById('adminArtisanNameInput');
  const shopInput = document.getElementById('adminArtisanShopInput');
  const regionInput = document.getElementById('adminArtisanRegionInput');
  const catInput = document.getElementById('adminArtisanCategoryInput');
  const bioInput = document.getElementById('adminArtisanBioInput');
  const gcashNameInput = document.getElementById('adminArtisanGCashNameInput');
  const gcashNumInput = document.getElementById('adminArtisanGCashNumberInput');
  const statusInput = document.getElementById('adminArtisanStatusInput');
  const photoUrlInput = document.getElementById('adminArtisanPhotoUrl');
  const photoPreview = document.getElementById('adminArtisanPhotoPreview');
  const fileInput = document.getElementById('adminArtisanPhotoFile');

  if (fileInput) fileInput.value = '';

  if (artisan) {
    titleEl.textContent = `Edit Artisan: ${artisan.name || 'Artisan'}`;
    idInput.value = artisan.id || '';
    nameInput.value = artisan.name || '';
    shopInput.value = artisan.shopName || '';
    regionInput.value = artisan.region || '';
    catInput.value = artisan.category || '';
    bioInput.value = artisan.bio || '';
    gcashNameInput.value = artisan.gcashName || '';
    gcashNumInput.value = artisan.gcashNumber || '';
    statusInput.value = artisan.status || 'Active';
    const photo = artisan.photo || artisan.avatar || 'images/emblem.svg';
    photoUrlInput.value = photo;
    photoPreview.src = photo;
  } else {
    titleEl.textContent = 'Add Master Artisan';
    idInput.value = '';
    nameInput.value = '';
    shopInput.value = '';
    regionInput.value = '';
    catInput.value = '';
    bioInput.value = '';
    gcashNameInput.value = '';
    gcashNumInput.value = '';
    statusInput.value = 'Active';
    photoUrlInput.value = '';
    photoPreview.src = 'images/emblem.svg';
  }

  modal.style.display = 'flex';
}

function closeArtisanModal() {
  const modal = document.getElementById('adminArtisanModal');
  if (modal) modal.style.display = 'none';
}

function renderArtisansTable(artisans) {
  const tbody = document.getElementById('adminArtisansTableBody');
  if (!tbody) return;

  const query = (document.getElementById('adminArtisanSearchInput')?.value || '').toLowerCase().trim();

  let filtered = artisans || [];
  if (query) {
    filtered = filtered.filter(a => {
      const text = `${a.name || ''} ${a.shopName || ''} ${a.region || ''} ${a.category || ''}`.toLowerCase();
      return text.includes(query);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table-cell">No artisans found. Click "+ Add New Artisan" or "Seed Master Artisans" to add.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(a => {
    const tr = document.createElement('tr');
    const photoUrl = a.photo || a.avatar || 'images/emblem.svg';
    const statusClass = a.status === 'Inactive' || a.status === 'suspended' ? 'inactive' : 'active';
    const shopLink = `artisans.html?sellerId=${encodeURIComponent(a.id)}&sellerName=${encodeURIComponent(a.shopName || a.name)}`;

    tr.innerHTML = `
      <td>
        <img src="${photoUrl}" alt="${a.name}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid #dcd1be; background: #eee;" onerror="this.src='images/emblem.svg'">
      </td>
      <td>
        <strong>${a.name || 'Artisan Seller'}</strong>
        <div style="font-size: 11px; color: #888;">ID: ${a.id}</div>
      </td>
      <td>
        <span style="font-weight: 600; color: #1d4831;">${a.shopName || 'Workshop'}</span>
      </td>
      <td>${a.region || 'Philippines'}</td>
      <td><span class="role-badge" style="background:#eef7f0; color:#1d4831;">${a.category || 'Handicrafts'}</span></td>
      <td><span class="status-badge ${statusClass}">${a.status || 'Active'}</span></td>
      <td>
        <div class="row-actions" style="display: flex; gap: 6px; align-items: center;">
          <button type="button" class="action-btn edit edit-artisan-btn">Edit</button>
          <a href="${shopLink}" target="_blank" class="action-btn" style="text-decoration: none; padding: 4px 8px; font-size: 11.5px;">View Shop 🏬</a>
          <button type="button" class="action-btn delete delete-artisan-btn">Delete</button>
        </div>
      </td>
    `;

    // Edit button
    tr.querySelector('.edit-artisan-btn')?.addEventListener('click', () => {
      openArtisanModal(a);
    });

    // Delete button
    tr.querySelector('.delete-artisan-btn')?.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to permanently delete artisan "${a.name}" from the database?\n\nThis will purge their profile from Firestore and remove any products listed under their workshop.`)) {
        return;
      }
      try {
        await ArtisanDB.deleteArtisan(a.id, a.name);
        alert(`Artisan "${a.name}" and their listed products have been completely deleted from the database.`);
      } catch (err) {
        alert('Failed to delete artisan: ' + err.message);
      }
    });

    tbody.appendChild(tr);
  });
}

// ==========================================
// Admin: Seller Salary Payouts & Platform Fee System
// ==========================================
let allPayoutRecords = [];

function setupAdminPayoutsManagement() {
  const modal = document.getElementById('adminDisburseModal');
  const closeBtn = document.getElementById('closeAdminDisburseModalBtn');
  const cancelBtn = document.getElementById('cancelAdminDisburseBtn');
  const confirmBtn = document.getElementById('confirmDisburseBtn');
  const searchInput = document.getElementById('adminPayoutSearchInput');

  if (closeBtn) closeBtn.onclick = () => { if (modal) modal.style.display = 'none'; };
  if (cancelBtn) cancelBtn.onclick = () => { if (modal) modal.style.display = 'none'; };

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      const sellerId = document.getElementById('disburseSellerId').value;
      const monthKey = document.getElementById('disburseMonthKey').value;
      const netSalary = Number(document.getElementById('disburseNetSalary').value) || 0;
      const refNumber = document.getElementById('disburseRefNumber').value.trim();
      const notes = document.getElementById('disburseNotes').value.trim();

      if (!refNumber) {
        alert('Please provide the GCash reference / transaction number.');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Recording Disbursement...';

      try {
        const payoutKey = `${sellerId}_${monthKey}`;
        await ArtisanDB.disburseSellerPayout(payoutKey, {
          sellerId,
          monthKey,
          netSalary,
          referenceNumber: refNumber,
          notes,
          adminEmail: currentAdmin?.email || 'Administrator'
        });

        alert(`Salary payout of ₱${netSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })} successfully recorded as Disbursed!`);
        if (modal) modal.style.display = 'none';
      } catch (err) {
        alert('Failed to record disbursement: ' + err.message);
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Disbursement';
      }
    };
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderAdminPayouts();
    });
  }

  // Subscribe to live seller_payouts collection in Firestore
  if (typeof ArtisanDB.subscribeAllPayouts === 'function') {
    ArtisanDB.subscribeAllPayouts((records) => {
      allPayoutRecords = records || [];
      renderAdminPayouts();
    });
  }
}

function computeAllAdminPayouts() {
  const map = new Map();

  allOrders.forEach(o => {
    const d = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : (o.createdAt ? new Date(o.createdAt) : new Date());
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    if (Array.isArray(o.items) && o.items.length > 0) {
      o.items.forEach(it => {
        const sId = it.sellerId || (o.sellerIds && o.sellerIds[0]) || 'artisan_general';
        const key = `${sId}_${yearMonth}`;

        if (!map.has(key)) {
          const matchedArtisan = allArtisans.find(a => a.id === sId || a.name === it.sellerName);
          const matchedUser = allUsers.find(u => u.uid === sId || u.id === sId);

          map.set(key, {
            key,
            sellerId: sId,
            artisanName: matchedArtisan?.name || matchedUser?.name || it.sellerName || 'Verified Artisan',
            shopName: matchedArtisan?.shopName || matchedUser?.shopName || it.shopName || 'Artisan Workshop',
            gcashName: matchedArtisan?.gcashName || matchedUser?.name || '-',
            gcashNumber: matchedArtisan?.gcashNumber || matchedUser?.phone || '-',
            monthKey: yearMonth,
            monthLabel: monthLabel,
            grossSales: 0,
            orderCount: 0,
            orderNumbers: new Set()
          });
        }

        const entry = map.get(key);
        entry.grossSales += (Number(it.price || 0) * Number(it.quantity || 1));
        if (o.orderNumber || o.id) entry.orderNumbers.add(o.orderNumber || o.id);
      });
    } else {
      const sId = (o.sellerIds && o.sellerIds[0]) || 'artisan_general';
      const key = `${sId}_${yearMonth}`;
      if (!map.has(key)) {
        const matchedArtisan = allArtisans.find(a => a.id === sId);
        map.set(key, {
          key,
          sellerId: sId,
          artisanName: matchedArtisan?.name || 'Verified Artisan',
          shopName: matchedArtisan?.shopName || 'Artisan Workshop',
          gcashName: matchedArtisan?.gcashName || '-',
          gcashNumber: matchedArtisan?.gcashNumber || '-',
          monthKey: yearMonth,
          monthLabel: monthLabel,
          grossSales: 0,
          orderCount: 0,
          orderNumbers: new Set()
        });
      }
      const entry = map.get(key);
      entry.grossSales += Number(o.total || 0);
      if (o.orderNumber || o.id) entry.orderNumbers.add(o.orderNumber || o.id);
    }
  });

  const list = Array.from(map.values()).map(entry => {
    entry.orderCount = entry.orderNumbers.size || 1;
    entry.gatewayFee = Math.round(entry.grossSales * 0.02 * 100) / 100;
    entry.maintenanceFee = Math.round(entry.grossSales * 0.13 * 100) / 100;
    entry.totalDeductions = Math.round(entry.grossSales * 0.15 * 100) / 100;
    entry.netSalary = Math.round((entry.grossSales - entry.totalDeductions) * 100) / 100;

    const record = allPayoutRecords.find(r => r.id === entry.key || (r.sellerId === entry.sellerId && r.monthKey === entry.monthKey));
    if (record) {
      entry.status = record.status || 'Disbursed';
      entry.referenceNumber = record.referenceNumber || '';
      entry.disbursedAt = record.disbursedAt;
    } else {
      entry.status = entry.grossSales > 0 ? 'Pending Disbursement' : 'Zero Balance';
      entry.referenceNumber = '';
    }

    return entry;
  });

  list.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  return list;
}

function renderAdminPayouts() {
  const tbody = document.getElementById('adminPayoutsTableBody');
  if (!tbody) return;

  const payouts = computeAllAdminPayouts();

  const totalGross = payouts.reduce((acc, p) => acc + p.grossSales, 0);
  const totalGateway = payouts.reduce((acc, p) => acc + p.gatewayFee, 0);
  const totalMaint = payouts.reduce((acc, p) => acc + p.maintenanceFee, 0);
  const totalNet = payouts.reduce((acc, p) => acc + p.netSalary, 0);

  const elGross = document.getElementById('adminTotalGrossSales');
  const elGateway = document.getElementById('adminTotalGatewayFee');
  const elMaint = document.getElementById('adminTotalMaintFee');
  const elNet = document.getElementById('adminTotalNetSalaries');

  if (elGross) elGross.textContent = `₱${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (elGateway) elGateway.textContent = `₱${totalGateway.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (elMaint) elMaint.textContent = `₱${totalMaint.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (elNet) elNet.textContent = `₱${totalNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const searchVal = (document.getElementById('adminPayoutSearchInput')?.value || '').toLowerCase().trim();
  const filtered = searchVal ? payouts.filter(p => 
    (p.shopName || '').toLowerCase().includes(searchVal) ||
    (p.artisanName || '').toLowerCase().includes(searchVal) ||
    (p.monthLabel || '').toLowerCase().includes(searchVal)
  ) : payouts;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading-td">No seller salary payouts found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(p => {
    const tr = document.createElement('tr');
    const isDisbursed = p.status === 'Disbursed';
    const statusClass = isDisbursed ? 'delivered' : (p.grossSales > 0 ? 'processing' : 'unpaid-badge');

    tr.innerHTML = `
      <td>
        <strong>${p.shopName}</strong><br>
        <small style="color:#666;">${p.artisanName}</small>
      </td>
      <td><strong>${p.monthLabel}</strong></td>
      <td>${p.orderCount} order(s)</td>
      <td>₱${p.grossSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#b45309;">-₱${p.gatewayFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#4338ca;">-₱${p.maintenanceFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#dc2626; font-weight:600;">-₱${p.totalDeductions.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td style="color:#15803d; font-weight:bold; font-size:14px;">₱${p.netSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td>
        <strong>${p.gcashName}</strong><br>
        <code>${p.gcashNumber}</code>
      </td>
      <td>
        <span class="status-badge ${statusClass}">${p.status}</span>
        ${isDisbursed && p.referenceNumber ? `<br><small style="color:#666;">Ref: ${p.referenceNumber}</small>` : ''}
      </td>
      <td>
        ${!isDisbursed && p.grossSales > 0 ? `
          <button type="button" class="action-btn disburse-btn" style="background:#166534; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; white-space:nowrap;">
            Disburse via GCash
          </button>
        ` : `
          <small style="color:#15803d; font-weight:600;">✓ Completed</small>
        `}
      </td>
    `;

    if (!isDisbursed && p.grossSales > 0) {
      tr.querySelector('.disburse-btn')?.addEventListener('click', () => {
        openAdminDisburseModal(p);
      });
    }

    tbody.appendChild(tr);
  });
}

function openAdminDisburseModal(payout) {
  const modal = document.getElementById('adminDisburseModal');
  if (!modal) return;

  document.getElementById('disburseSellerId').value = payout.sellerId;
  document.getElementById('disburseMonthKey').value = payout.monthKey;
  document.getElementById('disburseNetSalary').value = payout.netSalary;
  document.getElementById('disburseShopName').textContent = `${payout.shopName} (${payout.artisanName})`;
  document.getElementById('disburseGcashAccount').textContent = `${payout.gcashName} - ${payout.gcashNumber}`;
  document.getElementById('disburseAmountDisplay').textContent = `₱${payout.netSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('disburseRefNumber').value = '';

  modal.style.display = 'flex';
}




