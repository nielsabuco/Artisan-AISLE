/**
 * Serverless API Route: Create PayMongo Checkout Session for GCash
 * Path: /api/create-paymongo-checkout
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // body remains string
      }
    }

    const {
      orderId,
      orderNumber,
      total,
      items = [],
      customerName,
      customerEmail,
      customerPhone,
      successUrl,
      cancelUrl,
      apiKey,
      paymentMethodTypes
    } = body || {};

    const secretKey = apiKey || process.env.PAYMONGO_SECRET_KEY;

    if (!secretKey || secretKey.includes('placeholder')) {
      return res.status(400).json({
        success: false,
        error: 'PayMongo Secret Key not configured. Please enter your sk_test_... or sk_live_... key in the Admin Console.',
        isConfigured: false
      });
    }

    // Format line items for PayMongo (amount must be integer in Philippine centavos)
    let lineItems = [];
    if (Array.isArray(items) && items.length > 0) {
      lineItems = items.map(item => ({
        currency: 'PHP',
        amount: Math.round(Number(item.price || 0) * 100),
        name: item.name || 'Handcrafted Artisan Item',
        quantity: Math.max(1, Number(item.quantity || 1)),
        description: `Artisan item by ${item.sellerName || 'Verified Guild Member'}`
      }));
    } else {
      lineItems = [
        {
          currency: 'PHP',
          amount: Math.round(Number(total || 0) * 100),
          name: `ArtisanAisle Order #${orderNumber || orderId}`,
          quantity: 1
        }
      ];
    }

    const requestedTypes = Array.isArray(paymentMethodTypes) && paymentMethodTypes.length > 0
      ? paymentMethodTypes
      : ['gcash', 'paymaya', 'qrph'];

    const payload = {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          payment_method_types: requestedTypes,
          line_items: lineItems,
          description: `Payment for Order #${orderNumber || orderId} on ArtisanAisle`,
          reference_number: String(orderNumber || orderId),
          success_url: successUrl,
          cancel_url: cancelUrl
        }
      }
    };

    const authHeader = 'Basic ' + Buffer.from(secretKey.trim() + ':').toString('base64');

    const pmResponse = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader
      },
      body: JSON.stringify(payload)
    });

    const pmData = await pmResponse.json();

    if (!pmResponse.ok || pmData.errors) {
      const errMsg = (pmData.errors && pmData.errors[0]?.detail) || 'Failed to create PayMongo checkout session';
      return res.status(pmResponse.status || 400).json({
        success: false,
        error: errMsg,
        errors: pmData.errors
      });
    }

    const session = pmData.data;
    const checkoutUrl = session?.attributes?.checkout_url;

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      checkoutUrl: checkoutUrl
    });

  } catch (err) {
    console.error('PayMongo Checkout Session error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + err.message
    });
  }
}
