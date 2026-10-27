import { ArtisanDB } from './firebase-config.js';
import { handleAddToCart, updateHeaderAuth } from './header-auth.js';

let liveProducts = [];
let activeCategory = 'All Products';

const grid = document.getElementById('productGrid');
const searchInput = document.getElementById('productSearch');
const countLabel = document.getElementById('productsCountLabel');

if (searchInput) {
  searchInput.value = new URLSearchParams(window.location.search).get('search') || '';
}

document.addEventListener('DOMContentLoaded', () => {
  setupCategoryFilters();
  setupSearch();
  startProductsSubscription();
});

function startProductsSubscription() {
  ArtisanDB.subscribeProducts((products) => {
    // Only display active products that are not deleted
    liveProducts = products.filter(p => !p.deleted && p.status !== 'Hidden');
    renderProducts();
  });
}

function renderProducts() {
  if (!grid) return;
  const query = (searchInput?.value || '').trim().toLowerCase();

  const filtered = liveProducts.filter(product => {
    const matchesCategory = activeCategory === 'All Products' || (product.category || '').toLowerCase() === activeCategory.toLowerCase();
    const searchTarget = `${product.name || ''} ${product.category || ''} ${product.sellerName || ''} ${product.description || ''}`.toLowerCase();
    const matchesSearch = !query || searchTarget.includes(query);
    return matchesCategory && matchesSearch;
  });

  if (countLabel) {
    countLabel.textContent = `Showing ${filtered.length} authentic handcrafted product${filtered.length === 1 ? '' : 's'}`;
  }

  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🔍</div>
        <h2>No Products Found</h2>
        <p>No handcrafted items matched "${query || activeCategory}". Try searching for another term or browse all categories.</p>
        <button type="button" class="primary-btn" id="resetFiltersBtn">Reset Filters</button>
      </div>
    `;
    document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
      activeCategory = 'All Products';
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.category === 'All Products'));
      renderProducts();
    });
    return;
  }

  filtered.forEach(product => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.dataset.category = product.category || 'General';

    const stock = Number(product.stock) || 0;
    const isOutOfStock = stock <= 0;
    const stockBadge = isOutOfStock
      ? '<span class="stock-pill out-of-stock">Out of Stock</span>'
      : (stock <= 3 ? `<span class="stock-pill low-stock">Only ${stock} left</span>` : `<span class="stock-pill in-stock">${stock} in stock</span>`);

    const defaultImage = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=500&q=80';
    const imageUrl = product.image || defaultImage;
    const priceFormatted = `₱${Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    card.innerHTML = `
      <div class="product-thumb-wrap">
        <img src="${imageUrl}" alt="${product.name}" loading="lazy" onerror="this.src='${defaultImage}'">
        ${stockBadge}
      </div>
      <div class="product-info">
        <span class="product-card-category">${product.category || 'Handicrafts'}</span>
        <h3 class="product-card-title">${product.name}</h3>
        <p class="product-card-artisan">By <strong>${product.sellerName || 'Artisan Partner'}</strong></p>
        <div class="product-card-pricing">
          <span class="price-val">${priceFormatted}</span>
        </div>
        <div class="product-card-actions">
          <button type="button" class="primary-btn add-to-cart-btn" ${isOutOfStock ? 'disabled' : ''}>
            ${isOutOfStock ? 'Sold Out' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;

    // Add to Cart Action
    const addBtn = card.querySelector('.add-to-cart-btn');
    if (addBtn && !isOutOfStock) {
      addBtn.addEventListener('click', () => {
        handleAddToCart(product, 1);
        addBtn.textContent = 'Added!';
        setTimeout(() => {
          addBtn.textContent = 'Add to Cart';
        }, 1200);
      });
    }

    grid.appendChild(card);
  });
}

function setupCategoryFilters() {
  const buttons = document.querySelectorAll('.cat-filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

function setupSearch() {
  document.getElementById('searchButton')?.addEventListener('click', renderProducts);
  searchInput?.addEventListener('input', renderProducts);
}
