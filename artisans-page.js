// artisans-page.js - Master Artisans Directory and Dedicated Artisan Shop Page

import { ArtisanDB } from './firebase-config.js';
import { handleAddToCart } from './header-auth.js';

// Default / Featured Master Philippine Artisans
const DEFAULT_ARTISANS = [
  {
    id: 'artisan-jerusalem',
    name: 'Eugene Marciene M. Jerusalem',
    shopName: 'Bicol Heritage Weavers',
    region: 'Albay, Bicol (Luzon)',
    category: 'Traditional Handloom Weaving & Abaca Bags',
    bio: 'Preserving over three generations of authentic Bicolano abaca weaving. Each bag, basket, and runner is crafted with natural fiber sustainably harvested in Albay.',
    photo: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
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
    status: 'Active',
    verified: true
  }
];

let allArtisans = [];
let allProducts = [];
let selectedRegion = 'all';
let searchQuery = '';
let activeQuickViewProduct = null;
let quickViewQuantity = 1;

let liveFirestoreSellers = [];
let liveDeletedArtisanIds = new Set();
let hasReceivedSellersSnapshot = false;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initSubscriptions();
});

function setupEventListeners() {
  // Region filter pills
  const pills = document.querySelectorAll('.artisan-filter-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedRegion = pill.dataset.region || 'all';
      renderArtisansGrid();
    });
  });

  // Search input filter
  const searchInput = document.getElementById('artisanFilterInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderArtisansGrid();
    });
  }

  // Global search bar in header
  const globalSearch = document.getElementById('globalArtisanSearch');
  const globalBtn = document.getElementById('globalSearchBtn');
  if (globalSearch && globalBtn) {
    const doGlobalSearch = () => {
      const q = globalSearch.value.trim().toLowerCase();
      if (q) {
        searchQuery = q;
        if (searchInput) searchInput.value = q;
        switchToDirectoryView();
        renderArtisansGrid();
      }
    };
    globalBtn.addEventListener('click', doGlobalSearch);
    globalSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doGlobalSearch();
    });
  }

  // Back button from shop view
  const backBtn = document.getElementById('backToArtisansBtn');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', 'artisans.html');
      switchToDirectoryView();
    });
  }

  // Quick view modal controls
  setupQuickViewModal();

  // Reviews modal controls
  setupReviewsModal();

  // Listen to popstate (back/forward in browser)
  window.addEventListener('popstate', () => {
    checkRoute();
  });
}

function initSubscriptions() {
  // 1. Subscribe to Live Deleted Artisans Tombstones
  if (typeof ArtisanDB.subscribeDeletedArtisans === 'function') {
    ArtisanDB.subscribeDeletedArtisans((deletedIds) => {
      liveDeletedArtisanIds = deletedIds || new Set();
      refreshArtisans();
    });
  }

  // 2. Subscribe to Live Sellers in Firestore
  ArtisanDB.subscribeSellers((sellers) => {
    hasReceivedSellersSnapshot = true;
    liveFirestoreSellers = sellers || [];
    refreshArtisans();
    checkRoute();
  });

  // 3. Subscribe to Live Products for real-time stock sync
  ArtisanDB.subscribeProducts((prods) => {
    allProducts = prods;
    // If shop view is currently visible, refresh its product cards and stock live
    const shopSection = document.getElementById('artisanShopSection');
    if (shopSection && shopSection.style.display !== 'none') {
      const params = new URLSearchParams(window.location.search);
      const sellerId = params.get('sellerId');
      const sellerName = params.get('sellerName');
      const artisan = findArtisan(sellerId, sellerName);
      if (artisan) {
        renderArtisanProducts(artisan);
      }
    }

    // If quick-view modal is open, update its stock live
    if (activeQuickViewProduct) {
      const updated = allProducts.find(p => p.id === activeQuickViewProduct.id);
      if (updated) {
        activeQuickViewProduct.stock = updated.stock;
        updateQuickViewStockDisplay(updated.stock);
      }
    }
  });
}

