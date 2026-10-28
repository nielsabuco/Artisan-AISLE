/**
 * Serverless API Route: Verify PayMongo Checkout Session
 * Path: /api/verify-paymongo-checkout
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const sessionId = (req.query?.sessionId) || body?.sessionId;
    const apiKey = body?.apiKey || process.env.PAYMONGO_SECRET_KEY;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    if (!apiKey || apiKey.includes('placeholder')) {
      // In sandbox/dev without keys, return simulated paid state
      return res.status(200).json({
        success: true,
        paid: true,
        simulated: true,
        status: 'paid',
        paymentId: 'pay_sim_' + Math.random().toString(36).substring(2, 10)
      });
    }

    const authHeader = 'Basic ' + Buffer.from(apiKey.trim() + ':').toString('base64');

    const pmResponse = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${sessionId}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader
      }
    });

    const pmData = await pmResponse.json();

    if (!pmResponse.ok || pmData.errors) {
      return res.status(pmResponse.status || 400).json({
        success: false,
        error: (pmData.errors && pmData.errors[0]?.detail) || 'Failed to retrieve PayMongo session'
      });
    }

    const session = pmData.data;
    const payments = session?.attributes?.payments || [];
    const isPaid = session?.attributes?.status === 'paid' || payments.length > 0;
    const paymentId = payments[0]?.id || session.id;

    return res.status(200).json({
      success: true,
      paid: isPaid,
      status: session?.attributes?.status,
      paymentId: paymentId
    });

  } catch (err) {
    console.error('Verify PayMongo error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
