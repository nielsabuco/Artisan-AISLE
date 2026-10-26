# Supabase Edge Functions checkout

Firebase Hosting stays on the Spark plan. Supabase Edge Functions provide the secure checkout API, while Firebase Auth and Firestore remain the identity provider and order/product database.

## Configure

1. Create a Supabase project and install the Supabase CLI.
2. Put the project URL and anon/publishable key in the root `.env`:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

3. Create a Google Cloud service account in Firebase project `artisan-79f5d`, grant it the **Cloud Datastore User** role, and download its JSON key. Store the key securely; do not commit it.
4. Create a local, git-ignored `.env.supabase` file containing:

   ```dotenv
   APP_BASE_URL=https://YOUR_VERCEL_PRODUCTION_DOMAIN
   FIREBASE_PROJECT_ID=artisan-79f5d
   FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
   PAYMONGO_SECRET_KEY=YOUR_PAYMONGO_TEST_SECRET
   FIREBASE_SERVICE_ACCOUNT_B64=BASE64_ENCODED_SERVICE_ACCOUNT_JSON
   ```

   In PowerShell, create the ignored env file and encode the service-account JSON without putting the key in the source tree:

   ```powershell
   @'
   APP_BASE_URL=https://YOUR_VERCEL_PRODUCTION_DOMAIN
   FIREBASE_PROJECT_ID=artisan-79f5d
   FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
   PAYMONGO_SECRET_KEY=YOUR_PAYMONGO_TEST_SECRET
   '@ | Set-Content .env.supabase
   $json = Get-Content .\path\to\service-account.json -Raw
   $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
   Add-Content .env.supabase "FIREBASE_SERVICE_ACCOUNT_B64=$base64"
   ```

   Replace the placeholders in `.env.supabase` with your values. The Firebase web API key is public in the site config, but set it here so Supabase can verify Firebase ID tokens. The root `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` is a separate file for the website build.
5. Link the CLI to your Supabase project and upload the secrets:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set --env-file .env.supabase
   ```

   `APP_BASE_URL` must be the exact HTTPS origin serving the site (for example `https://artisan-aisle-9mnco6935-niel11.vercel.app`), with no trailing slash. It controls browser CORS and PayMongo return URLs. If Vercel assigns a new deployment hostname, update this Supabase secret and redeploy `order-api`:

   ```powershell
   npx supabase secrets set APP_BASE_URL=https://YOUR_VERCEL_PRODUCTION_DOMAIN
   npx supabase functions deploy order-api --no-verify-jwt
   ```

The `supabase/config.toml` file sets explicit `.js` entrypoints for all three functions. Deploying those JavaScript entrypoints requires Supabase CLI 1.215.0 or newer.

## Deploy

```powershell
npx supabase functions deploy order-api --no-verify-jwt
npx supabase functions deploy paymongo-webhook --no-verify-jwt
npx supabase functions deploy expire-pending-orders --no-verify-jwt
npm.cmd ci
npm.cmd run build
npx firebase-tools deploy --only hosting,firestore:rules,firestore:indexes --project artisan-79f5d
```

`verify_jwt` is disabled only at the Supabase gateway because customers authenticate with Firebase tokens, not Supabase tokens. The order API verifies every Firebase ID token with Firebase Identity Toolkit before performing an operation. The webhook independently retrieves the PayMongo Checkout Session and checks its order reference, payment status, currency, and amount; an unverified redirect never marks an order paid.

In PayMongo settings, register:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/paymongo-webhook
```

Subscribe to `checkout_session.payment.paid`.

## Release stock for abandoned checkouts

Checkout reserves tracked inventory. The `expire-pending-orders` function expires unpaid PayMongo sessions older than 24 hours and returns their stock. Generate a random cleanup secret in PowerShell and add it to `.env.supabase`:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$cleanupSecret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
Add-Content .env.supabase "ORDER_CLEANUP_SECRET=$cleanupSecret"
npx supabase secrets set --env-file .env.supabase
```

Save the same value in Supabase Vault as `order_cleanup_secret`. Enable the `pg_cron`, `pg_net`, and Vault extensions, then run this SQL in the Supabase SQL editor, replacing `YOUR_PROJECT_REF`:

```sql
select cron.schedule(
  'expire-pending-artisan-orders',
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/expire-pending-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-order-cleanup-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'order_cleanup_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Start with PayMongo test credentials and test payments before switching to live credentials. Do not commit `.env`, `.env.supabase`, Firebase service-account keys, or PayMongo secrets.
