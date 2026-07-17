require('dotenv').config();
const path = require('path');

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 9000),
  firestoreDisabled: String(process.env.FIRESTORE_DISABLED || 'false').toLowerCase() === 'true',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : '',
  writeLocationHistory: String(process.env.WRITE_LOCATION_HISTORY || 'false').toLowerCase() === 'true',

  // Twilio (optional — without these, notifications are logged only)
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromSms: process.env.TWILIO_FROM_SMS || '',
  twilioWhatsAppFrom: process.env.TWILIO_WHATSAPP_FROM || '',
  notifySms: String(process.env.NOTIFY_SMS || 'true').toLowerCase() === 'true',
  notifyWhatsApp: String(process.env.NOTIFY_WHATSAPP || 'true').toLowerCase() === 'true',

  // HTTP (WhatsApp webhook + /dev/chat)
  httpPort: Number(process.env.HTTP_PORT || 9001),

  // Claude (WhatsApp AI assistant)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
};

module.exports = config;
