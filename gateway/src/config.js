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

  // ReachFar V28C: 10-digit protocol id → 15-digit IMEI = prefix + id[3..9] + suffix digit.
  // e.g. 9705314117 → 8613970 + 5314117 + 0 = 861397053141170
  imeiPrefix: process.env.IMEI_PREFIX || '8613970',
  imeiDefaultSuffix: process.env.IMEI_DEFAULT_SUFFIX || '0',
  // Optional overrides when suffix digit differs: "9705313987:861397053139877"
  imeiMap: process.env.IMEI_MAP || '',

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
