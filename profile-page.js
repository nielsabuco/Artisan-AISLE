import { ArtisanDB } from './firebase-config.js';
import { updateHeaderAuth } from './header-auth.js';

let currentUser = null;
let pendingAvatarData = null;

document.addEventListener('DOMContentLoaded', () => {
  initProfileAuth();
  setupEditModal();
  setupSellerAppModal();
  setupPasswordResetBtn();
});

function initProfileAuth() {
  ArtisanDB.onAuth(async (user) => {
    const authGuard = document.getElementById('profileAuthGuard');
    const profileContent = document.getElementById('activeProfileContent');

    if (!user || !user.uid) {
      if (authGuard) authGuard.style.display = 'block';
      if (profileContent) profileContent.style.display = 'none';
      return;
    }

    if (authGuard) authGuard.style.display = 'none';
    if (profileContent) profileContent.style.display = 'block';

    // Fetch fresh profile from Firestore
    currentUser = await ArtisanDB.getUserProfile(user.uid) || user;
    renderProfileData(currentUser);
    renderSellerStatusCard(currentUser);
    loadNotifications(currentUser.uid);
    loadProfileOrders(currentUser.uid);
  });
}

function renderProfileData(user) {
  if (!user) return;

  const defaultAvatar = 'images/emblem.svg';
  const avatarUrl = user.avatar || user.photoURL || defaultAvatar;

  const avatarImg = document.getElementById('userAvatarImg');
  if (avatarImg) {
    avatarImg.src = avatarUrl;
    avatarImg.onerror = () => { avatarImg.src = defaultAvatar; };
  }

  document.getElementById('userNameDisplay').textContent = user.name || 'Artisan User';
  document.getElementById('userEmailDisplay').textContent = user.email || '';
  
  // Role Badge
  const roleBadge = document.getElementById('userRoleBadge');
  if (roleBadge) {
    const role = (user.role || 'user').toLowerCase();
    roleBadge.textContent = role.toUpperCase();
    roleBadge.className = `role-badge ${role}`;
  }

  // Pills & Details
  document.getElementById('userPhonePill').textContent = user.phone ? `📞 ${user.phone}` : 'No phone registered';
  document.getElementById('userAddressPill').textContent = user.address ? `📍 ${user.address}${user.city ? ', ' + user.city : ''}` : 'No delivery address';

  document.getElementById('detailFullName').textContent = user.name || '-';
  document.getElementById('detailEmail').textContent = user.email || '-';
  document.getElementById('detailPhone').textContent = user.phone || 'None provided';
  document.getElementById('detailAddress').textContent = user.address ? `${user.address}${user.city ? ', ' + user.city : ''}` : 'None provided';
  
  const isAdmin = String(user.role || '').toLowerCase() === 'admin' || (window.ArtisanDB && window.ArtisanDB.isEmailAdmin(user.email));
  const isSeller = String(user.role || '').toLowerCase() === 'seller' || (user.sellerStatus || '').toLowerCase() === 'approved';
  const roleTitle = isAdmin ? 'Platform Administrator' : (isSeller ? 'Verified Artisan Seller' : 'Registered Customer');
  document.getElementById('detailRole').textContent = roleTitle;
}

