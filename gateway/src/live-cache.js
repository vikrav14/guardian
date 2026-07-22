const { haversineMeters } = require('./geofence');
const config = require('./config');
const { trackDwellPoint, flushDwellSegment } = require('./dwell');
const {
  trackJourneyPoint,
  forceCloseJourney,
  hasActiveJourney,
} = require('./journey-builder');

/**
 * In-memory live state per device. Firestore is a throttled mirror.
 *
 * Estimated writes per device per day (vs ~2880–4320 unthrottled GPS fixes):
 *   Stationary: ~288 device heartbeats + ~96 sparse history (if enabled)
 *   Moving ~5 km/day: ~100 move triggers + ~288 heartbeat + ~2–4 journey closes + dwell segments
 *   Active commuter ~20 km/day: ~400 move triggers + ~288 heartbeat + ~4–8 journeys
 * Location history (if WRITE_LOCATION_HISTORY=true) drops to alarm/geofence/first-fix/interval only.
 * Route replay uses compressed journeys (~1 doc per trip) instead of per-fix location writes.
 */

const cache = new Map();

const ALARM_PERSIST_TYPES = new Set([
  'sos',
  'fall',
  'low_battery',
  'geofence_enter',
  'geofence_exit',
]);

let skippedCount = 0;
let persistedCount = 0;

function emptyState() {
  return {
    lastPersistedLocation: null,
    lastPersistedBattery: null,
    lastPersistedAt: null,
    lastHeartbeatPersistAt: null,
    pendingFirstFix: true,
    liveLocation: null,
    liveBattery: null,
    liveSpeedKmh: null,
    liveAccuracySource: null,
    currentDwell: null,
    currentJourney: null,
  };
}

function getState(imei) {
  if (!cache.has(imei)) {
    cache.set(imei, emptyState());
  }
  return cache.get(imei);
}

function onDeviceConnect(imei) {
  const state = getState(imei);
  state.pendingFirstFix = true;
}

function onDeviceDisconnect(imei) {
  cache.delete(imei);
}

function updateLiveState(imei, patch) {
  const state = getState(imei);
  if (patch.location) state.liveLocation = patch.location;
  if (patch.batteryPercent != null) state.liveBattery = patch.batteryPercent;
  if (patch.speedKmh != null) state.liveSpeedKmh = patch.speedKmh;
  if (patch.accuracySource != null) state.liveAccuracySource = patch.accuracySource;
  return state;
}

function getLiveDeviceState(imei) {
  const state = getState(imei);
  return {
    imei,
    online: true,
    location: state.liveLocation,
    batteryPercent: state.liveBattery,
    speedKmh: state.liveSpeedKmh,
    accuracySource: state.liveAccuracySource,
    lastHeartbeatAt: state.lastPersistedAt || new Date(),
  };
}

function heartbeatCapDue(state, now = new Date()) {
  if (!state.lastHeartbeatPersistAt) return true;
  const capMs = config.writeGateHeartbeatMinutes * 60 * 1000;
  return now.getTime() - state.lastHeartbeatPersistAt.getTime() >= capMs;
}

function movedEnough(state, location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return false;
  }
  if (!state.lastPersistedLocation) return true;
  const dist = haversineMeters(
    state.lastPersistedLocation.lat,
    state.lastPersistedLocation.lng,
    location.lat,
    location.lng
  );
  return dist >= config.writeGateMinMetres;
}

function batteryChanged(state, batteryPercent) {
  if (batteryPercent == null) return false;
  if (state.lastPersistedBattery == null) return true;
  return Math.trunc(batteryPercent) !== Math.trunc(state.lastPersistedBattery);
}

/**
 * Decide whether this event should be written to Firestore.
 * @returns {{ persist: boolean, reason: string|null, appendHistory: boolean }}
 */
