'use strict';

const crypto = require('crypto');
const { wearAt } = require('./wear-evidence');
const { cleanupWellnessRecords } = require('./wellness-retention');

const METRIC_SET = Object.freeze({
  SPO2: 'spo2',
  HEART_RATE_BLOOD_PRESSURE: 'heart_rate_blood_pressure',
  SKIN_TEMPERATURE: 'skin_temperature',
});

const DEVICE_MODE = Object.freeze({
  UNVERIFIED: 'unverified',
  ACCEPTED: 'accepted',
});

const CONSENT_MANAGERS = new Set(['guardian_admin', 'migration']);

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function integerInRange(value, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

/**
 * Validate packet shape and broad transport limits only. These bounds are not
 * clinical thresholds and must never be used to label a wearer safe, unsafe,
 * normal or abnormal.
 */
function normalizeWellbeingEvent(event, observedAt = new Date()) {
  if (!event || event.type !== 'health_reading') {
    return { ok: false, reason: 'unsupported_event' };
  }

  const imei = String(event.imei || '').trim();
  if (!/^\d{15}$/.test(imei)) {
    return { ok: false, reason: 'invalid_imei' };
  }

  const receivedAt = asDate(observedAt);
  if (!receivedAt) return { ok: false, reason: 'invalid_observed_at' };

  if (event.metric === 'spo2') {
    const spo2Percent = integerInRange(event.value, 1, 100);
    if (spo2Percent == null) {
      return { ok: false, reason: 'invalid_spo2_shape' };
    }
    return {
      ok: true,
      imei,
      metricSet: METRIC_SET.SPO2,
      values: { spo2Percent },
      measurementType: event.measurementType == null
        ? null
        : String(event.measurementType).slice(0, 32),
      sourceCommand: 'oxygen',
      observedAt: receivedAt,
    };
  }

  if (event.metric === 'heart_rate_bp') {
    const heartRateBpm = integerInRange(event.heartRate, 20, 250);
    const systolicMmHg = integerInRange(event.systolic, 40, 300);
    const diastolicMmHg = integerInRange(event.diastolic, 20, 200);
    if (
      heartRateBpm == null ||
      systolicMmHg == null ||
      diastolicMmHg == null ||
      systolicMmHg <= diastolicMmHg
    ) {
      return { ok: false, reason: 'invalid_heart_bp_shape' };
    }
    return {
      ok: true,
      imei,
      metricSet: METRIC_SET.HEART_RATE_BLOOD_PRESSURE,
      values: { heartRateBpm, systolicMmHg, diastolicMmHg },
      measurementType: null,
      sourceCommand: 'bphrt',
      observedAt: receivedAt,
    };
  }

  if (event.metric === 'skin_temperature') {
    // A watch-display comparison established this supported V52 response shape.
    // Prefix "1" is opaque: it does not establish success, wearing or mode.
    const args = event.args;
    if (event.sourceCommand !== 'btemp2' || !Array.isArray(args) ||
        args.length !== 2 || args[0] !== '1' || typeof args[1] !== 'string' ||
        !/^\d{2}\.\d{2}$/.test(args[1]) || Number(args[1]) <= 0 || Number(args[1]) > 60) {
      return { ok: false, reason: 'unsupported_temperature_shape' };
    }
    return { ok: true, imei, metricSet: METRIC_SET.SKIN_TEMPERATURE,
      values: { skinTemperatureCelsius: Number(args[1]) }, measurementType: null,
      sourceCommand: 'btemp2', sourceVariant: '1',
      observedAt: receivedAt };
  }

  return { ok: false, reason: 'unsupported_metric' };
}

function validConsent(data, now = new Date()) {
  if (!data || data.version !== 1 || data.status !== 'granted') return false;
  if (!CONSENT_MANAGERS.has(String(data.managedBy || ''))) return false;
  const acknowledgedAt = asDate(data.wearerAcknowledgedAt);
  if (!acknowledgedAt || acknowledgedAt > now) return false;
  const expiresAt = asDate(data.expiresAt);
  if (expiresAt && expiresAt <= now) return false;
  return !asDate(data.revokedAt);
}

function readingIdFor(reading, bucketMs = 120_000) {
  const bucket = Math.floor(reading.observedAt.getTime() / bucketMs);
  const valueText = Object.keys(reading.values)
    .sort()
    .map((key) => `${key}:${reading.values[key]}`)
    .join('|');
  return crypto
    .createHash('sha256')
    .update(`${reading.imei}|${reading.metricSet}|${valueText}|${bucket}|${reading.wearEvidence?.continuityId || reading.wearEvidence?.state || 'unknown'}`)
    .digest('hex')
    .slice(0, 32);
}

function buildWellbeingRequestCommand(metricSet) {
  if (metricSet === METRIC_SET.HEART_RATE_BLOOD_PRESSURE) {
    return 'hrtstart,1';
  }
  throw new Error(`No confirmed V52 request command for ${metricSet}`);
}

function buildWellbeingScheduleCommand({ enabled, intervalSeconds = 3600 } = {}) {
  if (enabled === false) return 'hrtstart,0';
  if (enabled !== true) {
    throw new Error('Wellbeing schedule requires enabled=true or enabled=false');
  }
  const interval = Number(intervalSeconds);
  if (!Number.isInteger(interval) || interval < 300 || interval > 65535) {
    throw new Error('Wellbeing interval must be a whole number from 300 to 65535 seconds');
  }
  return `hrtstart,${interval}`;
}

function createWellbeingStore({
  db,
  enabled = false,
  deviceMode = DEVICE_MODE.UNVERIFIED,
  customerEnabled = false,
  retentionDays = 30,
  temperatureTrialQuarantine,
  now = () => new Date(),
} = {}) {
  if (!Object.values(DEVICE_MODE).includes(deviceMode)) {
    throw new Error(`Unsupported Care wellbeing device mode: ${deviceMode}`);
  }
  const safeRetentionDays = Math.min(365, Math.max(1, Number(retentionDays) || 30));
  function trialExcluded(event) {
    if (event?.metric !== 'skin_temperature') return false;
    if (event.temperatureTrialOnly === true) return true;
    try { return temperatureTrialQuarantine?.excludes(event.imei) === true; }
    catch { return true; }
  }

  async function ingest(event, observedAt = now()) {
    if (!enabled) return { ok: false, status: 'disabled' };
    if (!db) return { ok: false, status: 'firestore_disabled' };
    if (trialExcluded(event)) return { ok: false, status: 'temperature_trial_excluded' };

    const normalized = normalizeWellbeingEvent(event, observedAt);
    if (!normalized.ok) {
      return { ok: false, status: 'invalid', reason: normalized.reason };
    }

    const temperature = normalized.metricSet === METRIC_SET.SKIN_TEMPERATURE;
    if (temperature && (normalized.observedAt > now() ||
        normalized.observedAt <= new Date(+now() - safeRetentionDays * 86400_000))) {
      return { ok: false, status: 'outside_retention_window', metricSet: normalized.metricSet };
    }

    // Capture qualification at receipt, before any consent/database await.
    const wearEvidence = wearAt(event.wearEvidence, normalized.observedAt);
    normalized.wearEvidence = wearEvidence;
    const consentSnap = await db.collection('wellbeingConsents').doc(normalized.imei).get();
    if (!consentSnap.exists || !validConsent(consentSnap.data(), now())) {
      return {
        ok: false,
        status: 'consent_required',
        metricSet: normalized.metricSet,
      };
    }
    // A quarantine may begin while consent is loading. Conversely, the event's
    // receipt marker remains excluding even if a worn trial has since resumed.
    if (trialExcluded(event)) return { ok: false, status: 'temperature_trial_excluded' };

    // Customer access is intentionally separate from wearing qualification.
    // Values are displayed as estimates; consent, plan access and freshness
    // remain enforced by the client and Firestore rules.
    const displayable = customerEnabled === true;
    const accepted = !temperature &&
      deviceMode === DEVICE_MODE.ACCEPTED && wearEvidence.eligible;
    const id = readingIdFor(normalized);
    const ref = db
      .collection('devices')
      .doc(normalized.imei)
      .collection('wellbeingReadings')
      .doc(id);
    const payload = {
      schemaVersion: 1,
      imei: normalized.imei,
      metricSet: normalized.metricSet,
      values: normalized.values,
      measurementType: normalized.measurementType,
      source: 'v52_upload',
      sourceCommand: normalized.sourceCommand,
      ...(temperature ? { sourceVariant: normalized.sourceVariant } : {}),
      observedAt: normalized.observedAt,
      receivedAt: normalized.observedAt,
      quality: accepted ? 'device_accepted' : 'transport_valid_unverified',
      deviceMode: temperature ? DEVICE_MODE.UNVERIFIED : deviceMode,
      wearQualityVersion: 1, wearEvidence,
      wearQualified: wearEvidence.eligible,
      wearReason: wearEvidence.reason,
      timeBasis: 'gateway_receipt_not_measurement_time',
      displayable,
      expiresAt: new Date(
        normalized.observedAt.getTime() + safeRetentionDays * 24 * 60 * 60 * 1000
      ),
    };

    try {
      if (typeof ref.create === 'function') await ref.create(payload);
      else await ref.set(payload);
    } catch (error) {
      if (error?.code === 6 || error?.code === 'already-exists') {
        return {
          ok: true,
          status: 'duplicate',
          id,
          metricSet: normalized.metricSet,
          displayable,
        };
      }
      throw error;
    }

    return {
      ok: true,
      status: 'stored',
      id,
      metricSet: normalized.metricSet,
      displayable,
    };
  }

  async function cleanupExpired({ limit = 200 } = {}) {
    if (!enabled || !db) return { deleted: 0 };
    const snap = await db
      .collectionGroup('wellbeingReadings')
      .where('expiresAt', '<=', now())
      .limit(Math.min(500, Math.max(1, Number(limit) || 200)))
      .get();
    if (snap.empty) return { deleted: 0 };
    return cleanupWellnessRecords(db, snap.docs, { now: now(),
      canRetain: async imei => {
        const consent = await db.collection('wellbeingConsents').doc(imei).get();
        return consent.exists && validConsent(consent.data(), now());
      },
    });
  }

  return Object.freeze({ ingest, cleanupExpired });
}

module.exports = {
  METRIC_SET,
  DEVICE_MODE,
  normalizeWellbeingEvent,
  validConsent,
  readingIdFor,
  buildWellbeingRequestCommand,
  buildWellbeingScheduleCommand,
  createWellbeingStore,
};
