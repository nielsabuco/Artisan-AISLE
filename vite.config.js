import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        about: resolve(import.meta.dirname, 'about-us.html'),
        artisans: resolve(import.meta.dirname, 'artisans.html'),
        categories: resolve(import.meta.dirname, 'categories.html'),
        contact: resolve(import.meta.dirname, 'contact.html'),
        createAccount: resolve(import.meta.dirname, 'create-account.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        seller: resolve(import.meta.dirname, 'seller.html')
      }
    }
  }
});