function shouldPersist(imei, context) {
  const state = getState(imei);
  const now = context.now || new Date();
  const {
    eventType,
    location,
    batteryPercent,
    alarmType,
    geofenceTransition,
  } = context;

  if (alarmType && ALARM_PERSIST_TYPES.has(String(alarmType).toLowerCase())) {
    return { persist: true, reason: 'alarm', appendHistory: true };
  }

  if (geofenceTransition) {
    return { persist: true, reason: 'geofence_transition', appendHistory: true };
  }

  if (eventType === 'location' && location) {
    if (state.pendingFirstFix) {
      return { persist: true, reason: 'first_fix', appendHistory: true };
    }
    if (movedEnough(state, location)) {
      return { persist: true, reason: 'moved', appendHistory: false };
    }
    if (batteryChanged(state, batteryPercent)) {
      return { persist: true, reason: 'battery_changed', appendHistory: false };
    }
    if (heartbeatCapDue(state, now)) {
      return { persist: true, reason: 'heartbeat_cap', appendHistory: shouldAppendHistory(state, now) };
    }
    return { persist: false, reason: null, appendHistory: false };
  }

  if (eventType === 'heartbeat') {
    if (batteryChanged(state, batteryPercent)) {
      return { persist: true, reason: 'battery_changed', appendHistory: false };
    }
    if (heartbeatCapDue(state, now)) {
      return { persist: true, reason: 'heartbeat_cap', appendHistory: false };
    }
    return { persist: false, reason: null, appendHistory: false };
  }

  if (eventType === 'login' || eventType === 'disconnect' || eventType === 'alarm') {
    return { persist: true, reason: eventType, appendHistory: Boolean(location) };
  }

  return { persist: false, reason: null, appendHistory: false };
}

function shouldAppendHistory(state, now = new Date()) {
  if (!config.writeLocationHistory) return false;
  if (!state.lastPersistedAt) return true;
  const capMs = config.writeGateHistoryMinutes * 60 * 1000;
  return now.getTime() - state.lastPersistedAt.getTime() >= capMs;
}

function recordPersist(imei, { location, batteryPercent, now = new Date() }) {
  const state = getState(imei);
  if (location) {
    state.lastPersistedLocation = { lat: location.lat, lng: location.lng };
    state.pendingFirstFix = false;
  }
  if (batteryPercent != null) {
    state.lastPersistedBattery = Math.trunc(batteryPercent);
  }
  state.lastPersistedAt = now;
  state.lastHeartbeatPersistAt = now;
  persistedCount += 1;
}

function recordSkip() {
  skippedCount += 1;
}

function trackPointForDwell(imei, point, now = new Date()) {
  const state = getState(imei);
  trackDwellPoint(state, point, now);
}

function flushDwellIfNeeded(imei, now = new Date(), force = false) {
  const state = getState(imei);
  return flushDwellSegment(state, now, force);
}

function trackPointForJourney(imei, point, now = new Date(), options = {}) {
  const state = getState(imei);
  return trackJourneyPoint(state, point, now, options);
}

function flushJourneyIfNeeded(imei, now = new Date(), force = false) {
  const state = getState(imei);
  if (!force) return null;
  return forceCloseJourney(state, now, 'disconnect');
}

function isJourneyActive(imei) {
  return hasActiveJourney(getState(imei));
}

function resetWriteGateStats() {
  skippedCount = 0;
  persistedCount = 0;
}

function getWriteGateStats() {
  return { skipped: skippedCount, persisted: persistedCount };
}

function resetCacheForTests() {
  cache.clear();
  resetWriteGateStats();
}

module.exports = {
  onDeviceConnect,
  onDeviceDisconnect,
  updateLiveState,
  getLiveDeviceState,
  shouldPersist,
  recordPersist,
  recordSkip,
  trackPointForDwell,
  flushDwellIfNeeded,
  trackPointForJourney,
  flushJourneyIfNeeded,
  isJourneyActive,
  getWriteGateStats,
  resetWriteGateStats,
  resetCacheForTests,
  movedEnough,
  heartbeatCapDue,
  batteryChanged,
};
