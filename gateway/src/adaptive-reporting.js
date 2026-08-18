'use strict';

const { sendDeviceCommand } = require('./commands');
const { setDeviceReportingContext } = require('./sessions');

const BATTERY_POLICY = Object.freeze([
  { min: 60, seconds: 60, reason: 'battery_high' },
  { min: 30, seconds: 300, reason: 'battery_balanced' },
  { min: 15, seconds: 600, reason: 'battery_saver' },
  { min: 0, seconds: 900, reason: 'battery_critical' },
]);

const SOS_ACTIVE_MS = 30 * 60 * 1000;
const SOS_COOLDOWN_MS = 15 * 60 * 1000;
const NORMAL_COMMAND_COOLDOWN_MS = 10 * 60 * 1000;
const OUTING_REPORTING_SECONDS = 60;
const CRITICAL_BATTERY_PERCENT = 15;

const stateByImei = new Map();

function policyForBattery(batteryPercent) {
  const battery = Number(batteryPercent);
  if (!Number.isFinite(battery)) {
    return { seconds: 600, reason: 'battery_unknown' };
  }
  for (const band of BATTERY_POLICY) {
    if (battery >= band.min) return { seconds: band.seconds, reason: band.reason };
  }
  return { seconds: 900, reason: 'battery_critical' };
}

function effectivePolicy({
  batteryPercent,
  outingActive = false,
  nowMs = Date.now(),
  sosActiveUntilMs = 0,
  sosCooldownUntilMs = 0,
}) {
  const battery = Number(batteryPercent);

  if (nowMs < sosActiveUntilMs) {
    if (Number.isFinite(battery) && battery < 15) {
      return { seconds: 300, reason: 'sos_critical_battery' };
    }
    return { seconds: 60, reason: 'sos_emergency_override' };
  }

  // Safety while away from a confirmed origin outranks the normal battery
  // bands. The real V52 test showed that dropping to 300 seconds during an
  // outing can leave a long indoor interval with no recovery opportunity.
  if (outingActive) {
    if (Number.isFinite(battery) && battery < CRITICAL_BATTERY_PERCENT) {
      return { seconds: 300, reason: 'outing_critical_battery' };
    }
    return { seconds: OUTING_REPORTING_SECONDS, reason: 'outing_active' };
  }

  if (nowMs < sosCooldownUntilMs) {
    return { seconds: 300, reason: 'sos_cooldown' };
  }

  return policyForBattery(batteryPercent);
}

function appliedIntervalSeconds(data = {}, adaptive = {}) {
  const candidates = [
    data.locationReportingIntervalSeconds,
    adaptive.appliedIntervalSeconds,
  ];
  for (const value of candidates) {
    const seconds = Number(value);
    if (Number.isInteger(seconds) && seconds > 0) return seconds;
  }
  return null;
}

function markSos(imei, nowMs = Date.now()) {
  const current = stateByImei.get(imei) || {};
  const sosActiveUntilMs = nowMs + SOS_ACTIVE_MS;
  const sosCooldownUntilMs = sosActiveUntilMs + SOS_COOLDOWN_MS;
  stateByImei.set(imei, {
    ...current,
    sosActiveUntilMs,
    sosCooldownUntilMs,
  });
  return { sosActiveUntilMs, sosCooldownUntilMs };
}

function getState(imei) {
  return stateByImei.get(imei) || {};
}

function shouldSend({
  desiredSeconds,
  lastRequestedSeconds,
  lastCommandAtMs,
  nowMs = Date.now(),
  urgent = false,
}) {
  if (desiredSeconds === lastRequestedSeconds) return false;
  if (urgent) return true;
  if (!lastCommandAtMs) return true;
  return nowMs - lastCommandAtMs >= NORMAL_COMMAND_COOLDOWN_MS;
}

