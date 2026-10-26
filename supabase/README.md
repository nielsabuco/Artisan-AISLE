# Supabase Edge Functions checkout

Firebase Auth and Firestore provide customer accounts and store data. Supabase Edge Functions securely validate orders, reserve stock, and handle private payment-proof uploads. GCash and Maya payments are sent manually to recipient details configured by an administrator; customers submit a reference number and receipt photo, and the administrator verifies payment before marking the order paid.

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

6. Create the private proof bucket by running:

   ```powershell
   npx supabase db query --linked --file supabase/payment-proof-storage.sql
   ```

   Alternatively, run the contents of [`payment-proof-storage.sql`](./payment-proof-storage.sql) in Supabase Dashboard → SQL Editor. The bucket must remain private; the Edge Function generates short-lived links only for the order's customer or an administrator.

## Deploy

```powershell
npx supabase functions deploy order-api --no-verify-jwt --use-api
npm.cmd ci
npm.cmd run build
```

The Edge Function uses Supabase's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to upload proof photos to the private bucket. These server values must be available to the function and must never be added to Vercel `VITE_` variables.

Deploy the website through the connected Vercel Git repository, or publish `dist` with your hosting provider.

## Administrator access

Sign in with the verified Firebase account `reniel.sabuco@ssu.edu.ph`. The Admin Dashboard link appears only for that account. Admin privileges are checked by the Firebase email and its verified status in the app, Firestore rules, and the order API; do not add public admin self-registration.

Add the public website domain under Firebase Authentication → Settings → Authorized domains so admins and customers can sign in from the deployed site.

## Payment setup

1. Sign in with the administrator account and open **Profile → Admin Dashboard → Settings**.
2. The supplied account names and numbers are prefilled. The supplied InstaPay QR is shown for GCash; upload a wallet-generated QR under either method if you need to change it or add a Maya QR. Save the settings after changing account details or QR images.
3. Checkout displays the selected wallet's recipient name, number, and QR when available. Customers transfer the order total, enter the transaction reference, upload a JPG, PNG, or WebP receipt photo (up to 5 MB), and place the order.
4. In **Admin Dashboard → Orders**, view the private proof image and verify the actual transaction in the wallet before selecting **Confirm payment**. A reference number or image alone does not verify funds.

Never ask customers for wallet PINs, passwords, or one-time codes. The proof bucket is private; do not add public read policies or use the public `product-images` bucket for receipts.

## Remove legacy PayMongo functions

New checkouts do not use PayMongo. Remove the old deployed functions from the linked Supabase project if they still exist:

```powershell
npx supabase functions delete paymongo-webhook --project-ref YOUR_PROJECT_REF
npx supabase functions delete expire-pending-orders --project-ref YOUR_PROJECT_REF
```

This removes PayMongo endpoints only; existing PayMongo orders remain in Firestore and may require separate handling. Customers can access the public website without a Vercel account. They need an ArtisanAisle customer account to place orders and see their order history across devices.
