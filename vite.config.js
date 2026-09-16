import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
        login: resolve(__dirname, 'login.html'),
        review: resolve(__dirname, 'review.html')
      }
    }
  }
});