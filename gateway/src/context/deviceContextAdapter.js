const { selectLocationForDisplay } = require('../location-provenance');

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.toNumber === 'function') return new Date(value.toNumber());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageMinutes(value, now = new Date()) {
  const date = asDate(value);
  if (!date) return null;
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
}

function validCoordinatePair(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}

function accuracyClassFor(source, location) {
  const normalized = String(source || location?.source || '').toLowerCase();
  if (normalized === 'gps') return 'precise';
  if (normalized === 'wifi' || normalized === 'lbs') return 'approximate';
  const accuracy = Number(location?.accuracyMeters);
  if (Number.isFinite(accuracy) && accuracy <= 50) return 'good';
  return 'unknown';
}

function displayNameFor(device = {}) {
  const value = [
    device.displayName,
    device.nickname,
    device.relationship,
    device.name,
  ].find((candidate) => String(candidate || '').trim());
  if (!value) return 'Device user';
  return String(value).replace(/(?:'s)?\s+(?:pendant|device)$/i, '').trim() || 'Device user';
}

/** Convert the current Firestore device shape into the existing context API shape. */
function adaptDeviceContext(device = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const selection = selectLocationForDisplay(device);
  const selectedLocation = selection.location;
  const lat = Number(selectedLocation?.lat);
  const lng = Number(selectedLocation?.lng);
  if (!selectedLocation || !validCoordinatePair(lat, lng)) return null;

  const lastSeen = asDate(device.lastHeartbeatAt) || asDate(device.updatedAt);
  const locationAge = ageMinutes(selectedLocation.recordedAt, now);
  const lastSeenAge = ageMinutes(lastSeen, now);
  const rawAge = Number(device.age);

  return {
    device: {
      online: device.online === true,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      batteryPercent: device.batteryPercent != null && Number.isFinite(Number(device.batteryPercent))
        ? Number(device.batteryPercent)
        : null,
      lastSeenMinutesAgo: lastSeenAge,
    },
    person: {
      displayName: displayNameFor(device),
      age: Number.isFinite(rawAge) && rawAge > 0 ? rawAge : null,
      careContext: String(device.careContext || 'general'),
    },
    location: {
      lat,
      lng,
      placeName: String(
        selectedLocation.placeLabel ||
        selectedLocation.placeName ||
        device.placeLabel ||
        'Unknown location'
      ),
      freshnessMinutes: locationAge ?? lastSeenAge,
      accuracyClass: accuracyClassFor(selection.source, selectedLocation),
      source: selection.source || null,
      retainedSatellite: selection.retainedSatellite === true,
    },
  };
}

module.exports = {
  adaptDeviceContext,
  asDate,
  ageMinutes,
  validCoordinatePair,
};
