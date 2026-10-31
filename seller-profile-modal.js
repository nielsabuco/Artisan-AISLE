// seller-profile-modal.js - Dedicated Seller Profile & Single-Seller Shop Modal

import { ArtisanDB } from './firebase-config.js';
import { handleAddToCart } from './header-auth.js';

// Pre-seeded master artisans list for fallback details
const PRESEEDED_ARTISANS = [
  {
    id: 'artisan-jerusalem',
    name: 'Eugene Marciene M. Jerusalem',
    shopName: 'Bicol Heritage Weavers',
    region: 'Albay, Bicol (Luzon)',
    category: 'Traditional Handloom Weaving & Abaca Bags',
    bio: 'Preserving over three generations of authentic Bicolano abaca weaving. Each bag, basket, and runner is crafted with natural fiber sustainably harvested in Albay.',
    photo: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
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
    verified: true
  }
];

let cachedProducts = [];
let cachedSellers = [];

// Initialize live subscriptions
if (typeof ArtisanDB !== 'undefined') {
  if (ArtisanDB.subscribeProducts) {
    ArtisanDB.subscribeProducts((prods) => {
      cachedProducts = prods || [];
    });
  }
  if (ArtisanDB.subscribeSellers) {
    ArtisanDB.subscribeSellers((sellers) => {
      cachedSellers = sellers || [];
    });
  }
}

