'use strict';

const config = require('./config');
const { createWifiHomeObserver } = require('./wifi-home-observer');

// Packet observation stays synchronous and in memory. An independently enabled
// background publisher may expose expiring presentation evidence for this pilot;
// its reads/writes are never awaited by the packet or SOS dispatcher.
let observer;
let lastLogMs = null;
let lastState = null;
let displayPublisher = null;
let walkBuffer = null;
let enrollmentRuntime = null;

function getHomeWifiSetupRuntime() { return enrollmentRuntime; }

function observeWifiHomeEvent(event, receivedAt, packetArgs) {
  if (enrollmentRuntime) { enrollmentRuntime.observe(event, receivedAt, packetArgs); return; }
  if (config.wifiHomeObserveEnabled !== true || event?.imei !== config.wifiHomePilotImei) return;
  if (!observer) {
    observer = createWifiHomeObserver({
      enabled: true,
      imei: config.wifiHomePilotImei,
      routerHash: config.wifiHomeRouterHash,
      hashKey: config.wifiHomeHashKey,
    });
  }
  const nowMs = receivedAt.getTime();
  // Inspect declared radio fields separately from the production event. GPS
  // packets can contain Wi-Fi scans; neither the event nor its ACK is modified.
  const radioScan = packetArgs && ['location', 'alarm'].includes(event.type)
    ? require('./wifi-fence-scan').inspectV52WifiScan(packetArgs) : undefined;
  const result = observer.observe(event, nowMs, radioScan);
  const changed = result.matchState !== lastState;
  if (lastLogMs == null || nowMs - lastLogMs >= 30_000 ||
      (changed && nowMs - lastLogMs >= 5_000)) {
    console.log(`[wifi-home] ${JSON.stringify(result)}`);
    lastLogMs = nowMs;
    lastState = result.matchState;
  }
}

function startWifiHomeDisplayPilot(db, { recoverWalk } = {}) {
  if (config.wifiHomeSetupEnabled && db) {
    displayPublisher?.(); displayPublisher = null;
    enrollmentRuntime?.stop();
    const legacy = config.wifiHomeObserveEnabled && config.wifiHomeDisplayPilotEnabled &&
      /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
      /^[a-f0-9]{64}$/.test(config.wifiHomeRouterHash || '') &&
      /^[a-f0-9]{64}$/.test(config.wifiHomeHashKey || '') ? {
        imei: config.wifiHomePilotImei, routerHash: config.wifiHomeRouterHash, hashKey: config.wifiHomeHashKey,
      } : null;
    enrollmentRuntime = require('./home-wifi-enrollment-runtime').createHomeWifiEnrollmentRuntime({ db, legacy,
      report: reason => console.warn(`[wifi-home-setup] ${reason}`) });
    return () => { enrollmentRuntime?.stop(); enrollmentRuntime = null; };
  }
  if (!config.wifiHomeObserveEnabled || !config.wifiHomeDisplayPilotEnabled) return null;
  displayPublisher?.();
  const { startHomeWifiPublisher } = require('./wifi-home-display');
  const publisher = startHomeWifiPublisher({ db, imei: config.wifiHomePilotImei,
    readObservation: nowMs => observer?.snapshot(nowMs),
    readGpsObservation: () => observer?.readGpsObservation() || null,
    resetObservation: () => { observer = undefined; },
    // Turning off app setup must not revive a removed/replaced .env router.
    readBinding: async (nowMs, { signal, restorePresence }) => {
      const read = ref => require('./firestore-first-snapshot').readFirstSnapshot(ref, signal);
      const enrolled = await read(db.collection('homeWifiEnrollments').doc(config.wifiHomePilotImei));
      if (enrolled.exists) return { ready: false, reason: 'app_enrollment_runtime_disabled' };
      return require('./wifi-home-display').loadHomeWifiBinding(db, config.wifiHomePilotImei, nowMs,
        { read, restorePresence });
    },
    persist: (value, detection) => db.runTransaction(async tx => {
      const enrolled = await tx.get(db.collection('homeWifiEnrollments').doc(config.wifiHomePilotImei));
      if (!enrolled.exists) tx.update(db.collection('devices').doc(config.wifiHomePilotImei),
        { homeWifiPresence: value, lastHomeWifiDetection: detection });
    }),
  });
  if (!publisher) { displayPublisher = null; return null; }
  // Supplying the server callback or enabling Home display does not opt into
  // unaccepted recovery. With the experiment off, allocate no buffer or timer.
  walkBuffer = config.wifiHomeWalkRecoveryExperimentEnabled === true &&
    typeof recoverWalk === 'function' ? require('./home-wifi-walk-buffer').createHomeWifiWalkBuffer({
    readContext: clock => publisher.getTrackingContext(clock), recover: recoverWalk,
    report: data => console.log(`[wifi-home-walk] ${JSON.stringify(data)}`),
  }) : null;
  const buffer = walkBuffer;
  const timer = buffer && setInterval(() => { void buffer.tick(); }, 1000);
  timer?.unref?.();
  displayPublisher = Object.assign(() => {
    if (timer) clearInterval(timer);
    buffer?.stop(); publisher();
    if (walkBuffer === buffer) walkBuffer = null;
  }, { getStatus: publisher.getStatus, getEvidence: publisher.getEvidence,
    getLastDetection: publisher.getLastDetection });
  return displayPublisher;
}

