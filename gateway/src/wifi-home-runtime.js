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

function observeWifiHomeEvent(event, receivedAt, packetArgs) {
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

function startWifiHomeDisplayPilot(db) {
  if (!config.wifiHomeObserveEnabled || !config.wifiHomeDisplayPilotEnabled) return null;
  displayPublisher?.();
  const { startHomeWifiPublisher } = require('./wifi-home-display');
  displayPublisher = startHomeWifiPublisher({ db, imei: config.wifiHomePilotImei,
    readObservation: nowMs => observer?.snapshot(nowMs),
    readGpsObservation: () => observer?.readGpsObservation() || null,
    resetObservation: () => { observer = undefined; },
  });
  return displayPublisher;
}

function getWifiHomeRuntimeStatus(nowMs = Date.now()) {
  const { findSocketsForDevice } = require('./sessions');
  return {
    version: 1,
    observerEnabled: config.wifiHomeObserveEnabled === true,
    displayEnabled: config.wifiHomeDisplayPilotEnabled === true,
    pilotConfigured: /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
      /^[0-9a-f]{64}$/i.test(config.wifiHomeRouterHash || '') &&
      /^[0-9a-f]{64}$/i.test(config.wifiHomeHashKey || ''),
    sessionConnected: /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
      findSocketsForDevice(config.wifiHomePilotImei).some(({ socket }) => !socket.destroyed),
    observer: observer?.snapshot(nowMs) || null,
    publisher: displayPublisher?.getStatus(nowMs) || null,
  };
}

module.exports = { observeWifiHomeEvent, startWifiHomeDisplayPilot, getWifiHomeRuntimeStatus };
