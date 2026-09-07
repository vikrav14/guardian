'use strict';

const config = require('./config');
const { createWifiHomeObserver } = require('./wifi-home-observer');

// One explicitly configured pilot, in memory only. No database, network,
// customer map, geofence, journey, alert or device-command dependencies.
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

module.exports = { observeWifiHomeEvent };