function renderSellerStatusCard(user) {
  const badge = document.getElementById('sellerStatusBadge');
  const body = document.getElementById('sellerStatusContent');
  if (!badge || !body) return;

  const status = (user.sellerStatus || 'none').toLowerCase();

  if (status === 'approved') {
    badge.textContent = 'Approved Seller';
    badge.className = 'status-badge delivered';
    body.innerHTML = `
      <div class="seller-banner approved-banner">
        <div class="banner-icon">✓</div>
        <div class="banner-text">
          <h3>Your Seller Account is Active</h3>
          <p>Congratulations! Your seller application has been approved. You can now manage your catalog, list new handcrafted items, and fulfill incoming orders.</p>
        </div>
      </div>
      <div class="seller-actions-row" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
        <a href="seller.html?view=add-product" class="primary-btn" style="text-decoration: none; background: #285c3b;">+ List New Product</a>
        <a href="seller.html?view=products" class="secondary-btn" style="text-decoration: none;">Manage Products</a>
        <a href="seller.html" class="secondary-btn" style="text-decoration: none;">Seller Portal Dashboard</a>
      </div>
    `;
  } else if (status === 'pending') {
    badge.textContent = 'Under Review';
    badge.className = 'status-badge processing';
    body.innerHTML = `
      <div class="seller-banner pending-banner">
        <div class="banner-icon">⏳</div>
        <div class="banner-text">
          <h3>Application Pending Administrator Review</h3>
          <p>Your application for <strong>"${user.pendingShopName || 'your artisan shop'}"</strong> has been received. Our administrative team will review your submitted credentials. Once approved, you will receive your temporary login credentials via email to set your new permanent password and access the Seller Portal.</p>
        </div>
      </div>
      <p class="helper-text">Privileges are restricted until administrator approval is granted.</p>
    `;
  } else if (status === 'rejected') {
    badge.textContent = 'Application Rejected';
    badge.className = 'status-badge unpaid-badge';
    const reason = user.sellerRejectionReason || 'Submitted details did not meet marketplace requirements.';
    body.innerHTML = `
      <div class="seller-banner rejected-banner">
        <div class="banner-icon">✕</div>
        <div class="banner-text">
          <h3>Application Not Approved</h3>
          <p><strong>Administrator Feedback:</strong> ${reason}</p>
          <p>Please update your details and submit a new application when ready.</p>
        </div>
      </div>
      <div class="seller-actions-row">
        <button type="button" class="primary-btn" id="openReapplyModalBtn">Re-apply as Seller</button>
      </div>
    `;
    document.getElementById('openReapplyModalBtn')?.addEventListener('click', () => {
      document.getElementById('sellerApplicationModal').style.display = 'flex';
    });
  } else {
    badge.textContent = 'Not Applied';
    badge.className = 'status-badge';
    body.innerHTML = `
      <div class="seller-banner intro-banner">
        <div class="banner-icon">✨</div>
        <div class="banner-text">
          <h3>Sell Your Handcrafted Treasures</h3>
          <p>Connect with Filipino buyers across the archipelago. Share traditional craftsmanship, manage your personal shop, receive direct GCash payments, and track fulfillment.</p>
        </div>
      </div>
      <div class="seller-actions-row">
        <button type="button" class="primary-btn" id="openSellerApplyModalBtn">Apply as Seller</button>
      </div>
    `;
    document.getElementById('openSellerApplyModalBtn')?.addEventListener('click', () => {
      document.getElementById('sellerApplicationModal').style.display = 'flex';
    });
  }
}

