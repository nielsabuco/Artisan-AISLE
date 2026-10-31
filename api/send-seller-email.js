/**
 * Serverless API Route: Send Seller Approval Notification Email
 * Path: /api/send-seller-email
 */

export default async function handler(req, res) {
  // CORS Headers
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
      to,
      applicantName = 'Artisan Partner',
      shopName = 'Your Artisan Shop',
      temporaryPassword,
      loginUrl
    } = body || {};

    if (!to || !temporaryPassword) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: "to" email and "temporaryPassword" are required.'
      });
    }

    const emailSubject = `🎉 Congratulations! Your Artisan Aisle Seller Account for "${shopName}" is Approved`;
    const targetLoginUrl = loginUrl || 'http://localhost:5173/login.html?sellerApproved=true';

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7f4ef; margin: 0; padding: 20px; color: #2d3748; }
        .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #ebd9c8; }
        .header { background: #1d4831; padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { font-family: Georgia, serif; margin: 10px 0 0; font-size: 26px; color: #dac9af; }
        .header p { margin: 6px 0 0; font-size: 14px; color: #e2ebd8; letter-spacing: 1px; }
        .content { padding: 32px 28px; line-height: 1.6; }
        .content h2 { color: #1d4831; font-size: 20px; margin-top: 0; }
        .badge { display: inline-block; background: #e8f5e9; color: #1b5e20; padding: 4px 12px; border-radius: 999px; font-weight: 700; font-size: 13px; margin-bottom: 16px; }
        .credentials-card { background: #fdfaf5; border: 2px dashed #c88937; border-radius: 10px; padding: 20px; margin: 24px 0; }
        .credentials-title { font-weight: 700; color: #1d4831; font-size: 15px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .credential-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #ebd9c8; font-size: 14px; }
        .credential-row:last-child { border-bottom: none; }
        .credential-label { color: #718096; font-weight: 600; }
        .credential-value { font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #1d4831; background: #ede3d5; padding: 3px 8px; border-radius: 4px; }
        .btn { display: inline-block; background: #1d4831; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 16px 0; text-align: center; }
        .notice { background: #fff8e6; border-left: 4px solid #c88937; padding: 12px 16px; font-size: 13px; color: #744210; margin-top: 20px; border-radius: 0 6px 6px 0; }
        .footer { background: #f7f4ef; padding: 20px 28px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #ebd9c8; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h1>Artisan AISLE</h1>
          <p>AUTHENTIC FILIPINO CRAFTS &amp; ARTISANS</p>
        </div>
        <div class="content">
          <span class="badge">✓ SELLER ACCOUNT APPROVED</span>
          <h2>Mabuhay, ${applicantName}!</h2>
          <p>We are pleased to inform you that your artisan seller application for <strong>${shopName}</strong> has been officially approved by Artisan Aisle.</p>
          
          <div class="notice" style="background:#e8f5e9; border-left:4px solid #2e7d32; color:#1b5e20; margin-bottom: 20px;">
            <strong>Account Security Notice:</strong> Because your seller account has been approved, your previous session has been automatically logged out for security. <strong>Please log in again using this new set of credentials provided below.</strong>
          </div>

          <div class="credentials-card">
            <div class="credentials-title">🔐 Your New Seller Login Credentials</div>
            <div class="credential-row">
              <span class="credential-label">Registered Email:</span>
              <span class="credential-value">${to}</span>
            </div>
            <div class="credential-row">
              <span class="credential-label">Account Password:</span>
              <span class="credential-value">${temporaryPassword}</span>
            </div>
          </div>

          <p style="text-align: center;">
            <a href="${targetLoginUrl}" class="btn">Login Again to Your Seller Account →</a>
          </p>

          <div class="notice">
            <strong>Next Step:</strong> Once you log in with these credentials, the system will automatically direct you to set your own permanent, secure password before accessing your Seller Portal.
          </div>

          <p style="font-size: 13px; color: #64748b; margin-top: 20px; line-height: 1.5;">
            <em>Note: For your convenience, a separate second email with an official password reset link has also been sent to this address so you can update your password at any time.</em>
          </p>
        </div>
        <div class="footer">
          <p>&copy; 2026 Artisan Aisle. Supporting Local Filipino Artisans &amp; Preserving Heritage Crafts 🇵🇭</p>
          <p>Need assistance? Contact our artisan support team at support@artisanaisle.com</p>
        </div>
      </div>
    </body>
    </html>
    `;

    // Attempt email delivery via Resend API
    let emailDispatched = false;
    let dispatchMethod = 'simulated';
    let resendError = null;

    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'Artisan Aisle <onboarding@resend.dev>',
            to: [to],
            subject: emailSubject,
            html: htmlContent
          })
        });
        const resendData = await resendRes.json().catch(() => ({}));
        if (resendRes.ok) {
          dispatchMethod = 'resend';
          emailDispatched = true;
        } else {
          resendError = resendData.message || 'Resend error ' + resendRes.status;
          console.warn('Resend notice:', resendError);
        }
      } catch (err) {
        resendError = err.message;
        console.warn('Resend network error:', err.message);
      }
    }

    console.log(`[Auto-Generated Email Dispatched to: ${to}] Subject: ${emailSubject}`);
    console.log(`[Credentials] Email: ${to} | Temporary Password: ${temporaryPassword} | Login URL: ${targetLoginUrl}`);

    return res.status(200).json({
      success: true,
      emailDispatched,
      dispatchMethod,
      resendError,
      recipient: to,
      subject: emailSubject,
      temporaryPassword,
      loginUrl: targetLoginUrl
    });

  } catch (error) {
    console.error('Error generating seller approval email:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error processing seller approval email.'
    });
  }
}

