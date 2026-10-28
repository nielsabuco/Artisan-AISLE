/**
 * PayMongo API Configuration for Real GCash & QRPh Payments
 * ==============================================================
 * To enable real money GCash payments:
 * 1. Create a free account at https://dashboard.paymongo.com
 * 2. In your PayMongo dashboard, go to Developers > API Keys
 * 3. Copy your Secret Key (starts with sk_test_ or sk_live_)
 * 4. Paste your key below OR enter it via the Admin Console > Payment Gateway tab!
 * ==============================================================
 */

export const PAYMONGO_CONFIG = {
  // Test Secret Key (Replace with your actual PayMongo key sk_test_... or sk_live_...)
  SECRET_KEY: (typeof process !== 'undefined' && process.env?.PAYMONGO_SECRET_KEY) || 'sk_test_artisan_aisle_placeholder',
  PUBLIC_KEY: (typeof process !== 'undefined' && process.env?.PAYMONGO_PUBLIC_KEY) || 'pk_test_artisan_aisle_placeholder',
  
  // Set to true when your PayMongo account is activated for real money!
  IS_LIVE_MODE: false,
  
  // PayMongo Official API Endpoint
  API_BASE: 'https://api.paymongo.com/v1',

  // Supported payment channels in the Philippines
  CHANNELS: ['gcash', 'paymaya', 'card', 'dob', 'qrph']
};
