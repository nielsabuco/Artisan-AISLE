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
      subtotal,
      shipping,
      discount,
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

    const orderTotal = Number(total || 0);
    const shippingFee = Number(shipping || 0);
    const discountAmount = Number(discount || 0);
    const targetTotalCentavos = Math.round(orderTotal * 100);

    // Format line items for PayMongo (amount must be integer in Philippine centavos)
    let lineItems = [];
    if (Array.isArray(items) && items.length > 0 && targetTotalCentavos > 0) {
      const originalSubtotal = items.reduce((acc, item) => acc + (Number(item.price || 0) * Math.max(1, Number(item.quantity || 1))), 0);
      const netMerchandiseTotal = Math.max(0, (Number(subtotal) || originalSubtotal) - discountAmount);

      // If discount applied, distribute discount proportionally across items
      const discountScale = (originalSubtotal > 0 && discountAmount > 0)
        ? Math.max(0, netMerchandiseTotal / originalSubtotal)
        : 1.0;

      lineItems = items.map(item => {
        const unitPrice = Number(item.price || 0);
        const adjustedUnitPrice = Math.max(1, Math.round(unitPrice * discountScale));
        return {
          currency: 'PHP',
          amount: Math.round(adjustedUnitPrice * 100),
          name: discountAmount > 0 ? `${item.name || 'Artisan Item'} (Discounted)` : (item.name || 'Handcrafted Artisan Item'),
          quantity: Math.max(1, Number(item.quantity || 1)),
          description: `Artisan item by ${item.sellerName || 'Verified Guild Member'}`
        };
      });

      // Explicitly append Shipping & Delivery Fee as a distinct line item
      if (shippingFee > 0) {
        lineItems.push({
          currency: 'PHP',
          amount: Math.round(shippingFee * 100),
          name: 'Shipping & Delivery Fee',
          quantity: 1,
          description: 'Courier delivery fee for standard shipping'
        });
      }

      // Reconcile any single-centavo rounding differences with target order total
      const currentSumCentavos = lineItems.reduce((acc, li) => acc + (li.amount * li.quantity), 0);
      const centavoDiff = targetTotalCentavos - currentSumCentavos;
      if (centavoDiff !== 0 && lineItems.length > 0) {
        lineItems[0].amount = Math.max(100, lineItems[0].amount + centavoDiff);
      }
    } else {
      // Single consolidated line item including shipping fee
      lineItems = [
        {
          currency: 'PHP',
          amount: Math.max(100, targetTotalCentavos),
          name: `ArtisanAisle Order #${orderNumber || orderId}`,
          quantity: 1,
          description: shippingFee > 0 
            ? `Order total (includes ₱${shippingFee.toFixed(2)} shipping fee)` 
            : 'Artisan order total'
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
