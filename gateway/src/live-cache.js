const { haversineMeters } = require('./geofence');
const config = require('./config');
const { trackDwellPoint, flushDwellSegment } = require('./dwell');
const {
  trackJourneyPoint,
  hasActiveJourney,
  noteJourneyObservation,
  noteJourneyDiagnosticEvent,
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

/**
 * A single fix landing further than this from the last known-good position
 * is treated as suspect rather than trusted outright (e.g. a hemisphere-sign
 * glitch on a raw GPS/LBS fix puts a Mauritius pendant near Oman -- a real
 * jump this large happens too, but never within one report interval). It
 * only holds the display back one cycle: a second fix that agrees with the
 * suspect one (not the old position) is trusted immediately.
 */
const JUMP_SANITY_METERS = 250_000;

function isImplausibleJump(fromLocation, toLocation, thresholdMeters = JUMP_SANITY_METERS) {
  if (!fromLocation || !toLocation) return false;
  if (typeof toLocation.lat !== 'number' || typeof toLocation.lng !== 'number') return false;
  return haversineMeters(fromLocation.lat, fromLocation.lng, toLocation.lat, toLocation.lng)
    >= thresholdMeters;
}

let skippedCount = 0;
let persistedCount = 0;

function emptyState() {
  return {
    lastPersistedLocation: null,
    lastPersistedBattery: null,
    lastPersistedAt: null,
    lastHeartbeatPersistAt: null,
    pendingFirstFix: true,
    pendingSuspectLocation: null,
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

/**
 * Seed the reconnect-time reference position from Firestore.
 * Active outing state now survives short transport disconnects, but this
 * remains useful after a cold gateway start when no in-memory reference exists.
 */
function seedLastKnownLocation(imei, location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return;
  const state = getState(imei);
  state.lastPersistedLocation = { lat: location.lat, lng: location.lng };
}

function onDeviceDisconnect(imei) {
  const state = cache.get(imei);
  if (!state) return;

  // A TCP disconnect is a transport event, not a journey boundary.
  // Preserve currentJourney and persisted references so a carrier/ngrok
  // reconnect continues the same outing instead of fragmenting it.
  state.pendingFirstFix = true;
  state.pendingSuspectLocation = null;
  state.liveLocation = null;
  state.liveBattery = null;
  state.liveSpeedKmh = null;
  state.liveAccuracySource = null;

  // Dwell detection remains session-local for now.
  state.currentDwell = null;
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
    if (isImplausibleJump(state.lastPersistedLocation, location)) {
      if (state.pendingSuspectLocation && !isImplausibleJump(state.pendingSuspectLocation, location)) {
        // A second fix agreeing with the suspect one, not the old position --
        // this is a real relocation, not a glitched single sample.
        state.pendingSuspectLocation = null;
        return { persist: true, reason: 'jump_corroborated', appendHistory: true };
      }
      state.pendingSuspectLocation = { lat: location.lat, lng: location.lng };
      return { persist: false, reason: 'jump_suspect', appendHistory: false };
    }
    state.pendingSuspectLocation = null;

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
      // On heartbeat cap, always refresh location if we have live data
      // This ensures location updates at least every ~5 min even if device is stationary
      return { persist: true, reason: 'heartbeat_cap', appendHistory: false, includeLocation: true };
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
  // Kept for server-call compatibility while the outing engine is migrated.
  // Disconnect must not close an outing; closure is driven by outing semantics.
  void imei;
  void now;
  void force;
  return null;
}

function isJourneyActive(imei) {
  return hasActiveJourney(getState(imei));
}

function noteObservationForJourney(imei, outcome) {
  return noteJourneyObservation(getState(imei), outcome);
}

function noteDiagnosticEventForJourney(imei, type, at, details) {
  return noteJourneyDiagnosticEvent(getState(imei), type, at, details);
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
  seedLastKnownLocation,
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
  noteObservationForJourney,
  noteDiagnosticEventForJourney,
  getWriteGateStats,
  resetWriteGateStats,
  resetCacheForTests,
  movedEnough,
  heartbeatCapDue,
  batteryChanged,
  isImplausibleJump,
  JUMP_SANITY_METERS,
};
