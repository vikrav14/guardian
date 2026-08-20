/**
 * Email Alert Sender
 * Sends alerts to email via Gmail SMTP
 */

const nodemailer = require('nodemailer');
const Logger = require('./logger');

const log = new Logger({ module: 'email-alert' });

let transporter = null;

/**
 * Initialize email transporter
 */
function initEmailTransporter() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    log.warn('Gmail credentials not configured. Email alerts disabled.');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPassword,
      },
    });

    log.info('Email transporter initialized', { user: gmailUser });
    return transporter;
  } catch (err) {
    log.error('Failed to initialize email transporter', { error: err.message });
    return null;
  }
}

/**
 * Send alert email
 */
async function sendAlertEmail(toEmail, subject, htmlContent) {
  if (!transporter) {
    transporter = initEmailTransporter();
  }

  if (!transporter) {
    log.warn('Email transporter not available, skipping email');
    return { success: false, reason: 'transporter_not_configured' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: toEmail,
      subject: `[Guardian Alert] ${subject}`,
      html: htmlContent,
    });

    log.info('Alert email sent', { to: toEmail, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    log.error('Failed to send alert email', { to: toEmail, error: err.message });
    return { success: false, reason: err.message };
  }
}

/**
 * Format alert as HTML email
 */
function formatAlertEmail(alert) {
  const severityColor = {
    critical: '#ff6b6b',
    warning: '#ffa500',
    info: '#4a90e2',
  }[alert.severity] || '#999';

  const html = `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { border-left: 4px solid ${severityColor}; padding-left: 16px; margin-bottom: 20px; }
          h1 { margin: 0; color: ${severityColor}; font-size: 24px; }
          .severity { display: inline-block; background: ${severityColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-top: 8px; }
          .content { background: #f9f9f9; padding: 16px; border-radius: 4px; margin: 20px 0; }
          .content p { margin: 8px 0; color: #333; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 16px; }
          .button { display: inline-block; background: #4caf50; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; margin-top: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Guardian Alert</h1>
            <span class="severity">${alert.severity.toUpperCase()}</span>
          </div>

          <div class="content">
            <p><strong>Type:</strong> ${alert.type}</p>
            <p><strong>Message:</strong> ${alert.message}</p>
            <p><strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}</p>
            ${alert.context ? `<p><strong>Context:</strong></p><pre>${JSON.stringify(alert.context, null, 2)}</pre>` : ''}
          </div>

          <a href="http://localhost:9001/dashboard" class="button">View Dashboard</a>

          <div class="footer">
            <p>This is an automated alert from Guardian AI System.</p>
            <p>Dashboard: http://localhost:9001/dashboard</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return html;
}

/**
 * Send critical alert email
 */
async function sendCriticalAlert(toEmail, alert) {
  const html = formatAlertEmail(alert);
  return sendAlertEmail(toEmail, `CRITICAL: ${alert.message}`, html);
}

/**
 * Send warning alert email
 */
async function sendWarningAlert(toEmail, alert) {
  const html = formatAlertEmail(alert);
  return sendAlertEmail(toEmail, `WARNING: ${alert.message}`, html);
}

module.exports = {
  initEmailTransporter,
  sendAlertEmail,
  sendCriticalAlert,
  sendWarningAlert,
  formatAlertEmail,
};
