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
    liveProducts = products.filter(p => !p.deleted && p.status !== 'Hidden' && p.status !== 'Inactive' && p.status !== 'Suspended');
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

    card.style.cursor = 'pointer';
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
          <button type="button" class="action-btn view-details-btn">
            View Details
          </button>
          <button type="button" class="primary-btn add-to-cart-btn" ${isOutOfStock ? 'disabled' : ''}>
            ${isOutOfStock ? 'Sold Out' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;

    // Click card or view details to open modal
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add-to-cart-btn')) return;
      openQuickView(product);
    });

    // Add to Cart Action
    const addBtn = card.querySelector('.add-to-cart-btn');
    if (addBtn && !isOutOfStock) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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

let activeModalProduct = null;
let activeModalQty = 1;

function setupQuickViewModal() {
  const modal = document.getElementById('productQuickViewModal');
  const closeBtn = document.getElementById('closeQuickViewModalBtn');
  const minusBtn = document.getElementById('quickViewQtyMinus');
  const plusBtn = document.getElementById('quickViewQtyPlus');
  const addCartBtn = document.getElementById('quickViewAddCartBtn');
  const buyNowBtn = document.getElementById('quickViewBuyNowBtn');

  if (!modal) return;

  const closeModal = () => {
    modal.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  minusBtn?.addEventListener('click', () => {
    if (activeModalQty > 1) {
      activeModalQty--;
      document.getElementById('quickViewQuantity').textContent = activeModalQty;
    }
  });

  plusBtn?.addEventListener('click', () => {
    const stock = Number(activeModalProduct?.stock || 99);
    if (activeModalQty < stock) {
      activeModalQty++;
      document.getElementById('quickViewQuantity').textContent = activeModalQty;
    } else {
      alert(`Only ${stock} items available in stock.`);
    }
  });

  addCartBtn?.addEventListener('click', () => {
    if (!activeModalProduct) return;
    handleAddToCart(activeModalProduct, activeModalQty);
    addCartBtn.textContent = 'Added to Cart!';
    setTimeout(() => {
      addCartBtn.textContent = 'Add to Cart';
      closeModal();
    }, 1000);
  });

  buyNowBtn?.addEventListener('click', () => {
    if (!activeModalProduct) return;
    handleAddToCart(activeModalProduct, activeModalQty);
    window.location.href = 'cart.html';
  });
}

function openQuickView(product) {
  const modal = document.getElementById('productQuickViewModal');
  if (!modal || !product) return;

  activeModalProduct = product;
  activeModalQty = 1;

  document.getElementById('quickViewName').textContent = product.name;
  document.getElementById('quickViewPrice').textContent = `₱${Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('quickViewCategory').textContent = (product.category || 'Handicrafts').toUpperCase();
  document.getElementById('quickViewDesc').textContent = product.description || 'Authentic handcrafted item created by dedicated local artisans.';
  document.getElementById('quickViewSellerName').textContent = product.sellerName || 'Artisan Partner';
  document.getElementById('quickViewSellerInitial').textContent = (product.sellerName || 'A').charAt(0).toUpperCase();
  document.getElementById('quickViewQuantity').textContent = activeModalQty;

  const rVal = Number(product.rating || 5).toFixed(1);
  const rCount = Number(product.reviewsCount || product.reviews || 0);
  const ratingBlock = document.getElementById('productsQuickViewRating');
  if (ratingBlock) {
    ratingBlock.innerHTML = `
      <span style="color:#c88937;">★★★★★</span>
      <strong style="color:#1d4831; margin-left:4px;">${rVal}</strong>
      <span style="color:#666; font-size:12.5px; margin-left:4px;">(${rCount > 0 ? rCount + ' reviews' : 'Verified'})</span>
      <a href="review.html?productId=${product.id || ''}&productName=${encodeURIComponent(product.name)}" style="margin-left:10px; color:#1d4831; font-weight:700; font-size:12px; text-decoration:underline;">
        ★ Write a Review
      </a>
    `;
    ratingBlock.onclick = (e) => {
      if (e.target.tagName === 'A') return;
      openProductReviewsList(product.id, product.name);
    };
  }

  const reviewsCountEl = document.getElementById('productsQuickViewReviewsCount');
  if (reviewsCountEl) reviewsCountEl.textContent = rCount;

  const reviewsBtn = document.getElementById('productsQuickViewReviewsBtn');
  if (reviewsBtn) {
    reviewsBtn.onclick = () => openProductReviewsList(product.id, product.name);
  }

  const defaultImg = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=500&q=80';
  const imgEl = document.getElementById('quickViewImage');
  if (imgEl) {
    imgEl.src = product.image || defaultImg;
    imgEl.onerror = () => { imgEl.src = defaultImg; };
  }

  const stock = Number(product.stock) || 0;
  const stockIndicator = document.getElementById('quickViewStockIndicator');
  const addCartBtn = document.getElementById('quickViewAddCartBtn');
  const buyNowBtn = document.getElementById('quickViewBuyNowBtn');

  if (stock <= 0) {
    stockIndicator.textContent = 'Out of Stock';
    stockIndicator.style.color = '#c53030';
    if (addCartBtn) {
      addCartBtn.disabled = true;
      addCartBtn.textContent = 'Sold Out';
    }
    if (buyNowBtn) buyNowBtn.disabled = true;
  } else {
    stockIndicator.textContent = `In Stock (${stock} available)`;
    stockIndicator.style.color = 'green';
    if (addCartBtn) {
      addCartBtn.disabled = false;
      addCartBtn.textContent = 'Add to Cart';
    }
    if (buyNowBtn) buyNowBtn.disabled = false;
  }

  modal.style.display = 'flex';
}

function setupCategoryFilters() {
  const buttons = document.querySelectorAll('.cat-filter-btn');
  const mobileToggleBtn = document.getElementById('mobileFilterToggleBtn');
  const mobileLabel = document.getElementById('mobileFilterCurrentLabel');
  const sidebar = document.getElementById('categoriesSidebar');

  if (mobileToggleBtn && sidebar) {
    mobileToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('mobile-open');
      const isOpen = sidebar.classList.contains('mobile-open');
      mobileToggleBtn.setAttribute('aria-expanded', String(isOpen));
    });

    // Close when tapping outside on mobile
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && !mobileToggleBtn.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
        mobileToggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      if (mobileLabel) mobileLabel.textContent = activeCategory;
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (mobileToggleBtn) mobileToggleBtn.setAttribute('aria-expanded', 'false');
      renderProducts();
    });
  });
}

function setupSearch() {
  document.getElementById('searchButton')?.addEventListener('click', renderProducts);
  searchInput?.addEventListener('input', renderProducts);
}

// Hook setupQuickViewModal on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupQuickViewModal();
  setupReviewsModal();
});

let currentReviewsListProductId = null;

function setupReviewsModal() {
  const closeBtn = document.getElementById('closeReviewsListModalBtn');
  const modal = document.getElementById('productReviewsListModal');
  const writeBtn = document.getElementById('reviewsModalWriteReviewBtn');

  closeBtn?.addEventListener('click', closeProductReviewsList);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeProductReviewsList();
  });
  writeBtn?.addEventListener('click', () => {
    closeProductReviewsList();
    if (currentReviewsListProductId) {
      window.location.href = `review.html?productId=${currentReviewsListProductId}`;
    }
  });
}

async function openProductReviewsList(productId, productName) {
  currentReviewsListProductId = productId || activeModalProduct?.id;
  const modal = document.getElementById('productReviewsListModal');
  const container = document.getElementById('productReviewsListContainer');
  const subtitle = document.getElementById('reviewsModalProductSubtitle');
  const scoreEl = document.getElementById('reviewsModalAvgScore');
  const starsEl = document.getElementById('reviewsModalStars');
  const countEl = document.getElementById('reviewsModalTotalCount');

  if (!modal) return;
  modal.style.display = 'flex';

  if (subtitle) {
    subtitle.textContent = productName ? `Reviews for "${productName}"` : 'Verified Artisan Reviews';
  }

  if (container) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#666;">Loading verified reviews...</div>';
  }

  try {
    let reviews = [];
    if (ArtisanDB?.getProductReviews && currentReviewsListProductId) {
      reviews = await ArtisanDB.getProductReviews(currentReviewsListProductId);
    }

    const count = reviews.length;
    const total = reviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0);
    const avg = count > 0 ? (total / count).toFixed(1) : '5.0';

    if (scoreEl) scoreEl.textContent = avg;
    if (countEl) countEl.textContent = `Based on ${count} verified review${count === 1 ? '' : 's'}`;
    if (starsEl) {
      const rounded = Math.round(Number(avg));
      starsEl.textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
    }

    if (reviews.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px 16px; background:#fff; border-radius:10px; border:1px dashed #dcd1be;">
          <div style="font-size:32px; margin-bottom:8px;">🌿</div>
          <h3 style="font-size:16px; color:#1d4831; margin:0 0 6px;">No Customer Reviews Yet</h3>
          <p style="font-size:13px; color:#666; margin:0 0 16px;">Be the first verified buyer to experience this craft and share your feedback!</p>
          <a href="review.html?productId=${currentReviewsListProductId}" class="primary-btn" style="display:inline-block; padding:8px 18px; font-size:13px; text-decoration:none;">★ Write First Review</a>
        </div>
      `;
      return;
    }

    container.innerHTML = reviews.map(r => {
      const rScore = Number(r.rating) || 5;
      const starText = '★'.repeat(rScore) + '☆'.repeat(5 - rScore);
      const dateStr = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (r.date || 'Verified Purchase');
      const initial = (r.reviewerName || 'Customer').charAt(0).toUpperCase();

      return `
        <div class="review-item-card">
          <div class="review-item-header">
            <div class="reviewer-meta-box">
              <div class="reviewer-avatar-circle">${initial}</div>
              <div>
                <div class="reviewer-name-line">
                  ${r.reviewerName || 'Artisan Patron'}
                  <span class="verified-order-badge">✓ Verified Buyer</span>
                </div>
                <div class="review-date-text">${dateStr}</div>
              </div>
            </div>
            <div class="review-stars-row">${starText}</div>
          </div>
          ${r.headline ? `<div class="review-headline-text">${r.headline}</div>` : ''}
          <div class="review-comment-text">${r.comment || ''}</div>
          ${r.recommend !== false ? `<div class="review-recommend-badge">👍 Recommends this handcrafted craft</div>` : ''}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading product reviews:', err);
    if (container) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:#c53030;">Unable to load reviews right now.</div>';
    }
  }
}

function closeProductReviewsList() {
  const modal = document.getElementById('productReviewsListModal');
  if (modal) modal.style.display = 'none';
}

window.openProductReviewsList = openProductReviewsList;
window.closeProductReviewsList = closeProductReviewsList;

