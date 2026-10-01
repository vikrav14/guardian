'use strict';

const { sendDeviceCommand } = require('./commands');
const { setDeviceReportingContext } = require('./sessions');

const BATTERY_POLICY = Object.freeze([
  { min: 15, seconds: 600, reason: 'normal_baseline' },
  { min: 0, seconds: 900, reason: 'battery_critical' },
]);

const SOS_ACTIVE_MS = 30 * 60 * 1000;
const SOS_COOLDOWN_MS = 15 * 60 * 1000;
const NORMAL_COMMAND_COOLDOWN_MS = 10 * 60 * 1000;
const OUTING_REPORTING_SECONDS = 60;
const CRITICAL_BATTERY_PERCENT = 15;
const OUTING_LEASE_MS = 15 * 60_000;
const millis = value => value?.toMillis?.() || (value == null ? 0 : +new Date(value)) || 0;
const batteryValue = value => value == null || value === '' ? NaN : Number(value);


function policyForBattery(batteryPercent) {
  const battery = batteryValue(batteryPercent);
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
  const battery = batteryValue(batteryPercent);

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
    adaptive.appliedIntervalSeconds,
    data.locationReportingIntervalSeconds,
  ];
  for (const value of candidates) {
    const seconds = Number(value);
    if (Number.isInteger(seconds) && seconds > 0) return seconds;
  }
  return null;
}