function observeHomeWifiWalk(imei, point, receivedAt = new Date()) {
  if (imei === config.wifiHomePilotImei) walkBuffer?.observe(point, receivedAt.getTime());
}

function getWifiHomeRuntimeStatus(nowMs = Date.now()) {
  const { findSocketsForDevice } = require('./sessions');
  if (enrollmentRuntime) {
    const state = enrollmentRuntime.status(config.wifiHomePilotImei, nowMs);
    return { version: 1, observerEnabled: true, displayEnabled: true,
      walkRecoveryEnabled: false, walkRecoveryActive: false,
      pilotConfigured: Boolean(state.observer),
      sessionConnected: findSocketsForDevice(config.wifiHomePilotImei)
        .some(({ socket }) => !socket.destroyed), observer: state.observer, publisher: state.publisher };
  }
  return {
    version: 1,
    observerEnabled: config.wifiHomeObserveEnabled === true,
    displayEnabled: config.wifiHomeDisplayPilotEnabled === true,
    walkRecoveryEnabled: config.wifiHomeWalkRecoveryExperimentEnabled === true,
    walkRecoveryActive: walkBuffer !== null,
    pilotConfigured: /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
      /^[0-9a-f]{64}$/i.test(config.wifiHomeRouterHash || '') &&
      /^[0-9a-f]{64}$/i.test(config.wifiHomeHashKey || ''),
    sessionConnected: /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
      findSocketsForDevice(config.wifiHomePilotImei).some(({ socket }) => !socket.destroyed),
    observer: observer?.snapshot(nowMs) || null,
    publisher: displayPublisher?.getStatus(nowMs) || null,
  };
}

function getHomeWifiPriority(imei, nowMs = Date.now()) {
  if (enrollmentRuntime) return enrollmentRuntime.evidence(imei, nowMs);
  if (config.wifiHomeObserveEnabled !== true || config.wifiHomeDisplayPilotEnabled !== true ||
      imei !== config.wifiHomePilotImei) return null;
  return displayPublisher?.getEvidence?.(nowMs) || null;
}

function getLastHomeWifiDetection(imei, nowMs = Date.now()) {
  if (enrollmentRuntime) return enrollmentRuntime.lastDetection(imei, nowMs);
  if (config.wifiHomeObserveEnabled !== true || config.wifiHomeDisplayPilotEnabled !== true ||
      imei !== config.wifiHomePilotImei) return null;
  return displayPublisher?.getLastDetection?.(nowMs) || null;
}

module.exports = { observeWifiHomeEvent, startWifiHomeDisplayPilot, getWifiHomeRuntimeStatus, getHomeWifiSetupRuntime,
  getHomeWifiPriority, getLastHomeWifiDetection, observeHomeWifiWalk };
