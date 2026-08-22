'use strict';

// Kept separate from the shared device configuration so this draft service
// can be reviewed and removed without changing any existing device identity
// or connection defaults.
module.exports = Object.freeze({
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  enabled:
    String(process.env.SOS_VOICE_MESSAGES_ENABLED || 'false').toLowerCase() === 'true',
  templateName:
    process.env.META_WHATSAPP_SOS_VOICE_TEMPLATE || 'guardian_sos_voice_ready_v1',
  retentionHours: Math.max(
    1,
    Math.min(24, Number(process.env.SOS_VOICE_RETENTION_HOURS || 24))
  ),
  cleanupMinutes: Math.max(
    5,
    Number(process.env.SOS_VOICE_CLEANUP_MINUTES || 15)
  ),
});