async function applyAdaptiveReporting(db, imei, {
  batteryPercent,
  outingActive = false,
  trigger = 'telemetry',
  nowMs = Date.now(),
  force = false,
} = {}) {
  if (!db || !imei) return { changed: false, reason: 'missing_context' };

  const deviceRef = db.collection('devices').doc(imei);
  const snap = await deviceRef.get();
  const data = snap.data() || {};

  const mode = data.locationReportingMode || 'automatic';
  if (mode !== 'automatic') {
    return {
      changed: false,
      mode,
      reason: 'manual_mode',
      seconds: data.locationReportingIntervalSeconds || null,
    };
  }

  const memory = getState(imei);
  const adaptive = data.adaptiveReporting || {};
  const sosActiveUntilMs = Math.max(
    memory.sosActiveUntilMs || 0,
    adaptive.sosActiveUntil?.toMillis?.() || 0,
  );
  const sosCooldownUntilMs = Math.max(
    memory.sosCooldownUntilMs || 0,
    adaptive.sosCooldownUntil?.toMillis?.() || 0,
  );

  const policy = effectivePolicy({
    batteryPercent,
    outingActive,
    nowMs,
    sosActiveUntilMs,
    sosCooldownUntilMs,
  });

  // `desiredIntervalSeconds` is intent, not proof that the command reached the
  // watch. Using it as the applied value made a cooldown-blocked change appear
  // complete and prevented later retries.
  const lastRequestedSeconds = appliedIntervalSeconds(data, adaptive);

  const lastCommandAtMs = adaptive.lastCommandAt?.toMillis?.() || 0;
  const urgent =
    force ||
    policy.reason.startsWith('sos_') ||
    policy.reason.startsWith('outing_');

  const send = shouldSend({
    desiredSeconds: policy.seconds,
    lastRequestedSeconds,
    lastCommandAtMs,
    nowMs,
    urgent,
  });

  if (!send) {
    setDeviceReportingContext(imei, {
      expectedReportingIntervalSeconds: lastRequestedSeconds,
      outingActive,
    });

    await deviceRef.set({
      locationReportingMode: 'automatic',
      adaptiveReporting: {
        ...adaptive,
        desiredIntervalSeconds: policy.seconds,
        ...(lastRequestedSeconds != null
          ? { appliedIntervalSeconds: lastRequestedSeconds }
          : {}),
        reason: policy.reason,
        batteryPercent: Number.isFinite(Number(batteryPercent))
          ? Number(batteryPercent)
          : null,
        lastEvaluatedAt: new Date(nowMs),
        trigger,
        ...(sosActiveUntilMs ? { sosActiveUntil: new Date(sosActiveUntilMs) } : {}),
        ...(sosCooldownUntilMs ? { sosCooldownUntil: new Date(sosCooldownUntilMs) } : {}),
      },
    }, { merge: true });

    return { changed: false, seconds: policy.seconds, reason: policy.reason };
  }

  await sendDeviceCommand(db, imei, 'set_upload_interval', {
    seconds: policy.seconds,
  });

  setDeviceReportingContext(imei, {
    expectedReportingIntervalSeconds: policy.seconds,
    outingActive,
  });

  await deviceRef.set({
    locationReportingMode: 'automatic',
    locationReportingIntervalSeconds: policy.seconds,
    adaptiveReporting: {
      desiredIntervalSeconds: policy.seconds,
      appliedIntervalSeconds: policy.seconds,
      reason: policy.reason,
      batteryPercent: Number.isFinite(Number(batteryPercent))
        ? Number(batteryPercent)
        : null,
      lastCommandAt: new Date(nowMs),
      lastEvaluatedAt: new Date(nowMs),
      trigger,
      ...(sosActiveUntilMs ? { sosActiveUntil: new Date(sosActiveUntilMs) } : {}),
      ...(sosCooldownUntilMs ? { sosCooldownUntil: new Date(sosCooldownUntilMs) } : {}),
    },
  }, { merge: true });

  stateByImei.set(imei, {
    ...memory,
    lastRequestedSeconds: policy.seconds,
    lastCommandAtMs: nowMs,
    sosActiveUntilMs,
    sosCooldownUntilMs,
  });

  console.log(
    `[adaptive-reporting] ${imei} ${policy.reason} -> ${policy.seconds}s ` +
    `(battery=${batteryPercent ?? 'unknown'} trigger=${trigger})`
  );

  return { changed: true, seconds: policy.seconds, reason: policy.reason };
}

async function activateSosOverride(db, imei, {
  batteryPercent,
  outingActive = false,
  nowMs = Date.now(),
} = {}) {
  const { sosActiveUntilMs, sosCooldownUntilMs } = markSos(imei, nowMs);

  if (db) {
    await db.collection('devices').doc(imei).set({
      adaptiveReporting: {
        sosActiveUntil: new Date(sosActiveUntilMs),
        sosCooldownUntil: new Date(sosCooldownUntilMs),
        lastEvaluatedAt: new Date(nowMs),
        trigger: 'sos',
      },
    }, { merge: true });
  }

  return applyAdaptiveReporting(db, imei, {
    batteryPercent,
    outingActive,
    trigger: 'sos',
    nowMs,
    force: true,
  });
}

module.exports = {
  BATTERY_POLICY,
  SOS_ACTIVE_MS,
  SOS_COOLDOWN_MS,
  NORMAL_COMMAND_COOLDOWN_MS,
  OUTING_REPORTING_SECONDS,
  CRITICAL_BATTERY_PERCENT,
  policyForBattery,
  effectivePolicy,
  appliedIntervalSeconds,
  shouldSend,
  markSos,
  applyAdaptiveReporting,
  activateSosOverride,
};