function setupEditModal() {
  const modal = document.getElementById('editProfileModal');
  const openBtn = document.getElementById('openEditProfileModalBtn');
  const avatarIconBtn = document.getElementById('avatarEditIconBtn');
  const directFileInput = document.getElementById('directAvatarFileInput');
  const closeBtn = document.getElementById('closeEditProfileModalBtn');
  const cancelBtn = document.getElementById('cancelEditProfileBtn');
  const fileInput = document.getElementById('avatarFileInput');
  const urlInput = document.getElementById('avatarUrlInput');
  const previewImg = document.getElementById('editAvatarPreview');
  const form = document.getElementById('editProfileForm');

  // Direct Avatar Photo Change: clicking camera icon opens file selector directly!
  avatarIconBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (directFileInput) {
      directFileInput.click();
    } else {
      openModal();
    }
  });

  directFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !currentUser.uid) return;

    try {
      const optimized = await ArtisanDB.uploadImage(file, 600);
      const avatarImg = document.getElementById('userAvatarImg');
      if (avatarImg) avatarImg.src = optimized;

      const updates = { avatar: optimized, photoURL: optimized };
      await ArtisanDB.updateUserProfile(currentUser.uid, updates);
      currentUser = { ...currentUser, ...updates };

      renderProfileData(currentUser);
      updateHeaderAuth();
      alert('Profile picture updated successfully!');
    } catch (err) {
      alert('Unable to update profile picture: ' + err.message);
    }
  });

  const openModal = () => {
    if (!currentUser) return;
    pendingAvatarData = null;
    document.getElementById('editFullName').value = currentUser.name || '';
    document.getElementById('editPhone').value = currentUser.phone || '';
    document.getElementById('editAddress').value = currentUser.address || '';
    document.getElementById('editCity').value = currentUser.city || '';
    if (urlInput) urlInput.value = '';
    
    const currentAvatar = currentUser.avatar || currentUser.photoURL || 'images/emblem.svg';
    if (previewImg) previewImg.src = currentAvatar;

    modal.style.display = 'flex';
  };

  const closeModal = () => {
    modal.style.display = 'none';
    pendingAvatarData = null;
    if (urlInput) urlInput.value = '';
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  // Avatar file input handler inside modal
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const optimized = await ArtisanDB.uploadImage(file, 600);
      pendingAvatarData = optimized;
      if (previewImg) previewImg.src = optimized;
    } catch (err) {
      alert('Unable to process image. Please choose another file.');
    }
  });

  // Avatar URL input handler inside modal
  urlInput?.addEventListener('input', () => {
    const url = urlInput.value.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      pendingAvatarData = url;
      if (previewImg) previewImg.src = url;
    }
  });

  // Save changes handler
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || !currentUser.uid) return;

    const saveBtn = document.getElementById('saveProfileChangesBtn');
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-text').textContent = 'Saving...';
    saveBtn.querySelector('.btn-spinner').style.display = 'inline-block';

    try {
      const updates = {
        name: document.getElementById('editFullName').value.trim(),
        phone: document.getElementById('editPhone').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        city: document.getElementById('editCity').value.trim()
      };

      if (pendingAvatarData) {
        updates.avatar = pendingAvatarData;
        updates.photoURL = pendingAvatarData;
      }

      await ArtisanDB.updateUserProfile(currentUser.uid, updates);
      currentUser = { ...currentUser, ...updates };

      renderProfileData(currentUser);
      updateHeaderAuth();
      closeModal();
    } catch (err) {
      alert('Failed to save profile changes. Please try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.querySelector('.btn-text').textContent = 'Save Changes';
      saveBtn.querySelector('.btn-spinner').style.display = 'none';
    }
  });
}

function setupSellerAppModal() {
  const modal = document.getElementById('sellerApplicationModal');
  const closeBtn = document.getElementById('closeSellerModalBtn');
  const cancelBtn = document.getElementById('cancelSellerAppBtn');
  const form = document.getElementById('sellerApplicationForm');

  const closeModal = () => {
    modal.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || !currentUser.uid) {
      alert('Please log in first to submit an application.');
      return;
    }

    const submitBtn = document.getElementById('submitSellerAppBtn');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'Submitting...';
    submitBtn.querySelector('.btn-spinner').style.display = 'inline-block';

    try {
      const payload = {
        userId: currentUser.uid,
        applicantName: currentUser.name || '',
        email: currentUser.email || '',
        phone: document.getElementById('appGcashNumber').value.trim(),
        shopName: document.getElementById('appShopName').value.trim(),
        category: document.getElementById('appCategory').value,
        craftStory: document.getElementById('appCraftStory').value.trim(),
        gcashName: document.getElementById('appGcashName').value.trim(),
        gcashNumber: document.getElementById('appGcashNumber').value.trim(),
        govId: document.getElementById('appGovId').value.trim()
      };

      await ArtisanDB.submitSellerApplication(payload);

      currentUser.sellerStatus = 'pending';
      currentUser.pendingShopName = payload.shopName;

      renderSellerStatusCard(currentUser);
      closeModal();
      alert('Your seller application has been submitted to the admin for review.');
    } catch (err) {
      alert('Failed to submit application: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn-text').textContent = 'Submit Application to Admin';
      submitBtn.querySelector('.btn-spinner').style.display = 'none';
    }
  });
}

