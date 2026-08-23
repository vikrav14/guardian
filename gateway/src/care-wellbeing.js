'use strict';

const crypto = require('crypto');

const METRIC_SET = Object.freeze({
  SPO2: 'spo2',
  HEART_RATE_BLOOD_PRESSURE: 'heart_rate_blood_pressure',
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
    .update(`${reading.imei}|${reading.metricSet}|${valueText}|${bucket}`)
    .digest('hex')
    .slice(0, 32);
}

function buildWellbeingRequestCommand(metricSet) {
  if (metricSet === METRIC_SET.HEART_RATE_BLOOD_PRESSURE) {
    return 'hrtstart,1';
  }
  throw new Error(`No confirmed V52 request command for ${metricSet}`);
}

function createWellbeingStore({
  db,
  enabled = false,
  deviceMode = DEVICE_MODE.UNVERIFIED,
  customerEnabled = false,
  retentionDays = 30,
  now = () => new Date(),
} = {}) {
  if (!Object.values(DEVICE_MODE).includes(deviceMode)) {
    throw new Error(`Unsupported Care wellbeing device mode: ${deviceMode}`);
  }
  const safeRetentionDays = Math.min(365, Math.max(1, Number(retentionDays) || 30));

  async function ingest(event, observedAt = now()) {
    if (!enabled) return { ok: false, status: 'disabled' };
    if (!db) return { ok: false, status: 'firestore_disabled' };

    const normalized = normalizeWellbeingEvent(event, observedAt);
    if (!normalized.ok) {
      return { ok: false, status: 'invalid', reason: normalized.reason };
    }

    const consentSnap = await db.collection('wellbeingConsents').doc(normalized.imei).get();
    if (!consentSnap.exists || !validConsent(consentSnap.data(), now())) {
      return {
        ok: false,
        status: 'consent_required',
        metricSet: normalized.metricSet,
      };
    }

    const displayable = deviceMode === DEVICE_MODE.ACCEPTED && customerEnabled === true;
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
      observedAt: normalized.observedAt,
      receivedAt: normalized.observedAt,
      quality: displayable ? 'device_accepted' : 'transport_valid_unverified',
      deviceMode,
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
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return { deleted: snap.size };
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
  createWellbeingStore,
};