function refreshArtisans() {
  const map = new Map();

  // If Firestore has sellers, use Firestore as the authoritative source
  if (Array.isArray(liveFirestoreSellers) && liveFirestoreSellers.length > 0) {
    liveFirestoreSellers.forEach(s => {
      const sId = s.id || s.uid;
      // Exclude if deleted in database, tombstoned, inactive, or suspended
      if (!sId || liveDeletedArtisanIds.has(sId) || s.deleted === true || s.status === 'deleted' || s.status === 'Inactive' || s.status === 'suspended') {
        return;
      }
      map.set(sId, {
        id: sId,
        name: s.name || s.applicantName || 'Artisan Seller',
        shopName: s.shopName || 'Artisan Craft Workshop',
        region: s.region || s.location || s.city || 'Philippines',
        category: s.category || 'Handmade Crafts',
        bio: s.bio || s.story || 'Handcrafting authentic cultural treasures with passion and heritage.',
        photo: s.photo || s.avatar || s.imageUrl || 'images/emblem.svg',
        status: s.status || 'Active',
        gcashName: s.gcashName || '',
        gcashNumber: s.gcashNumber || '',
        verified: true
      });
    });
  } else if (!hasReceivedSellersSnapshot || (liveFirestoreSellers.length === 0 && liveDeletedArtisanIds.size === 0)) {
    // Only fall back to DEFAULT_ARTISANS on initial load before any database records or deletions exist
    DEFAULT_ARTISANS.forEach(a => {
      if (!liveDeletedArtisanIds.has(a.id)) {
        map.set(a.id, { ...a });
      }
    });
  }

  allArtisans = Array.from(map.values()).filter(a => a.status !== 'Inactive' && a.status !== 'suspended' && a.status !== 'deleted');
  renderArtisansGrid();
}

function checkRoute() {
  const params = new URLSearchParams(window.location.search);
  const sellerId = params.get('sellerId');
  const sellerName = params.get('sellerName');
  const artisanQuery = params.get('artisan');

  if (sellerId || sellerName || artisanQuery) {
    const matched = findArtisan(sellerId, sellerName || artisanQuery);
    if (matched) {
      showArtisanShopView(matched);
      return;
    }
  }

  switchToDirectoryView();
}

function findArtisan(id, name) {
  // 1. Check allArtisans
  if (id) {
    const byId = allArtisans.find(a => a.id === id);
    if (byId) return byId;
  }
  if (name) {
    const clean = name.toLowerCase().trim();
    const byName = allArtisans.find(a =>
      (a.name && a.name.toLowerCase().includes(clean)) ||
      (a.shopName && a.shopName.toLowerCase().includes(clean))
    );
    if (byName) return byName;
  }

  // 2. Check live Firestore sellers
  if (Array.isArray(liveFirestoreSellers) && liveFirestoreSellers.length > 0) {
    if (id) {
      const s = liveFirestoreSellers.find(x => x.id === id || x.uid === id);
      if (s) {
        return {
          id: s.id || s.uid,
          name: s.name || s.applicantName || 'Artisan Seller',
          shopName: s.shopName || `${s.name || 'Artisan'}'s Workshop`,
          region: s.region || s.location || 'Philippines',
          category: s.category || 'Handmade Crafts',
          bio: s.bio || s.story || 'Handcrafting authentic cultural treasures with passion and heritage.',
          photo: s.photo || s.avatar || 'images/emblem.svg',
          status: s.status || 'Active',
          verified: true
        };
      }
    }
    if (name) {
      const clean = name.toLowerCase().trim();
      const s = liveFirestoreSellers.find(x =>
        (x.name && x.name.toLowerCase().includes(clean)) ||
        (x.shopName && x.shopName.toLowerCase().includes(clean))
      );
      if (s) {
        return {
          id: s.id || s.uid,
          name: s.name || s.applicantName || 'Artisan Seller',
          shopName: s.shopName || `${s.name || 'Artisan'}'s Workshop`,
          region: s.region || s.location || 'Philippines',
          category: s.category || 'Handmade Crafts',
          bio: s.bio || s.story || 'Handcrafting authentic cultural treasures with passion and heritage.',
          photo: s.photo || s.avatar || 'images/emblem.svg',
          status: s.status || 'Active',
          verified: true
        };
      }
    }
  }

  // 3. Fallback: Synthesize from products catalog for this seller
  if (allProducts && allProducts.length > 0) {
    const cleanName = (name || '').toLowerCase().trim();
    const prod = allProducts.find(p =>
      (id && p.sellerId === id) ||
      (cleanName && p.sellerName && p.sellerName.toLowerCase().includes(cleanName)) ||
      (cleanName && p.sellerShop && p.sellerShop.toLowerCase().includes(cleanName))
    );
    if (prod) {
      return {
        id: prod.sellerId || id || 'artisan',
        name: prod.sellerName || name || 'Artisan Partner',
        shopName: prod.sellerShop || prod.shopName || `${prod.sellerName || 'Artisan'}'s Workshop`,
        region: prod.sellerRegion || prod.region || 'Philippines',
        category: prod.category || 'Handcrafted Creations',
        bio: prod.sellerBio || 'Dedicated local Filipino artisan handcrafting authentic cultural treasures with traditional heritage techniques.',
        photo: prod.sellerPhoto || 'images/emblem.svg',
        status: 'Active',
        verified: true
      };
    }
  }

  // 4. Default static artisans
  if (id) {
    const d = DEFAULT_ARTISANS.find(a => a.id === id);
    if (d) return { ...d };
  }
  if (name) {
    const clean = name.toLowerCase().trim();
    const d = DEFAULT_ARTISANS.find(a =>
      (a.name && a.name.toLowerCase().includes(clean)) ||
      (a.shopName && a.shopName.toLowerCase().includes(clean))
    );
    if (d) return { ...d };
  }

  return null;
}

