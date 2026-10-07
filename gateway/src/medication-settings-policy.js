'use strict';
const { loadEntitlementsForUser } = require('./entitlements');
class MedicationError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
function medicationRuntime(env = process.env) {
  const imei = env.VOICE_MEDICATION_PILOT_IMEI || '', uid = env.VOICE_MEDICATION_PILOT_UID || '';
  return { imei, uid, enabled: env.VOICE_MEDICATION_PILOT_ENABLED === 'true'
    && /^\d{15}$/.test(imei) && /^[^/\s]{1,128}$/.test(uid) };
}
async function authorizeMedication({ db, uid, imei, runtime, now = new Date() }) {
  if (!runtime.enabled || uid !== runtime.uid || imei !== runtime.imei) throw new MedicationError('feature_unavailable', 403);
  const snap = await db.collection('users').doc(uid).get();
  const user = { ...snap.data(), uid };
  if (!snap.exists || !user.linkedImeis?.includes(imei)) throw new MedicationError('device_not_linked', 403);
  try { await require('./family-policy').watchAccess(db, uid, imei, 'reminders', { now: +now }); } catch { throw new MedicationError('device_not_linked', 403); }
  const access = await loadEntitlementsForUser(db, user, { now, imei });
  if (!access.serviceActive || !['family', 'care'].includes(access.plan)) throw new MedicationError('active_service_required', 403);
  return { uid, imei, ownerUid: access.ownerUid };
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function medicationRequest(value) {
  if (!value || Object.keys(value).some(k => !['requestId', 'id', 'version', 'settings', 'pcm', 'action'].includes(k))
      || !UUID.test(value.requestId || '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id || '')
      || !Number.isSafeInteger(value.version) || value.version < 0
      || !['save', 'delete'].includes(value.action)) throw new MedicationError('invalid_request', 400);
  const s = value.settings;
  if (!s || Object.keys(s).sort().join(',') !== 'enabled,frequency,mode,text,time'
      || typeof s.enabled !== 'boolean' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time || '')
      || ![1, 2].includes(s.frequency) || !['voice', 'alert'].includes(s.mode)
      || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 80
      || (value.action === 'delete' && s.enabled)) throw new MedicationError('invalid_settings', 400);
  // Validate UTF-16 before encoding; reject lone surrogate code units.
  for (const character of s.text) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new MedicationError('invalid_settings', 400);
  }
  if (value.pcm != null && (typeof value.pcm !== 'string' || value.pcm.length > 213336
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.pcm)
      || s.mode !== 'voice')) throw new MedicationError('invalid_recording', 400);
  return { ...value, settings: { ...s, text: s.text.trim() } };
}
function publicReminder(id, data, now = Date.now()) {
  const interrupted = ['waiting', 'sending'].includes(data.deviceSyncStatus) && data.leaseUntilMs <= now;
  return { id, time: data.time, frequency: data.frequency, enabled: data.enabled,
    text: data.text, mode: data.mode || 'alert', slot: data.slot || data.frequency,
    version: data.version || 0, managed: data.managed === 'voice-v1',
    durationMs: data.durationMs || 0, deleted: !!data.deletedAt,
    status: interrupted ? 'unconfirmed' : data.deviceSyncStatus || 'unknown',
    reason: interrupted ? 'gateway_interrupted' : data.deviceSyncError || null };
}
module.exports = { MedicationError, medicationRuntime, authorizeMedication, medicationRequest, publicReminder };
