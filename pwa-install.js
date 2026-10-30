// pwa-install.js - Progressive Web App Install & Add to Home Screen Manager

let deferredPrompt = null;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('Artisan Aisle PWA SW registered successfully:', reg.scope);
        })
        .catch(() => {
          navigator.serviceWorker.register('sw.js').catch((err) => {
            console.log('SW registration notice:', err);
          });
        });
    });
  }

  // If already running in standalone PWA mode, no need to show install prompts
  if (IS_STANDALONE) {
    console.log('Artisan Aisle running in installed standalone mode.');
    return;
  }

  // Listen for beforeinstallprompt event (Android Chrome, Edge, Desktop Chrome)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('beforeinstallprompt captured.');
    renderInstallUI();
  });

  // Check if iOS or show install button
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupInstallElements();
    });
  } else {
    setupInstallElements();
  }
}

function setupInstallElements() {
  // Render header install button if not present
  attachHeaderInstallBtn();
  // Check if we should show mobile banner
  maybeShowMobileInstallBanner();
}

function renderInstallUI() {
  const headerBtn = document.getElementById('headerInstallAppBtn');
  if (headerBtn) {
    headerBtn.style.display = 'inline-flex';
  }
  const mobileBanner = document.getElementById('pwaMobileInstallBanner');
  if (mobileBanner && !sessionStorage.getItem('artisan_pwa_dismissed')) {
    mobileBanner.style.display = 'flex';
  }
}

export function attachHeaderInstallBtn() {
  const headerLinks = document.querySelector('.header-links') || document.querySelector('header');
  if (!headerLinks || document.getElementById('headerInstallAppBtn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'headerInstallAppBtn';
  btn.className = 'btn-header-install';
  btn.setAttribute('aria-label', 'Install Artisan Aisle app on home screen');
  btn.setAttribute('title', 'Add Artisan Aisle to your home screen');
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span>Install App</span>
  `;

  btn.addEventListener('click', triggerInstallPrompt);

  // Insert before cart or at the beginning of header links
  headerLinks.insertBefore(btn, headerLinks.firstChild);
}

export async function triggerInstallPrompt() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('PWA install choice outcome:', outcome);
    deferredPrompt = null;
    const headerBtn = document.getElementById('headerInstallAppBtn');
    if (headerBtn && outcome === 'accepted') {
      headerBtn.style.display = 'none';
    }
    const mobileBanner = document.getElementById('pwaMobileInstallBanner');
    if (mobileBanner && outcome === 'accepted') {
      mobileBanner.style.display = 'none';
    }
  } else if (IS_IOS) {
    showIosInstallModal();
  } else {
    showDesktopInstallModal();
  }
}

function maybeShowMobileInstallBanner() {
  if (IS_STANDALONE || sessionStorage.getItem('artisan_pwa_dismissed')) return;
  if (window.innerWidth > 900 && !IS_IOS) return; // Only on mobile/tablet or iOS

  if (document.getElementById('pwaMobileInstallBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwaMobileInstallBanner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-banner-content">
      <img src="images/emblem.svg" alt="Artisan Aisle Emblem" class="pwa-banner-emblem" onerror="this.src='favicon.png'">
      <div class="pwa-banner-text">
        <strong>Install Artisan Aisle</strong>
        <span>Quickly open from your home screen</span>
      </div>
    </div>
    <div class="pwa-banner-actions">
      <button type="button" class="pwa-banner-install-btn" id="pwaBannerInstallTrigger">Add Icon</button>
      <button type="button" class="pwa-banner-close-btn" id="pwaBannerCloseTrigger" aria-label="Close">&times;</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('pwaBannerInstallTrigger')?.addEventListener('click', triggerInstallPrompt);
  document.getElementById('pwaBannerCloseTrigger')?.addEventListener('click', () => {
    banner.style.display = 'none';
    sessionStorage.setItem('artisan_pwa_dismissed', '1');
  });
}

function showIosInstallModal() {
  let modal = document.getElementById('pwaIosGuideModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pwaIosGuideModal';
    modal.className = 'pwa-instruction-modal';
    modal.innerHTML = `
      <div class="pwa-modal-backdrop"></div>
      <div class="pwa-modal-card">
        <div class="pwa-modal-header">
          <img src="images/emblem.svg" alt="Artisan Aisle" class="pwa-modal-emblem">
          <h3>Add to Home Screen</h3>
          <button type="button" class="pwa-modal-close" onclick="document.getElementById('pwaIosGuideModal').remove()">&times;</button>
        </div>
        <p class="pwa-modal-sub">Install the Artisan Aisle app on your iPhone or iPad for an app-like experience:</p>
        <ol class="pwa-instructions-list">
          <li>
            <span>1</span>
            <div>Tap the <strong>Share</strong> button <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin: 0 3px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> at the bottom of Safari.</div>
          </li>
          <li>
            <span>2</span>
            <div>Scroll down in the share menu and select <strong>"Add to Home Screen"</strong> (➕).</div>
          </li>
          <li>
            <span>3</span>
            <div>Tap <strong>"Add"</strong> in the top right corner to save the icon to your home screen.</div>
          </li>
        </ol>
        <button type="button" class="primary-btn pwa-modal-ok-btn" onclick="document.getElementById('pwaIosGuideModal').remove()">Got it!</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.pwa-modal-backdrop').addEventListener('click', () => modal.remove());
  }
}

function showDesktopInstallModal() {
  alert('To install Artisan Aisle on your home screen or desktop:\n\n1. Look for the install icon (⊕ or 💻) in your browser address bar.\n2. Or click your browser settings menu (⋮) and select "Install Artisan Aisle" or "Create shortcut".');
}

// Auto-initialize
initPWA();