function switchToDirectoryView() {
  document.getElementById('artisanDirectorySection').style.display = 'block';
  document.getElementById('artisanShopSection').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderArtisansGrid() {
  const container = document.getElementById('artisansGrid');
  if (!container) return;

  let list = allArtisans;

  // Filter by Region
  if (selectedRegion !== 'all') {
    list = list.filter(a => (a.region || '').toLowerCase().includes(selectedRegion.toLowerCase()));
  }

  // Filter by Search Query
  if (searchQuery) {
    list = list.filter(a => {
      const haystack = `${a.name || ''} ${a.shopName || ''} ${a.region || ''} ${a.category || ''} ${a.bio || ''}`.toLowerCase();
      return haystack.includes(searchQuery);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 50px 20px; background: #ffffff; border-radius: 16px; border: 1px dashed #dcd1be;">
        <div style="font-size: 40px; margin-bottom: 12px;">🎨</div>
        <h3 style="color: #1d4831; margin-bottom: 8px;">No Artisans Found</h3>
        <p style="color: #64748b; font-size: 14px; max-width: 400px; margin: 0 auto 16px;">
          We couldn't find any artisans matching "${searchQuery}". Try selecting another region or clear your search.
        </p>
        <button type="button" class="primary-btn" onclick="document.getElementById('artisanFilterInput').value=''; window.location.href='artisans.html';">
          View All Artisans
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(artisan => {
    // Count listed creations for this artisan
    const productCount = allProducts.filter(p =>
      (p.sellerId && p.sellerId === artisan.id) ||
      (p.sellerName && (p.sellerName === artisan.name || p.sellerName === artisan.shopName))
    ).length;

    const photoUrl = artisan.photo || 'images/emblem.svg';
    const shopUrl = `artisans.html?sellerId=${encodeURIComponent(artisan.id)}&sellerName=${encodeURIComponent(artisan.shopName || artisan.name)}`;

    return `
      <article class="artisan-showcase-card">
        <div class="artisan-card-banner"></div>
        <div class="artisan-card-header">
          <img class="artisan-avatar-img" src="${photoUrl}" alt="${artisan.name}" onerror="this.src='images/emblem.svg'">
          <div class="artisan-badge-row">
            <span class="artisan-verified-pill">🇵🇭 Verified Artisan</span>
          </div>
        </div>
        <div class="artisan-card-body">
          <h3 class="artisan-name-title">${artisan.name}</h3>
          <div class="artisan-shop-name">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            ${artisan.shopName}
          </div>
          <div class="artisan-region-tag">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            ${artisan.region}
          </div>
          <p class="artisan-bio-excerpt">${artisan.bio}</p>
          <div class="artisan-card-meta">
            <span><strong>Craft:</strong> ${artisan.category}</span>
            <span><strong>${productCount}</strong> item(s)</span>
          </div>
          <a href="${shopUrl}" class="artisan-view-shop-btn" data-artisan-id="${artisan.id}">
            Visit Artisan Shop & Products →
          </a>
        </div>
      </article>
    `;
  }).join('');

  // Handle in-page view transitions
  container.querySelectorAll('.artisan-view-shop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const aId = btn.dataset.artisanId;
      const target = allArtisans.find(a => a.id === aId);
      if (target) {
        history.pushState(null, '', `artisans.html?sellerId=${encodeURIComponent(target.id)}&sellerName=${encodeURIComponent(target.shopName || target.name)}`);
        showArtisanShopView(target);
      }
    });
  });
}

function showArtisanShopView(artisan) {
  document.getElementById('artisanDirectorySection').style.display = 'none';
  const shopSec = document.getElementById('artisanShopSection');
  shopSec.style.display = 'block';

  // Populate hero details
  const photoEl = document.getElementById('shopArtisanPhoto');
  if (photoEl) {
    photoEl.src = artisan.photo || 'images/emblem.svg';
    photoEl.onerror = () => { photoEl.src = 'images/emblem.svg'; };
  }
  document.getElementById('shopArtisanName').textContent = artisan.name;
  document.getElementById('shopArtisanShopName').textContent = artisan.shopName;
  document.getElementById('shopArtisanRegion').textContent = `📍 ${artisan.region}`;
  document.getElementById('shopArtisanCategory').textContent = `🧵 ${artisan.category}`;
  document.getElementById('shopArtisanBio').textContent = artisan.bio;

  const catalogTitle = document.getElementById('shopCatalogTitle');
  if (catalogTitle) catalogTitle.textContent = `${artisan.shopName}'s Creations Only`;

  const catalogSubtitle = document.getElementById('shopCatalogSubtitle');
  if (catalogSubtitle) catalogSubtitle.textContent = `Showing all handcrafted items listed exclusively by ${artisan.name}`;

  // Smart back navigation
  const backBtn = document.getElementById('backToArtisansBtn');
  if (backBtn) {
    const params = new URLSearchParams(window.location.search);
    const hasSellerParam = params.get('sellerId') || params.get('sellerName');
    if (hasSellerParam) {
      backBtn.textContent = '← Back to Products';
      backBtn.onclick = (e) => {
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = 'products.html';
        }
      };
    } else {
      backBtn.textContent = '← Back to All Artisans';
      backBtn.onclick = (e) => {
        e.preventDefault();
        history.pushState(null, '', 'artisans.html');
        switchToDirectoryView();
      };
    }
  }

  renderArtisanProducts(artisan);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderArtisanProducts(artisan) {
  const container = document.getElementById('artisanProductsGrid');
  if (!container) return;

  // Filter products for this artisan ONLY
  const targetId = artisan.id;
  const targetName = (artisan.name || '').toLowerCase().trim();
  const targetShop = (artisan.shopName || '').toLowerCase().trim();

  const artisanProducts = allProducts.filter(p => {
    if (targetId && p.sellerId && p.sellerId === targetId) return true;
    if (p.sellerName) {
      const sn = p.sellerName.toLowerCase();
      if (targetName && sn.includes(targetName)) return true;
      if (targetShop && sn.includes(targetShop)) return true;
    }
    return false;
  });

  const countEl = document.getElementById('shopArtisanProductCount');
  if (countEl) countEl.textContent = `📦 ${artisanProducts.length} Creation${artisanProducts.length === 1 ? '' : 's'} Listed by this Seller Only`;

  const catalogTitle = document.getElementById('shopCatalogTitle');
  if (catalogTitle) catalogTitle.textContent = `${artisan.shopName}'s Handcrafted Creations`;

  if (artisanProducts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: #ffffff; border-radius: 16px; border: 1px dashed #dcd1be;">
        <div style="font-size: 42px; margin-bottom: 12px;">🧵</div>
        <h3 style="color: #1d4831; margin-bottom: 8px;">Preparing New Creations</h3>
        <p style="color: #64748b; font-size: 14px; max-width: 440px; margin: 0 auto 20px;">
          ${artisan.name} is currently crafting their next batch of handcrafted items in their workshop. Please check back soon or explore other artisans!
        </p>
        <a href="products.html" class="primary-btn" style="text-decoration: none; display: inline-block;">Browse Full Storefront</a>
      </div>
    `;
    return;
  }

  container.innerHTML = artisanProducts.map(product => {
    const stock = Number(product.stock) || 0;
    const isOutOfStock = stock <= 0;
    const stockBadge = isOutOfStock
      ? '<span class="stock-pill out-of-stock">Out of Stock</span>'
      : (stock <= 3 ? `<span class="stock-pill low-stock">Only ${stock} left</span>` : `<span class="stock-pill in-stock">${stock} in stock</span>`);

    const defaultImage = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=500&q=80';
    const imageUrl = product.image || defaultImage;
    const priceFormatted = `₱${Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    return `
      <article class="product-card" data-product-id="${product.id}" style="cursor: pointer;">
        <div class="product-thumb-wrap">
          <img src="${imageUrl}" alt="${product.name}" loading="lazy" onerror="this.src='${defaultImage}'">
          ${stockBadge}
        </div>
        <div class="product-info">
          <span class="product-card-category">${product.category || 'Handicrafts'}</span>
          <h3 class="product-card-title">${product.name}</h3>
          
          <div class="product-card-reviews-row" style="margin: 4px 0 8px;">
            <button type="button" class="btn-reviews-trigger" data-id="${product.id}" data-name="${encodeURIComponent(product.name)}">
              ★ 5.0 (Reviews)
            </button>
          </div>

          <div class="product-card-pricing">
            <span class="price-val">${priceFormatted}</span>
          </div>

          <div class="product-card-actions">
            <button type="button" class="action-btn view-details-btn">
              Quick View
            </button>
            <button type="button" class="primary-btn add-to-cart-btn" ${isOutOfStock ? 'disabled' : ''}>
              ${isOutOfStock ? 'Sold Out' : 'Add to Cart'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Attach card event listeners
  container.querySelectorAll('.product-card').forEach(card => {
    const prodId = card.dataset.productId;
    const product = artisanProducts.find(p => p.id === prodId);
    if (!product) return;

    // Quick View
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add-to-cart-btn') || e.target.closest('.btn-reviews-trigger')) return;
      openQuickView(product);
    });

    // Add to Cart
    const addBtn = card.querySelector('.add-to-cart-btn');
    if (addBtn && (Number(product.stock) || 0) > 0) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAddToCart(product, 1);
        addBtn.textContent = 'Added!';
        setTimeout(() => { addBtn.textContent = 'Add to Cart'; }, 1500);
      });
    }

    // Reviews button
    const reviewsBtn = card.querySelector('.btn-reviews-trigger');
    if (reviewsBtn) {
      reviewsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReviewsModal(product);
      });
    }
  });
}

/* ================= QUICK VIEW MODAL ================= */
function setupQuickViewModal() {
  const modal = document.getElementById('quickViewModal');
  const closeBtn = document.getElementById('closeQuickViewBtn');
  const minusBtn = document.getElementById('quickViewQtyMinus');
  const plusBtn = document.getElementById('quickViewQtyPlus');
  const addCartBtn = document.getElementById('quickViewAddCartBtn');
  const buyNowBtn = document.getElementById('quickViewBuyNowBtn');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  if (minusBtn) {
    minusBtn.addEventListener('click', () => {
      if (quickViewQuantity > 1) {
        quickViewQuantity--;
        document.getElementById('quickViewQuantity').textContent = quickViewQuantity;
      }
    });
  }

  if (plusBtn) {
    plusBtn.addEventListener('click', () => {
      const stock = Number(activeQuickViewProduct?.stock || 99);
      if (quickViewQuantity < stock) {
        quickViewQuantity++;
        document.getElementById('quickViewQuantity').textContent = quickViewQuantity;
      } else {
        alert(`Only ${stock} items available in stock.`);
      }
    });
  }

  if (addCartBtn) {
    addCartBtn.addEventListener('click', () => {
      if (!activeQuickViewProduct) return;
      const stock = Number(activeQuickViewProduct.stock || 0);
      if (stock <= 0) {
        alert('This handcrafted item is currently sold out.');
        return;
      }
      handleAddToCart(activeQuickViewProduct, quickViewQuantity);
      if (modal) modal.style.display = 'none';
    });
  }

  if (buyNowBtn) {
    buyNowBtn.addEventListener('click', () => {
      if (!activeQuickViewProduct) return;
      handleAddToCart(activeQuickViewProduct, quickViewQuantity);
      window.location.href = 'cart.html';
    });
  }
}

function openQuickView(product) {
  activeQuickViewProduct = product;
  quickViewQuantity = 1;

  const modal = document.getElementById('quickViewModal');
  if (!modal) return;

  const imgEl = document.getElementById('quickViewImage');
  if (imgEl) {
    imgEl.src = product.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=500&q=80';
    imgEl.alt = product.name;
  }

  document.getElementById('quickViewCategory').textContent = product.category || 'Handicrafts';
  document.getElementById('quickViewTitle').textContent = product.name;
  document.getElementById('quickViewPrice').textContent = `₱${Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('quickViewDesc').textContent = product.description || 'Authentic Philippine handmade treasure crafted with sustainable local materials.';
  document.getElementById('quickViewQuantity').textContent = '1';
  document.getElementById('quickViewSellerName').textContent = product.sellerName || 'Artisan Partner';
  document.getElementById('quickViewSellerInitial').textContent = (product.sellerName || 'A').charAt(0).toUpperCase();

  updateQuickViewStockDisplay(product.stock);

  modal.style.display = 'flex';
}

function updateQuickViewStockDisplay(stockVal) {
  const stock = Number(stockVal) || 0;
  const indicator = document.getElementById('quickViewStockIndicator');
  const addBtn = document.getElementById('quickViewAddCartBtn');
  const buyBtn = document.getElementById('quickViewBuyNowBtn');

  if (!indicator) return;

  if (stock <= 0) {
    indicator.textContent = 'Out of Stock';
    indicator.style.color = '#c53030';
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Sold Out'; }
    if (buyBtn) { buyBtn.disabled = true; }
  } else if (stock <= 3) {
    indicator.textContent = `Low Stock — Only ${stock} left!`;
    indicator.style.color = '#b45309';
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add to Cart'; }
    if (buyBtn) { buyBtn.disabled = false; }
  } else {
    indicator.textContent = `In Stock (${stock} available)`;
    indicator.style.color = '#1b5e20';
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add to Cart'; }
    if (buyBtn) { buyBtn.disabled = false; }
  }
}

/* ================= REVIEWS MODAL ================= */
function setupReviewsModal() {
  const modal = document.getElementById('productReviewsListModal');
  const closeBtn = document.getElementById('closeReviewsListModalBtn');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }
}

function openReviewsModal(product) {
  const modal = document.getElementById('productReviewsListModal');
  if (!modal) return;

  document.getElementById('reviewsModalProductSubtitle').textContent = `Reviews for "${product.name}"`;
  const writeLink = document.getElementById('reviewsModalWriteReviewBtn');
  if (writeLink) {
    writeLink.href = `review.html?productId=${encodeURIComponent(product.id)}&productName=${encodeURIComponent(product.name)}`;
  }

  const container = document.getElementById('reviewsModalListContainer');
  container.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">Fetching verified reviews...</div>';
  modal.style.display = 'flex';

  ArtisanDB.subscribeProductReviews(product.id, (reviews) => {
    if (!reviews || reviews.length === 0) {
      document.getElementById('reviewsModalAvgScore').textContent = '5.0';
      document.getElementById('reviewsModalStars').textContent = '★★★★★';
      document.getElementById('reviewsModalTotalCount').textContent = 'No reviews yet';
      container.innerHTML = `
        <div style="text-align: center; padding: 30px; background: #faf8f5; border-radius: 10px;">
          <p style="color: #666; margin-bottom: 8px;">No reviews yet for this handcrafted item.</p>
          <small style="color: #888;">Ordered this piece? Be the first verified customer to share feedback!</small>
        </div>
      `;
      return;
    }

    const avg = (reviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / reviews.length).toFixed(1);
    document.getElementById('reviewsModalAvgScore').textContent = avg;
    document.getElementById('reviewsModalStars').textContent = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
    document.getElementById('reviewsModalTotalCount').textContent = `Based on ${reviews.length} verified review${reviews.length > 1 ? 's' : ''}`;

    container.innerHTML = reviews.map(r => `
      <div class="review-entry-card" style="background: #ffffff; border: 1px solid #ebd9c8; border-radius: 10px; padding: 14px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <strong style="color: #1d4831; font-size: 14px;">${r.reviewerName || 'Artisan Customer'}</strong>
            <span class="verified-buyer-pill" style="font-size: 11px; margin-left: 6px;">✓ Verified Order</span>
          </div>
          <span style="font-size: 12px; color: #888;">${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : 'Recent'}</span>
        </div>
        <div class="review-stars-row" style="color: #f59e0b; font-size: 13px;">${'★'.repeat(Number(r.rating) || 5)}</div>
        <h4 class="review-headline-text" style="margin: 4px 0; font-size: 13.5px; color: #1d4831;">${r.headline || 'Excellent Craftsmanship'}</h4>
        <p class="review-comment-text" style="font-size: 13px; color: #333; margin: 4px 0 0; line-height: 1.45;">${r.comment || ''}</p>
      </div>
    `).join('');
  });
}

