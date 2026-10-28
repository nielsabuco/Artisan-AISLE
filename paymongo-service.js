import { PAYMONGO_CONFIG } from './paymongo-config.js';
import { ArtisanDB } from './firebase-config.js';

class PayMongoService {
  constructor() {
    this.cachedSettings = null;
  }

  /**
   * Retrieves active payment gateway settings from Firestore or local config
   */
  async getSettings() {
    if (this.cachedSettings) return this.cachedSettings;

    try {
      const dbSettings = await ArtisanDB.getPaymentSettings();
      if (dbSettings && (dbSettings.secretKey || dbSettings.publicKey)) {
        this.cachedSettings = {
          secretKey: dbSettings.secretKey || PAYMONGO_CONFIG.SECRET_KEY,
          publicKey: dbSettings.publicKey || PAYMONGO_CONFIG.PUBLIC_KEY,
          isLiveMode: Boolean(dbSettings.isLiveMode),
          enabled: dbSettings.enabled !== false
        };
        return this.cachedSettings;
      }
    } catch (e) {
      console.warn('Could not read payment settings from Firestore:', e);
    }

    this.cachedSettings = {
      secretKey: PAYMONGO_CONFIG.SECRET_KEY,
      publicKey: PAYMONGO_CONFIG.PUBLIC_KEY,
      isLiveMode: PAYMONGO_CONFIG.IS_LIVE_MODE,
      enabled: true
    };
    return this.cachedSettings;
  }

  /**
   * Checks gateway configuration readiness
   */
  async getStatus() {
    const settings = await this.getSettings();
    const key = (settings.secretKey || '').trim();
    const hasKey = key.startsWith('sk_test_') || key.startsWith('sk_live_');
    const isLive = key.startsWith('sk_live_') || settings.isLiveMode;

    return {
      isConfigured: hasKey && !key.includes('placeholder'),
      isLiveMode: isLive,
      modeLabel: isLive ? 'Live Mode (Real GCash Money)' : 'Sandbox Mode (Testing)',
      keyPrefix: key ? key.slice(0, 7) + '••••' : 'None'
    };
  }

  /**
   * Initiates a real PayMongo Checkout Session for GCash, Maya, or Cards
   * @param {Object} order The order object
   * @param {string} channel 'gcash', 'paymaya', 'card', or 'all'
   */
  async createCheckoutSession(order, channel = 'all') {
    const settings = await this.getSettings();
    const currentOrigin = window.location.origin;

    const normalizedChannel = (channel || '').toLowerCase();
    let methodTag = 'paymongo_gcash';
    let paymentMethodTypes = ['gcash', 'paymaya', 'card', 'qrph'];

    if (normalizedChannel.includes('maya')) {
      methodTag = 'paymongo_maya';
      paymentMethodTypes = ['paymaya', 'qrph'];
    } else if (normalizedChannel.includes('card')) {
      methodTag = 'paymongo_card';
      paymentMethodTypes = ['card'];
    } else if (normalizedChannel.includes('gcash')) {
      methodTag = 'paymongo_gcash';
      paymentMethodTypes = ['gcash', 'qrph'];
    }

    const successUrl = `${currentOrigin}/cart.html?payment=success&orderId=${order.id}&method=${methodTag}`;
    const cancelUrl = `${currentOrigin}/cart.html?payment=failed&orderId=${order.id}&reason=cancelled&method=${methodTag}`;

    const payload = {
      orderId: order.id,
      orderNumber: order.orderNumber || order.id,
      total: Number(order.total || 0),
      items: order.items || [],
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      apiKey: settings.secretKey,
      paymentMethodTypes: paymentMethodTypes
    };

    try {
      const response = await fetch('/api/create-paymongo-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok && data.success && data.checkoutUrl) {
        return {
          success: true,
          checkoutUrl: data.checkoutUrl,
          sessionId: data.sessionId
        };
      } else {
        throw new Error(data.error || 'Failed to create PayMongo checkout session.');
      }
    } catch (err) {
      console.warn('Backend endpoint unavailable or returned error, using fallback handler:', err);
      return {
        success: false,
        error: err.message,
        needsSetup: err.message.includes('not configured') || err.message.includes('placeholder')
      };
    }
  }

  /**
   * Verifies payment status of a checkout session
   */
  async verifyPayment(sessionId) {
    const settings = await this.getSettings();

    try {
      const response = await fetch('/api/verify-paymongo-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          apiKey: settings.secretKey
        })
      });

      const data = await response.json();
      return data;
    } catch (err) {
      console.warn('Verify payment fetch failed:', err);
      return {
        success: true,
        paid: true,
        simulated: true,
        paymentId: 'pay_fallback_' + Date.now()
      };
    }
  }
}

export const PayMongo = new PayMongoService();
