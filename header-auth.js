import { ArtisanDB } from './firebase-config.js';
import { attachHeaderInstallBtn } from './pwa-install.js';

export function updateHeaderAuth() {
  const headerLinks = document.querySelector('.header-links');
  if (!headerLinks) return;

  // Ensure Install App button is present in header
  attachHeaderInstallBtn();

  const user = ArtisanDB.getLocalUser();
  const cart = ArtisanDB.getCart();
  const totalItems = cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

  // 1. Update or create cart link with modern SVG icon (not emoji, not text)
  let cartLink = headerLinks.querySelector('a[href*="cart"]');
  if (!cartLink) {
    cartLink = document.createElement('a');
    cartLink.href = 'cart.html';
    headerLinks.prepend(cartLink);
  } else {
    cartLink.href = 'cart.html';
  }
  cartLink.className = 'header-cart-btn';
  cartLink.setAttribute('aria-label', `Shopping Cart (${totalItems} items)`);
  cartLink.setAttribute('title', 'Shopping Cart');
  cartLink.innerHTML = `
    <svg class="header-cart-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="21" r="1"></circle>
      <circle cx="20" cy="21" r="1"></circle>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>
    <span class="cart-badge">${totalItems}</span>
  `;

  // 2. Remove legacy login/order/profile buttons (avoid duplicate Profile button when user avatar is present)
  const existingUserMenu = headerLinks.querySelector('.user-header-menu');
  if (existingUserMenu) existingUserMenu.remove();

  const oldAuthLinks = headerLinks.querySelectorAll('a[href*="login"], a[href*="create-account"], a[href*="orders"], a[href*="profile"], #loginButton, #headerProfileBtn');
  oldAuthLinks.forEach(el => el.remove());

  // 3. Render authenticated user dropdown/links or guest buttons
  if (user && user.uid) {
    const userMenu = document.createElement('div');
    userMenu.className = 'user-header-menu';

    const isAdmin = String(user.role || '').toLowerCase() === 'admin' || (ArtisanDB.isEmailAdmin && ArtisanDB.isEmailAdmin(user.email));
    const isSeller = String(user.role || '').toLowerCase() === 'seller' || String(user.sellerStatus || '').toLowerCase() === 'approved';

    const roleBadge = isAdmin 
      ? '<span class="header-role-badge admin">Admin</span>' 
      : (isSeller ? '<span class="header-role-badge seller">Seller</span>' : '');

    const avatarUrl = user.avatar || user.photoURL || 'images/emblem.svg';
    const displayName = (user.name || (user.email ? user.email.split('@')[0] : 'User')).split(' ')[0];

    userMenu.innerHTML = `
      <div class="user-pill" id="userPill">
        <img class="header-avatar" src="${avatarUrl}" alt="${displayName}" />
        <span class="user-name">${displayName}</span>
        ${roleBadge}
      </div>
      <div class="user-dropdown" id="userDropdown">
        <div class="user-dropdown-header">
          <strong>${user.name || 'Artisan User'}</strong>
          <small>${user.email}</small>
        </div>
        <a href="profile.html" class="dropdown-item">My Profile</a>
        <a href="cart.html#orders" class="dropdown-item">My Orders</a>
        ${isSeller ? '<a href="seller.html?view=add-product" class="dropdown-item portal-item">+ List New Product</a>' : ''}
        ${isSeller ? '<a href="seller.html" class="dropdown-item portal-item">Seller Portal</a>' : ''}
        ${isAdmin ? '<a href="admin.html" class="dropdown-item admin-item">Admin Portal</a>' : ''}
        <button type="button" class="dropdown-item logout-btn" id="headerLogoutBtn">Logout</button>
      </div>
    `;

    headerLinks.appendChild(userMenu);

    const userPill = userMenu.querySelector('#userPill');
    const userDropdown = userMenu.querySelector('#userDropdown');
    userPill.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      userDropdown.classList.remove('active');
    });

    const logoutBtn = userMenu.querySelector('#headerLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await ArtisanDB.logoutUser();
        window.location.href = 'index.html';
      });
    }
  } else {
    // Guest links
    const loginLink = document.createElement('a');
    loginLink.href = 'login.html';
    loginLink.className = 'header-btn-link';
    loginLink.textContent = 'Login';

    const registerLink = document.createElement('a');
    registerLink.href = 'create-account.html';
    registerLink.className = 'header-btn-link register';
    registerLink.textContent = 'Register';

    headerLinks.appendChild(loginLink);
    headerLinks.appendChild(registerLink);
  }
}

// Global Toast for Add to Cart
export function showCartToast(message = 'Item added to cart') {
  let toast = document.getElementById('artisanGlobalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'artisanGlobalToast';
    toast.className = 'artisan-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <span>${message}</span>
    <a href="cart.html" class="toast-link">View Cart</a>
  `;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// Global addToCart helper with toast
export function handleAddToCart(product, quantity = 1) {
  ArtisanDB.addToCart(product, quantity);
  showCartToast(`Added <strong>${product.name}</strong> to cart!`);
}

window.handleAddToCart = handleAddToCart;

// Initialize on load and listen to auth/cart updates
document.addEventListener('DOMContentLoaded', () => {
  updateHeaderAuth();
  ArtisanDB.onAuth(() => {
    updateHeaderAuth();
  });
  window.addEventListener('artisan-cart-updated', () => {
    updateHeaderAuth();
  });
});
