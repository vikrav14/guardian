'use strict';

// Presentation guard, not a claim about measured GPS accuracy. A large saved
// safe zone must not expand the physical vicinity of an enrolled Home radio.
const GPS_MAX_AGE_MS = 120_000;
const MAX_HOME_VICINITY_METERS = 150;
const MIN_GPS_MARGIN_METERS = 30;

function millis(value) {
  try {
    const date = value?.toDate?.() || (value instanceof Date ? value :
      typeof value === 'string' ? new Date(value) : null);
    return date ? date.getTime() : NaN;
  } catch { return NaN; }
}

function validCoordinates(value) {
  return typeof value?.lat === 'number' && typeof value?.lng === 'number' &&
    Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180 &&
    (value.lat !== 0 || value.lng !== 0);
}

function validHomeRadius(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function distanceMeters(a, b) {
  const rad = n => n * Math.PI / 180;
  const term = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, term))));
}

function gpsHomeAgreement(fixes, anchor, nowMs) {
  if (!Number.isFinite(nowMs) || !validCoordinates(anchor) || !validHomeRadius(anchor.radiusMeters)) {
    return { allowsHome: false, reason: 'home_pin_invalid' };
  }
  const current = [];
  for (const fix of fixes || []) {
    if (!fix || fix.gpsValid === false) continue;
    const at = millis(fix.recordedAt);
    if (!Number.isFinite(at) || at > nowMs) {
      return { allowsHome: false, reason: 'gps_time_unconfirmed' };
    }
    if (nowMs - at < GPS_MAX_AGE_MS) current.push({ fix, at });
  }
  if (!current.length) return { allowsHome: true, reason: 'no_recent_gps' };
  const latest = Math.max(...current.map(item => item.at));
  // Compare only the latest timestamp, but reject conflicting copies at that
  // same time. An older outside fix must not override a newer inside fix.
  for (const { fix, at } of current) {
    if (at !== latest) continue;
    if (!validCoordinates(fix)) return { allowsHome: false, reason: 'gps_position_unconfirmed' };
    const accuracy = fix.accuracyMeters;
    if (accuracy != null && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0)) {
      return { allowsHome: false, reason: 'gps_accuracy_unconfirmed' };
    }
    const margin = Math.max(MIN_GPS_MARGIN_METERS, accuracy ?? MIN_GPS_MARGIN_METERS);
    const radius = Math.min(anchor.radiusMeters, MAX_HOME_VICINITY_METERS);
    const distance = distanceMeters(anchor, fix);
    if (distance + margin > radius) {
      return { allowsHome: false,
        reason: distance - margin > radius ? 'gps_outside_home' : 'gps_boundary_uncertain' };
    }
  }
  return { allowsHome: true, reason: 'gps_agrees_with_home' };
}

function deviceGpsFixes(device) {
  return [device?.lastSatelliteLocation, device?.lastLocationObservation, device?.location]
    .filter((fix, index) => fix && fix.gpsValid !== false &&
      (index === 0 || fix.source === 'gps' || (index === 2 && device.accuracySource === 'gps')));
}

module.exports = { GPS_MAX_AGE_MS, MAX_HOME_VICINITY_METERS, MIN_GPS_MARGIN_METERS,
  millis, validCoordinates, validHomeRadius, gpsHomeAgreement, deviceGpsFixes };
