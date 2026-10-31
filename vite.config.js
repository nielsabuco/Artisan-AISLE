import { defineConfig } from 'vite';
import { resolve } from 'path';

function paymongoDevPlugin() {
  return {
    name: 'paymongo-dev-plugin',
    configureServer(server) {
      server.middlewares.use('/api/create-paymongo-checkout', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }
        let bodyStr = '';
        req.on('data', chunk => { bodyStr += chunk; });
        req.on('end', async () => {
          try {
            req.body = bodyStr ? JSON.parse(bodyStr) : {};
          } catch (e) {
            req.body = {};
          }
          res.status = code => { res.statusCode = code; return res; };
          res.json = data => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          };
          try {
            const { default: handler } = await import('./api/create-paymongo-checkout.js');
            await handler(req, res);
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      server.middlewares.use('/api/verify-paymongo-checkout', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }
        let bodyStr = '';
        req.on('data', chunk => { bodyStr += chunk; });
        req.on('end', async () => {
          try {
            req.body = bodyStr ? JSON.parse(bodyStr) : {};
          } catch (e) {
            req.body = {};
          }
          res.status = code => { res.statusCode = code; return res; };
          res.json = data => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          };
          try {
            const { default: handler } = await import('./api/verify-paymongo-checkout.js');
            await handler(req, res);
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      server.middlewares.use('/api/send-seller-email', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }
        let bodyStr = '';
        req.on('data', chunk => { bodyStr += chunk; });
        req.on('end', async () => {
          try {
            req.body = bodyStr ? JSON.parse(bodyStr) : {};
          } catch (e) {
            req.body = {};
          }
          res.status = code => { res.statusCode = code; return res; };
          res.json = data => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          };
          try {
            const { default: handler } = await import('./api/send-seller-email.js');
            await handler(req, res);
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [paymongoDevPlugin()],
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
        gcashCheckout: resolve(import.meta.dirname, 'gcash-checkout.html'),
        adminDisbursements: resolve(import.meta.dirname, 'admin-disbursements.html')
      }
    }
  }
});