function markSos(imei, nowMs = Date.now()) {
  const sosActiveUntilMs = nowMs + SOS_ACTIVE_MS;
  const sosCooldownUntilMs = sosActiveUntilMs + SOS_COOLDOWN_MS;
  return { sosActiveUntilMs, sosCooldownUntilMs };
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

async function evaluateAdaptiveReporting(db, imei, {
  batteryPercent,
  outingActive,
  outingActiveUntilMs,
  trigger = 'telemetry',
  nowMs = Date.now(),
  force = false,
  reassert = false,
  beforeSend = async () => {},
  send = sendDeviceCommand,
  setContext = setDeviceReportingContext,
} = {}) {
  if (!db || !imei) return { changed: false, reason: 'missing_context' };

  const deviceRef = db.collection('devices').doc(imei);
  const snap = await deviceRef.get();
  const data = snap.data() || {};

  const mode = data.locationReportingMode || 'automatic';
  const adaptive = data.adaptiveReporting || {};
  const sosActiveUntilMs = millis(adaptive.sosActiveUntil);
  const sosCooldownUntilMs = millis(adaptive.sosCooldownUntil);

  // Only accepted journey evidence supplies this lease. A heartbeat or worker
  // tick must never extend an outing, including after process restart.
  const outingUntil = outingActive === false ? 0 : outingActiveUntilMs != null
    ? outingActiveUntilMs : millis(adaptive.outingActiveUntil);
  outingActive = outingUntil > nowMs;
  batteryPercent = batteryPercent ?? data.batteryPercent ?? adaptive.batteryPercent;

  let policy = effectivePolicy({
    batteryPercent,
    outingActive,
    nowMs,
    sosActiveUntilMs,
    sosCooldownUntilMs,
  });
  if (mode !== 'automatic' && nowMs >= sosActiveUntilMs && nowMs >= sosCooldownUntilMs) {
    const seconds = Number(data.manualReportingIntervalSeconds || data.locationReportingIntervalSeconds);
    if (Number.isInteger(seconds) && seconds > 0) policy = { seconds, reason: 'manual_mode' };
  }

  // `desiredIntervalSeconds` is intent, not proof that the command reached the
  // watch. Using it as the applied value made a cooldown-blocked change appear
  // complete and prevented later retries.
  const lastRequestedSeconds = appliedIntervalSeconds(data, adaptive);

  const lastCommandAtMs = millis(adaptive.lastCommandAt);
  const restoring = /^(sos_|outing_)/.test(adaptive.reason || '') &&
    !/^(sos_|outing_)/.test(policy.reason);
  const urgent =
    force || restoring || adaptive.commandStatus === 'deferred' ||
    policy.reason.startsWith('sos_') ||
    policy.reason.startsWith('outing_');

  const shouldWrite = reassert || shouldSend({
    desiredSeconds: policy.seconds,
    lastRequestedSeconds,
    lastCommandAtMs,
    nowMs,
    urgent,
  });

  const intent = {
    desiredIntervalSeconds: policy.seconds, reason: policy.reason,
    batteryPercent: Number.isFinite(batteryValue(batteryPercent)) ? Number(batteryPercent) : null,
    lastEvaluatedAt: new Date(nowMs), trigger,
    outingActiveUntil: new Date(outingUntil),
    ...(sosActiveUntilMs ? { sosActiveUntil: new Date(sosActiveUntilMs) } : {}),
    ...(sosCooldownUntilMs ? { sosCooldownUntil: new Date(sosCooldownUntilMs) } : {}),
  };
  // Persist desired state before attempting a write. A busy camera is a
  // deferral, never evidence that UPLOAD was applied. The worker recomputes.
  const intentChanged = adaptive.desiredIntervalSeconds !== policy.seconds || adaptive.reason !== policy.reason ||
    adaptive.batteryPercent !== intent.batteryPercent || millis(adaptive.outingActiveUntil) !== outingUntil ||
    nowMs - millis(adaptive.lastEvaluatedAt) >= 5 * 60_000;
  if (shouldWrite || intentChanged) await deviceRef.set({ adaptiveReporting: intent,
    ...(mode !== 'automatic' && policy.reason.startsWith('sos_') && !data.manualReportingIntervalSeconds
      ? { manualReportingIntervalSeconds: data.locationReportingIntervalSeconds || 600 } : {}),
  }, { merge: true });
  if (!shouldWrite) {
    setContext(imei, {
      expectedReportingIntervalSeconds: lastRequestedSeconds,
      outingActive,
      outingActiveUntilMs: outingUntil,
    });
    return { changed: false, seconds: policy.seconds, reason: policy.reason };
  }

  try {
    await beforeSend();
    await send(db, imei, 'set_upload_interval', {
    seconds: policy.seconds,
  }, { coordination: { emergency: policy.reason.startsWith('sos_') || policy.reason.startsWith('outing_') } }); }
  catch (error) {
    if (error.code !== 'camera_busy') throw error;
    setContext(imei, { expectedReportingIntervalSeconds: lastRequestedSeconds, outingActive,
      outingActiveUntilMs: outingUntil });
    await deviceRef.set({ adaptiveReporting: { commandStatus: 'deferred', deferredReason: 'camera_busy',
      deferredUntil: new Date(Math.min(error.expiresAt || nowMs + 120_000, nowMs + 120_000)) } }, { merge: true });
    return { changed: false, seconds: policy.seconds, reason: 'camera_busy', status: 'deferred' };
  }

  setContext(imei, {
    expectedReportingIntervalSeconds: policy.seconds,
    reportingCommandHandedOff: true,
    outingActive,
    outingActiveUntilMs: outingUntil,
  });

  await deviceRef.set({
    locationReportingMode: mode,
    locationReportingIntervalSeconds: policy.seconds,
    adaptiveReporting: {
      ...intent,
      commandStatus: 'handed_off', deferredReason: null, deferredUntil: null,
      desiredIntervalSeconds: policy.seconds,
      appliedIntervalSeconds: policy.seconds,
      reason: policy.reason,
      batteryPercent: Number.isFinite(batteryValue(batteryPercent))
        ? Number(batteryPercent)
        : null,
      lastCommandAt: new Date(nowMs),
      lastEvaluatedAt: new Date(nowMs),
      trigger,
      ...(sosActiveUntilMs ? { sosActiveUntil: new Date(sosActiveUntilMs) } : {}),
      ...(sosCooldownUntilMs ? { sosCooldownUntil: new Date(sosCooldownUntilMs) } : {}),
    },
  }, { merge: true });


  console.log(
    `[adaptive-reporting] ${imei} ${policy.reason} -> ${policy.seconds}s ` +
    `(battery=${batteryPercent ?? 'unknown'} trigger=${trigger})`
  );

  return { changed: true, seconds: policy.seconds, reason: policy.reason };
}

// Serialize evaluations, not actions waiting on a camera. Every pass reads
// current persisted intent; no captured session or old restore value is queued.
const evaluations = new Map();
function applyAdaptiveReporting(db, imei, options = {}) {
  const previous = evaluations.get(imei) || Promise.resolve();
  const result = previous.catch(() => {}).then(() => evaluateAdaptiveReporting(db, imei, options));
  evaluations.set(imei, result);
  result.finally(() => { if (evaluations.get(imei) === result) evaluations.delete(imei); }).catch(() => {});
  return result;
}

function startReportingReconciler({ db, connected, context = () => ({}), intervalMs = 15_000,
  sessionFor = imei => require('./sessions').findSocketsForDevice(imei).map(value => value.session) }) {
  let running = false;
  const reconciled = new WeakSet();
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const imei of connected()) {
        try {
          const sessions = sessionFor(imei);
          const session = sessions.length === 1 ? sessions[0] : null;
          const result = await applyAdaptiveReporting(db, imei, { ...context(imei), trigger: 'reconcile',
            reassert: Boolean(session && !session.reportingCommandHandedOff && !reconciled.has(session)) });
          if (session && result.status !== 'deferred') reconciled.add(session);
        }
        catch { console.warn('[adaptive-reporting] reconciliation deferred; live session/state will be rechecked'); }
      }
    } finally { running = false; }
  }
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
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
  OUTING_LEASE_MS,
  startReportingReconciler,
  policyForBattery,
  effectivePolicy,
  appliedIntervalSeconds,
  shouldSend,
  markSos,
  applyAdaptiveReporting,
  activateSosOverride,
};
