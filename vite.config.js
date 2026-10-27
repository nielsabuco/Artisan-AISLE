import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        products: resolve(import.meta.dirname, 'products.html'),
        cart: resolve(import.meta.dirname, 'cart.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
        seller: resolve(import.meta.dirname, 'seller.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        createAccount: resolve(import.meta.dirname, 'create-account.html'),
        about: resolve(import.meta.dirname, 'about-us.html'),
        artisans: resolve(import.meta.dirname, 'artisans.html'),
        categories: resolve(import.meta.dirname, 'categories.html'),
        contact: resolve(import.meta.dirname, 'contact.html'),
        review: resolve(import.meta.dirname, 'review.html'),
        gcashCheckout: resolve(import.meta.dirname, 'gcash-checkout.html')
      }
    }
  }
});