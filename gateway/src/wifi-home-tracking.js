'use strict';

const { readHomeWifiPriority, millis, MAX_AGE_MS } = require('./wifi-home-display-policy');
const { validCoordinates } = require('./wifi-home-gps-policy');
const { isJourneyGps } = require('./journey-source-evidence');
const { suspendTrackingForHome } = require('./live-cache');
const { seedHomeWifiGeofencePresence } = require('./geofence');
const { POLICY: RADIO_POLICY } = require('./wifi-home-observer');

function createHomeWifiTrackingPolicy({ suspend = suspendTrackingForHome,
  seedHome = seedHomeWifiGeofencePresence } = {}) {
  const suspended = new Map();
  return function selectTracking(imei, location, evidence, now = new Date()) {
    const home = readHomeWifiPriority({ homeWifiPresence: evidence }, { now });
    if (home) {
      suspended.set(imei, Math.max(suspended.get(imei) || -Infinity, millis(home.observedAt)));
      seedHome(imei, home);
      return { hold: true, reason: 'home_wifi_detected', flushes: suspend(imei, now) };
    }
    // Expiry/loss alone is not departure. Buffered or approximate fixes must
    // not release the hold and create a boundary or synthetic route segment.
    if (suspended.has(imei)) {
      const at = millis(location?.recordedAt);
      const clock = millis(now);
      if (!isJourneyGps(location) || !validCoordinates(location) || !Number.isFinite(at) ||
          at <= suspended.get(imei) || at > clock + RADIO_POLICY.futureSkewMs || clock - at >= MAX_AGE_MS) {
        return { hold: true, reason: 'awaiting_fresh_gps_after_home', flushes: [] };
      }
      suspended.delete(imei);
    }
    return { hold: false, reason: 'normal_location_policy', flushes: [] };
  };
}

const selectHomeWifiTracking = createHomeWifiTrackingPolicy();
module.exports = { createHomeWifiTrackingPolicy, selectHomeWifiTracking };
