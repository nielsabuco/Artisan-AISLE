# Supabase Edge Functions checkout

Firebase Auth and Firestore provide customer accounts and store data. Supabase Edge Functions securely validate orders and reserve stock. GCash and Maya payments are sent manually to the recipient details configured by an administrator; customers submit the transaction reference, and an administrator confirms receipt before the order is marked paid.

## Configure

1. Create a Supabase project and install the Supabase CLI.
2. Add the Supabase project URL and anon/publishable key to the root `.env` for the Vite website:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

3. Create a Google Cloud service account in Firebase project `artisan-79f5d`, grant it the **Cloud Datastore User** role, and download its JSON key. Keep the key private; do not commit it.
4. Create a local, git-ignored `.env.supabase` file:

   ```dotenv
   APP_BASE_URL=https://YOUR_STABLE_PUBLIC_WEBSITE_DOMAIN
   FIREBASE_PROJECT_ID=artisan-79f5d
   FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
   FIREBASE_SERVICE_ACCOUNT_B64=BASE64_ENCODED_SERVICE_ACCOUNT_JSON
   ```

   In PowerShell, encode the service account JSON without adding the key to the source tree:

   ```powershell
   @'
   APP_BASE_URL=https://YOUR_STABLE_PUBLIC_WEBSITE_DOMAIN
   FIREBASE_PROJECT_ID=artisan-79f5d
   FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
   '@ | Set-Content .env.supabase
   $json = Get-Content .\path\to\service-account.json -Raw
   $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
   Add-Content .env.supabase "FIREBASE_SERVICE_ACCOUNT_B64=$base64"
   ```

   `APP_BASE_URL` must be the exact HTTPS origin customers use, without a trailing slash. Use a stable Vercel production domain or your custom domain, not a temporary preview URL. The root `.env` is separate and is used when building the website.
5. Link the Supabase CLI and set the server secrets:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase secrets set --env-file .env.supabase
   ```

## Deploy

```powershell
npx supabase functions deploy order-api --no-verify-jwt
npm.cmd ci
npm.cmd run build
```

Deploy the website through the connected Vercel Git repository, or publish `dist` with your hosting provider. Update Firestore rules separately:

```powershell
npx firebase-tools deploy --only firestore:rules --project artisan-79f5d
```

The Supabase gateway does not validate Supabase JWTs because customers sign in with Firebase. The order API verifies each Firebase ID token itself, checks current product prices and inventory, and writes the order and stock changes transactionally.

The PayMongo webhook and pending-order expiry function are legacy support for older hosted-checkout orders. New orders do not create PayMongo sessions. Keep those functions deployed only if you still need to settle or expire existing PayMongo orders.

## Payment setup

1. Sign in to the public website using the approved administrator account.
2. Open the Admin dashboard, then **Settings**.
3. Enter the GCash and/or Maya recipient account name and number and save. These are payment instructions, not private wallet credentials; customers can see the configured details at checkout.
4. Customers select GCash or Maya, transfer the order total, and submit the transaction reference. The order remains **Awaiting payment verification** until an administrator checks the received payment and selects **Confirm payment** in Admin → Orders.

Never ask customers for wallet PINs, passwords, or one-time codes. A reference number alone is not proof of payment. Do not put Firebase service-account keys or Supabase secrets in Vercel `VITE_` variables.

Customers can visit the deployed website without a Vercel account. To use registration, sign-in, checkout, and profiles from your public Vercel/custom domain, add that domain under Firebase Authentication → Settings → Authorized domains. Customers need their own ArtisanAisle account to place orders and see their order history across devices.
