'use strict';

const { loadEntitlementsForUser } = require('./entitlements');

class MovementError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

// A supervised, explicit user/device pair; this does not activate a plan feature.
function movementRuntime(env = process.env) {
  const imei = env.MOVEMENT_REMINDER_PILOT_IMEI || '';
  const uid = env.MOVEMENT_REMINDER_PILOT_UID || '';
  return {
    enabled: env.MOVEMENT_REMINDER_PILOT_ENABLED === 'true' && /^\d{15}$/.test(imei)
      && /^[^/\s]{1,128}$/.test(uid),
    imei, uid,
  };
}

async function authorizeMovement({ db, uid, imei, runtime, now = new Date() }) {
  if (!runtime.enabled || uid !== runtime.uid || imei !== runtime.imei) {
    throw new MovementError('pilot_not_available', 403);
  }
  const snap = await db.collection('users').doc(uid).get();
  const user = { ...(snap.data() || {}), uid };
  if (!snap.exists || !Array.isArray(user.linkedImeis) || !user.linkedImeis.includes(imei)) {
    throw new MovementError('device_not_linked', 403);
  }
  const access = await loadEntitlementsForUser(db, user, { now });
  if (!access.serviceActive || !['family', 'care'].includes(access.plan)) {
    throw new MovementError('active_service_required', 403);
  }
  return { uid, imei, ownerUid: access.ownerUid };
}

function clockMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new MovementError('invalid_active_hours', 400);
  }
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function movementSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'enabled,end,intervalMinutes,start,timezone'
      || typeof value.enabled !== 'boolean' || value.intervalMinutes !== 20
      || value.timezone !== 'Indian/Mauritius') {
    throw new MovementError('invalid_settings', 400);
  }
  const start = clockMinutes(value.start);
  const end = clockMinutes(value.end);
  if (end - start < 25) throw new MovementError('active_window_too_short', 400);
  return { enabled: value.enabled, intervalMinutes: 20, start: value.start,
    end: value.end, timezone: 'Indian/Mauritius' };
}

function movementCommands(settings) {
  const s = movementSettings(settings);
  // Disable alone never changes worktime. On is only attempted after both
  // preceding commands get a reply. Replies still do not prove application.
  return s.enabled
    ? ['SEDENTARY,0,20', `SEDENTARYWORKTIME,${s.start}-${s.end},-`, 'SEDENTARY,1,20']
    : ['SEDENTARY,0,20'];
}

function movementFrame(protocolId, command) {
  if (!/^\d{10}$/.test(protocolId)) throw new MovementError('identity_unavailable');
  if (!/^SEDENTARY,[01],20$/.test(command)) {
    const match = /^SEDENTARYWORKTIME,([^,]+)-([^,]+),-$/.exec(command);
    if (!match) throw new MovementError('unsupported_command', 400);
    movementSettings({ enabled: true, intervalMinutes: 20, start: match[1], end: match[2],
      timezone: 'Indian/Mauritius' });
  }
  // Exact supplier framing that changed the pilot menu (28 September 2026).
  return Buffer.from(`[3G*${protocolId}*${Buffer.byteLength(command).toString(16).padStart(4, '0')}*${command}]`, 'ascii');
}

module.exports = { MovementError, movementRuntime, authorizeMovement, movementSettings,
  movementCommands, movementFrame };
