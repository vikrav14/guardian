'use strict';

const config = require('./config');
const { createWifiHomeObserver } = require('./wifi-home-observer');

// Packet observation stays synchronous and in memory. An independently enabled
// background publisher may expose expiring presentation evidence for this pilot;
// its reads/writes are never awaited by the packet or SOS dispatcher.
let observer;
let lastLogMs = null;
let lastState = null;

function observeWifiHomeEvent(event, receivedAt) {
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
  const result = observer.observe(event, nowMs);
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
  const { startHomeWifiPublisher } = require('./wifi-home-display');
  return startHomeWifiPublisher({ db, imei: config.wifiHomePilotImei,
    readObservation: nowMs => observer?.snapshot(nowMs),
    resetObservation: () => { observer = undefined; },
  });
}

module.exports = { observeWifiHomeEvent, startWifiHomeDisplayPilot };
