'use strict';

const CARE_REMINDER_KINDS = Object.freeze(['routine', 'accessibility', 'sedentary']);
const SYNC_STATE = Object.freeze({
  BACKEND_ONLY: 'backend_only',
  BLOCKED_UNVERIFIED: 'blocked_unverified',
  READY_FOR_ACCEPTANCE: 'ready_for_acceptance',
  SENT: 'sent',
  FAILED: 'failed',
});

function normalizeClock(value, fieldName = 'time') {
  const text = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new Error(`${fieldName} must use HH:MM 24-hour format`);
  }
  return text;
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('weekdays must contain at least one ISO weekday (1-7)');
  }
  const days = [...new Set(value.map(Number))].sort((a, b) => a - b);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error('weekdays must contain only ISO weekday integers 1-7');
  }
  return days;
}

function normalizeQuietHours(value) {
  if (value == null) return null;
  if (typeof value !== 'object') throw new Error('quietHours must be an object');
  return Object.freeze({
    start: normalizeClock(value.start, 'quietHours.start'),
    end: normalizeClock(value.end, 'quietHours.end'),
  });
}

function normalizeLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ');
  if (!label || label.length > 80) {
    throw new Error('label must contain 1-80 characters');
  }
  if (/[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('label contains unsupported control characters');
  }
  return label;
}

function buildCareReminderSchedule(input, { now = new Date() } = {}) {
  const kind = String(input?.kind || '').trim().toLowerCase();
  if (!CARE_REMINDER_KINDS.includes(kind)) {
    throw new Error(`kind must be one of: ${CARE_REMINDER_KINDS.join(', ')}`);
  }
  const imei = String(input?.imei || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('imei must be a 15-digit device identifier');

  return Object.freeze({
    imei,
    kind,
    label: normalizeLabel(input.label),
    localTime: normalizeClock(input.localTime, 'localTime'),
    weekdays: Object.freeze(normalizeWeekdays(input.weekdays)),
    enabled: input.enabled !== false,
    quietHours: normalizeQuietHours(input.quietHours),
    timezone: 'Indian/Mauritius',
    acknowledgementSupported: false,
    acknowledgementState: 'unavailable',
    syncState: SYNC_STATE.BLOCKED_UNVERIFIED,
    syncReason: 'exact_v52_reminder_protocol_not_accepted',
    deviceCommand: null,
    createdAt: now,
    updatedAt: now,
  });
}

function minutesSinceMidnight(clock) {
  const [hour, minute] = normalizeClock(clock).split(':').map(Number);
  return hour * 60 + minute;
}

function isWithinQuietHours(clock, quietHours) {
  if (!quietHours) return false;
  const now = minutesSinceMidnight(clock);
  const start = minutesSinceMidnight(quietHours.start);
  const end = minutesSinceMidnight(quietHours.end);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function evaluateWatchSync(schedule, {
  featureEnabled = false,
  deviceMode = 'unverified',
  acceptedProtocol = false,
  localClock = null,
} = {}) {
  if (!featureEnabled) {
    return Object.freeze({ allowed: false, state: SYNC_STATE.BACKEND_ONLY, reason: 'feature_disabled' });
  }
  if (!acceptedProtocol || deviceMode !== 'accepted') {
    return Object.freeze({ allowed: false, state: SYNC_STATE.BLOCKED_UNVERIFIED, reason: 'protocol_unverified' });
  }
  if (localClock && isWithinQuietHours(localClock, schedule?.quietHours)) {
    return Object.freeze({ allowed: false, state: SYNC_STATE.READY_FOR_ACCEPTANCE, reason: 'quiet_hours' });
  }
  return Object.freeze({ allowed: true, state: SYNC_STATE.READY_FOR_ACCEPTANCE, reason: null });
}

function recordDeliveryEvidence(schedule, evidence = {}) {
  const transportAccepted = evidence.transportAccepted === true;
  return Object.freeze({
    ...schedule,
    syncState: transportAccepted ? SYNC_STATE.SENT : SYNC_STATE.FAILED,
    syncReason: transportAccepted ? null : String(evidence.reason || 'transport_failed'),
    lastSyncAttemptAt: evidence.at || new Date(),
    acknowledgementSupported: false,
    acknowledgementState: 'unavailable',
  });
}

module.exports = {
  CARE_REMINDER_KINDS,
  SYNC_STATE,
  normalizeClock,
  normalizeWeekdays,
  normalizeQuietHours,
  buildCareReminderSchedule,
  isWithinQuietHours,
  evaluateWatchSync,
  recordDeliveryEvidence,
};