// Ensure the modal HTML structure is present in document
export function ensureSellerProfileModal() {
  if (document.getElementById('sellerProfileViewModal')) return;

  const modal = document.createElement('div');
  modal.id = 'sellerProfileViewModal';
  modal.className = 'modal-backdrop seller-profile-modal-backdrop';
  modal.style.display = 'none';
  modal.style.zIndex = '10005';

  modal.innerHTML = `
    <div class="modal-card seller-profile-modal-card" style="max-width: 760px; width: 94%; max-height: 90vh; overflow-y: auto; padding: 0; border-radius: 16px; border: 1.5px solid #dcd1be; box-shadow: 0 25px 50px rgba(13,40,24,0.22); text-align: left; background: #ffffff;">
      
      <!-- Top Hero Header -->
      <div style="background: linear-gradient(135deg, #0d2818 0%, #1e472d 100%); padding: 26px 22px 20px; color: #ffffff; position: relative; border-radius: 14px 14px 0 0;">
        <button type="button" class="close-modal-btn" onclick="closeSellerProfileModal()" style="position: absolute; top: 14px; right: 16px; color: #ffffff; background: rgba(255,255,255,0.18); border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; font-size: 18px; line-height: 1; transition: background 0.2s;" title="Close Profile">&times;</button>
        
        <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
          <img id="spModalPhoto" src="images/emblem.svg" alt="Artisan Photo" style="width: 76px; height: 76px; border-radius: 50%; object-fit: cover; border: 3px solid #d4af37; background: #ffffff; flex-shrink: 0;" onerror="this.src='images/emblem.svg'">
          <div style="flex: 1; min-width: 200px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h2 id="spModalName" style="margin: 0; color: #ffffff; font-size: 22px; font-family: Georgia, serif; letter-spacing: -0.01em;">Artisan Creator</h2>
              <span class="artisan-verified-pill" style="background: #d4af37; color: #0d2818; font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 999px;">✓ Verified Artisan</span>
            </div>
            <div id="spModalShop" style="font-size: 14.5px; color: #fef08a; margin-top: 3px; font-weight: 600;">Artisan Workshop</div>
            <div style="display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; font-size: 12.5px; color: rgba(255,255,255,0.88);">
              <span id="spModalRegion" style="display: inline-flex; align-items: center; gap: 4px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                Region
              </span>
              <span id="spModalCategory" style="display: inline-flex; align-items: center; gap: 4px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                Craft Specialization
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Content Area -->
      <div style="padding: 22px 24px;">
        
        <!-- Story / Bio Card -->
        <div style="background: #fdfbf7; border: 1px solid #ebd9c2; border-left: 4px solid #166534; padding: 14px 18px; border-radius: 10px; margin-bottom: 22px;">
          <h4 style="margin: 0 0 6px 0; color: #1e472d; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Artisan Story & Craftsmanship</h4>
          <p id="spModalBio" style="margin: 0; font-size: 13.5px; color: #4b5563; line-height: 1.6;">
            Dedicated Filipino artisan handcrafting authentic regional cultural treasures with traditional heritage techniques.
          </p>
        </div>

        <!-- Section: Creations by this seller ONLY -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="margin: 0; color: #1e472d; font-size: 17px; font-family: Georgia, serif;" id="spModalCatalogTitle">Creations Listed by this Artisan</h3>
            <span style="font-size: 12.5px; color: #6b7280;" id="spModalItemsCount">Showing creations listed by this seller only</span>
          </div>
          <a id="spModalFullShopLink" href="artisans.html" class="primary-btn" style="text-decoration: none; font-size: 12px; padding: 6px 14px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
            Visit Workshop Page →
          </a>
        </div>

        <!-- Single Seller's Product Grid -->
        <div id="spModalProductsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px;">
          <!-- Dynamically populated -->
        </div>

        <div style="margin-top: 22px; padding-top: 16px; border-top: 1px solid #ebd9c2; display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="secondary-btn" onclick="closeSellerProfileModal()">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSellerProfileModal();
  });
}

export async function openSellerProfileModal(sellerId, sellerName) {
  ensureSellerProfileModal();

  const modal = document.getElementById('sellerProfileViewModal');
  if (!modal) return;

  const photoEl = document.getElementById('spModalPhoto');
  const nameEl = document.getElementById('spModalName');
  const shopEl = document.getElementById('spModalShop');
  const regionEl = document.getElementById('spModalRegion');
  const catEl = document.getElementById('spModalCategory');
  const bioEl = document.getElementById('spModalBio');
  const titleEl = document.getElementById('spModalCatalogTitle');
  const countEl = document.getElementById('spModalItemsCount');
  const gridEl = document.getElementById('spModalProductsGrid');
  const shopLink = document.getElementById('spModalFullShopLink');

  gridEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 30px; color: #666;">Loading artisan creations...</div>';
  modal.style.display = 'flex';

  // 1. Resolve seller profile details
  let artisan = null;

  // Check pre-seeded master artisans
  if (sellerId) {
    artisan = PRESEEDED_ARTISANS.find(a => a.id === sellerId);
  }
  if (!artisan && sellerName) {
    const clean = String(sellerName).toLowerCase().trim();
    artisan = PRESEEDED_ARTISANS.find(a =>
      (a.name && a.name.toLowerCase().includes(clean)) ||
      (a.shopName && a.shopName.toLowerCase().includes(clean))
    );
  }

  // Check cached sellers or Firestore
  if (!artisan && sellerId) {
    artisan = cachedSellers.find(s => s.id === sellerId || s.uid === sellerId);
    if (!artisan && ArtisanDB?.getSeller) {
      try {
        const fetched = await ArtisanDB.getSeller(sellerId);
        if (fetched) artisan = fetched;
      } catch (err) {
        console.warn('Could not fetch seller doc:', err);
      }
    }
  }

  // Check if any product has seller details
  const allProds = cachedProducts.length > 0 ? cachedProducts : (window.liveProducts || []);
  if (!artisan && allProds.length > 0) {
    const cleanName = String(sellerName || '').toLowerCase().trim();
    const matchingProd = allProds.find(p => (sellerId && p.sellerId === sellerId) || (cleanName && p.sellerName?.toLowerCase() === cleanName));
    if (matchingProd) {
      artisan = {
        id: matchingProd.sellerId || sellerId,
        name: matchingProd.sellerName || sellerName || 'Artisan Partner',
        shopName: matchingProd.sellerShop || matchingProd.shopName || `${matchingProd.sellerName || 'Artisan'}'s Workshop`,
        region: matchingProd.sellerRegion || matchingProd.region || 'Philippines',
        category: matchingProd.category || 'Handcrafted Creations',
        bio: matchingProd.sellerBio || 'Dedicated local Filipino artisan handcrafting authentic regional cultural treasures with traditional heritage techniques.',
        photo: matchingProd.sellerPhoto || 'images/emblem.svg'
      };
    }
  }

  // Fallback defaults if still not found
  if (!artisan) {
    artisan = {
      id: sellerId || 'artisan',
      name: sellerName || 'Artisan Partner',
      shopName: `${sellerName || 'Artisan'}'s Workshop`,
      region: 'Philippines',
      category: 'Handmade Crafts',
      bio: 'Authentic Filipino artisan creator dedicated to preserving native craft traditions.',
      photo: 'images/emblem.svg'
    };
  }

  // Populate hero details
  photoEl.src = artisan.photo || 'images/emblem.svg';
  nameEl.textContent = artisan.name || sellerName || 'Artisan Partner';
  shopEl.textContent = artisan.shopName || `${artisan.name}'s Workshop`;
  regionEl.innerHTML = `📍 ${artisan.region || 'Philippines'}`;
  catEl.innerHTML = `🧵 ${artisan.category || 'Handicrafts'}`;
  bioEl.textContent = artisan.bio || 'Authentic Filipino artisan creator dedicated to preserving native craft traditions.';

  titleEl.textContent = `${artisan.shopName || artisan.name}'s Creations`;

  const targetSellerId = artisan.id || sellerId;
  const targetSellerName = String(artisan.name || sellerName || '').toLowerCase().trim();
  const targetShopName = String(artisan.shopName || '').toLowerCase().trim();

  if (shopLink) {
    shopLink.href = `artisans.html?sellerId=${encodeURIComponent(targetSellerId || '')}&sellerName=${encodeURIComponent(artisan.shopName || artisan.name || '')}`;
  }

  // 2. Filter products for THIS SELLER ONLY
  let sellerItems = allProds.filter(p => {
    if (targetSellerId && p.sellerId && p.sellerId === targetSellerId) return true;
    if (p.sellerName) {
      const sn = p.sellerName.toLowerCase();
      if (targetSellerName && sn.includes(targetSellerName)) return true;
      if (targetShopName && sn.includes(targetShopName)) return true;
    }
    return false;
  });

  countEl.textContent = `Showing ${sellerItems.length} handcrafted creation${sellerItems.length === 1 ? '' : 's'} listed exclusively by this seller`;

  if (sellerItems.length === 0) {
    gridEl.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 36px 16px; background: #faf8f5; border-radius: 12px; border: 1px dashed #dcd1be;">
        <div style="font-size: 32px; margin-bottom: 6px;">🧵</div>
        <h4 style="margin: 0 0 6px 0; color: #1e472d;">No Additional Products Listed</h4>
        <p style="margin: 0; font-size: 13px; color: #666;">This artisan is currently handcrafting their next batch of creations.</p>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = sellerItems.map(item => {
    const stock = Number(item.stock) || 0;
    const isOut = stock <= 0;
    const stockPill = isOut
      ? '<span style="background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Out of Stock</span>'
      : (stock <= 3 ? `<span style="background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">Only ${stock} left</span>` : `<span style="background: #dcfce7; color: #166534; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">In Stock (${stock})</span>`);

    const img = item.image || 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=400&q=80';
    const price = Number(item.price || 0).toLocaleString();

    return `
      <div class="seller-item-card" style="background: #ffffff; border: 1px solid #ebd9c2; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s;">
        <div style="position: relative; width: 100%; height: 130px; background: #f5f5f5;">
          <img src="${img}" alt="${item.name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=400&q=80'">
          <div style="position: absolute; top: 6px; left: 6px;">${stockPill}</div>
        </div>
        <div style="padding: 10px; display: flex; flex-direction: column; flex: 1;">
          <small style="color: #6b7280; font-size: 11px; text-transform: uppercase;">${item.category || 'Craft'}</small>
          <strong style="color: #111827; font-size: 13px; line-height: 1.3; margin: 2px 0 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${item.name}">${item.name}</strong>
          <div style="font-size: 14px; font-weight: 800; color: #166534; margin-top: auto; margin-bottom: 8px;">₱${price}.00</div>
          <button type="button" class="primary-btn sp-add-btn" data-product-id="${item.id}" ${isOut ? 'disabled' : ''} style="width: 100%; font-size: 11.5px; padding: 6px 10px; border-radius: 6px; ${isOut ? 'background: #ccc; cursor: not-allowed;' : ''}">
            ${isOut ? 'Sold Out' : '+ Add to Cart'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach add-to-cart handlers
  gridEl.querySelectorAll('.sp-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pId = btn.dataset.productId;
      const targetProd = sellerItems.find(p => p.id === pId);
      if (targetProd) {
        handleAddToCart(targetProd, 1);
        btn.textContent = 'Added!';
        setTimeout(() => { btn.textContent = '+ Add to Cart'; }, 1200);
      }
    });
  });
}

export function closeSellerProfileModal() {
  const modal = document.getElementById('sellerProfileViewModal');
  if (modal) modal.style.display = 'none';
}

window.openSellerProfileModal = openSellerProfileModal;
window.closeSellerProfileModal = closeSellerProfileModal;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSellerProfileModal();
});
