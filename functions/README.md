# PayMongo checkout

This backend creates PayMongo-hosted checkout sessions and only marks orders paid after verifying the session with PayMongo's API. Never put the PayMongo secret key in browser code or a `VITE_` variable.

1. Copy `.env.example` to `.env` and set `APP_BASE_URL` to the deployed HTTPS site origin.
2. Set the provider secret using Firebase Secret Manager:

   ```powershell
   firebase functions:secrets:set PAYMONGO_SECRET_KEY --project artisan-79f5d
   ```

3. Deploy the Functions and Firestore index:

   ```powershell
   firebase deploy --only functions,firestore:indexes --project artisan-79f5d
   ```

4. In PayMongo's dashboard, add the deployed `paymongoWebhook` HTTPS URL and subscribe to `checkout_session.payment.paid`. For a `asia-southeast1` function, the URL is `https://asia-southeast1-artisan-79f5d.cloudfunctions.net/paymongoWebhook`.
5. Test with a PayMongo test secret key and test payment methods before switching the Secret Manager value to a live key.

The project must be on a Firebase billing plan that supports Cloud Functions and scheduled functions. Pending checkout sessions are expired after 24 hours and their reserved stock is released.
