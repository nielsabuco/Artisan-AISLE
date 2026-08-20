import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about-us.html'),
        artisans: resolve(__dirname, 'artisans.html'),
        categories: resolve(__dirname, 'categories.html'),
        contact: resolve(__dirname, 'contact.html'),
        createAccount: resolve(__dirname, 'create-account.html'),
        login: resolve(__dirname, 'login.html')
      }
    }
  }
});