function loadNotifications(userId) {
  const container = document.getElementById('notificationsList');
  const countBadge = document.getElementById('notifCountBadge');
  if (!container) return;

  ArtisanDB.subscribeNotifications(userId, (notifs) => {
    if (!notifs || notifs.length === 0) {
      container.innerHTML = '<p class="empty-muted">No new notifications.</p>';
      if (countBadge) countBadge.textContent = '0 alerts';
      return;
    }

    if (countBadge) countBadge.textContent = `${notifs.length} alert${notifs.length > 1 ? 's' : ''}`;
    container.innerHTML = '';

    notifs.forEach(n => {
      const card = document.createElement('div');
      card.className = 'notif-item-card';
      const dateStr = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

      card.innerHTML = `
        <div class="notif-header">
          <strong>${n.title || 'Notification'}</strong>
          <small>${dateStr}</small>
        </div>
        <p class="notif-body">${n.message || ''}</p>
      `;
      container.appendChild(card);
    });
  });
}

function loadProfileOrders(userId) {
  const container = document.getElementById('profileRecentOrdersList');
  if (!container) return;

  ArtisanDB.subscribeUserOrders(userId, (orders) => {
    if (!orders || orders.length === 0) {
      container.innerHTML = `
        <p class="empty-muted" style="text-align: center; padding: 16px;">
          You haven't placed any handcrafted orders yet. 
          <a href="products.html" style="color: #285c3b; font-weight: 600; text-decoration: underline; margin-left: 6px;">Browse Artisan Products</a>
        </p>
      `;
      return;
    }

    container.innerHTML = '';
    orders.slice(0, 4).forEach(order => {
      const statusClass = (order.orderStatus || 'processing').toLowerCase();
      
      const itemEl = document.createElement('div');
      itemEl.style.cssText = 'background: #fdfcf9; border: 1px solid #ebd9c2; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;';
      
      itemEl.innerHTML = `
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <strong style="color: #285c3b; font-size: 14px;">${order.orderNumber || order.id}</strong>
            <span class="status-badge ${statusClass}">${order.orderStatus || 'Processing'}</span>
          </div>
          <p style="margin: 0; font-size: 13px; color: #555;">
            ${(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Handcrafted items'}
          </p>
          <div style="font-size: 12px; color: #777; margin-top: 4px;">
            Courier: <strong>${order.courier || 'Local Logistics'}</strong> • 
            Tracking: <strong>${order.trackingNumber ? `<code>${order.trackingNumber}</code>` : 'Pending pickup'}</strong>
            ${order.currentLocation ? ` • Location: <span style="color:#285c3b; font-weight:600;">📍 ${order.currentLocation}</span>` : ''}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 15px; font-weight: 700; color: #285c3b; margin-bottom: 6px;">
            ₱${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
            ${(order.items && order.items.length > 0) ? `
              <a href="review.html?orderId=${order.id}&productId=${order.items[0].productId || order.items[0].id || ''}&productName=${encodeURIComponent(order.items[0].name || '')}" class="secondary-btn" style="padding: 5px 12px; font-size: 12px; text-decoration: none; border-radius: 6px; border-color: #c88937; color: #1d4831; font-weight: 600;">
                ⭐ Review Craft
              </a>
            ` : ''}
            <a href="cart.html#orders" class="secondary-btn" style="padding: 5px 12px; font-size: 12px; text-decoration: none; border-radius: 6px;">
              Tracking Stepper →
            </a>
          </div>
        </div>
      `;
      container.appendChild(itemEl);
    });
  });
}

function setupPasswordResetBtn() {
  const resetBtn = document.getElementById('sendProfilePasswordResetBtn');
  resetBtn?.addEventListener('click', async () => {
    const email = currentUser?.email;
    if (!email) {
      alert('No email address associated with your current session.');
      return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Sending link...';

    try {
      await ArtisanDB.sendPasswordReset(email);
      alert(`Password setup link has been sent to ${email}!\n\nIMPORTANT: If you do not see it in your Inbox within a minute, please check your SPAM, JUNK, or PROMOTIONS folder.`);
    } catch (err) {
      alert('Could not dispatch password reset: ' + err.message);
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Send Password Reset Link to Email';
    }
  });
}


