'use strict';

const {
  classifySosLocation,
  formatLocationAge,
  hasTrustworthyCoordinates,
  toDate,
} = require('./sos-location-policy');

const { buildSafetyContext, formatAge } = require('./safety-message');

const SOS_LOCATION_SNAPSHOT_VERSION = 1;
const SOS_LOCATION_SELECTION_POLICY = 'map_retained_satellite_v1';
const SOURCES = new Set(['gps', 'wifi', 'lbs']);

function safeDate(value) {
  try {
    return toDate(value);
  } catch {
    return null;
  }
}

function finiteValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Copy evidence, never references or unrelated metadata from a later fix. */
function copySosLocation(value, fallbackSource = null, capturedAt = null) {
  if (!value || typeof value !== 'object') return null;
  const lat = finiteValue(value.lat);
  const lng = finiteValue(value.lng);
  if (lat === null || lng === null || !hasTrustworthyCoordinates({ lat, lng })) {
    return null;
  }
  const rawSource = String(value.source || fallbackSource || '').trim().toLowerCase();
  const source = SOURCES.has(rawSource) ? rawSource : null;
  // A GPS-invalid packet must not inherit a satellite label from its container.
  if (source === 'gps' && value.gpsValid === false) return null;
  const date = safeDate(value.recordedAt);
  // Do not borrow post-incident observations, even when a device read races a write.
  if (date && capturedAt && date.getTime() > capturedAt.getTime()) return null;
  const accuracy = finiteValue(value.accuracyMeters);
  return {
    lat,
    lng,
    source,
    gpsValid: source === 'gps',
    accuracyMeters: source === 'gps' || accuracy === null || accuracy < 0 ? null : accuracy,
    recordedAt: date ? new Date(date.getTime()) : null,
    placeLabel: String(value.placeLabel || '').trim() || null,
  };
}

/**
 * Mirror Device.mapDisplayLocation: Wi-Fi/LBS never displaces a retained GPS
 * primary pin. Retained GPS is ALWAYS last-known, even inside the fresh window.
 * Old/unknown-age GPS remains historical evidence, not a current-position claim.
 * Shared fixtures exercise this contract against the actual Flutter model.
 */
function buildSosLocationSnapshot(
  device = {}, { now = new Date(), observation = null } = {}
) {
  const capturedAt = new Date((safeDate(now) || new Date()).getTime());
  const alarmObservation = copySosLocation(observation, null, capturedAt);
  // Invalid/future alarm coordinates cannot erase useful pre-incident evidence.
  if (alarmObservation) {
    device = {
      ...device,
      location: alarmObservation,
      lastLocationObservation: alarmObservation,
      accuracySource: alarmObservation.source,
      ...(alarmObservation.source === 'gps'
        ? { lastSatelliteLocation: alarmObservation }
        : { lastApproximateLocation: alarmObservation }),
    };
  }
  const latest = copySosLocation(device.lastLocationObservation, device.accuracySource, capturedAt)
    || copySosLocation(device.location, device.accuracySource, capturedAt);
  const satellite = copySosLocation(device.lastSatelliteLocation, 'gps', capturedAt);
  const trustedSatellite = satellite?.source === 'gps' ? satellite : null;
  const retainedSatellite = Boolean(trustedSatellite &&
    (!latest || latest.source === 'wifi' || latest.source === 'lbs'));
  const location = retainedSatellite ? trustedSatellite : (latest || trustedSatellite);
  const decision = classifySosLocation({ device: { location }, now: capturedAt });
  return {
    version: SOS_LOCATION_SNAPSHOT_VERSION,
    policy: SOS_LOCATION_SELECTION_POLICY,
    capturedAt,
    state: retainedSatellite || (location && !location.source) ? 'last_known' : decision.state,
    reason: retainedSatellite ? 'retained_satellite'
      : location && !location.source ? 'source_unconfirmed' : decision.reason,
    ageSeconds: decision.ageSeconds,
    retainedSatellite,
    location: copySosLocation(location),
    // The network estimate stays separate; never transplant its time/accuracy
    // or place label onto the primary GPS observation.
    latestObservation: copySosLocation(latest),
  };
}

/** Top-level field is backend-only under the existing alerts create allowlist. */
function readSosLocationSnapshot(alert = {}) {
  const raw = alert?.sosLocationSnapshot;
  if (!raw || raw.version !== SOS_LOCATION_SNAPSHOT_VERSION ||
      raw.policy !== SOS_LOCATION_SELECTION_POLICY ||
      !['fresh', 'last_known', 'unavailable'].includes(raw.state)) return null;
  const capturedAt = safeDate(raw.capturedAt);
  if (!capturedAt) return null;
  const location = copySosLocation(raw.location, null, capturedAt);
  if (raw.state !== 'unavailable' && !location) return null;
  if (raw.state === 'unavailable' && raw.location != null) return null;
  const decision = classifySosLocation({ device: { location }, now: capturedAt });
  const retainedSatellite = raw.retainedSatellite === true && location?.source === 'gps';
  const state = retainedSatellite || (location && !location.source)
    ? 'last_known' : decision.state;
  if (raw.state !== state) return null;
  return {
    version: SOS_LOCATION_SNAPSHOT_VERSION,
    policy: SOS_LOCATION_SELECTION_POLICY,
    capturedAt: new Date(capturedAt.getTime()),
    state,
    reason: retainedSatellite ? 'retained_satellite'
      : location && !location.source ? 'source_unconfirmed' : decision.reason,
    ageSeconds: decision.ageSeconds,
    retainedSatellite,
    location,
    latestObservation: copySosLocation(raw.latestObservation, null, capturedAt),
  };
}

/** Legacy/app SOS without a backend snapshot MUST NOT borrow live coordinates. */
function deviceAtSos(device = {}, alert = {}) {
  const snapshot = readSosLocationSnapshot(alert);
  const location = snapshot?.location || null;
  return {
    ...device,
    location,
    accuracySource: location?.source || null,
    lastLocationObservation: location,
    lastSatelliteLocation: location?.source === 'gps' ? location : null,
    lastApproximateLocation: location && location.source !== 'gps' ? location : null,
  };
}

function formatSosLocationValue(snapshot) {
  if (!snapshot?.location || snapshot.state === 'unavailable') {
    return 'Current location unavailable';
  }
  const loc = snapshot.location;
  const parts = [];
  const label = snapshot.retainedSatellite
    ? 'Last reliable GPS location'
    : loc.source === 'gps' ? 'Satellite GPS location' : 'Approximate location';
  parts.push(`${snapshot.state === 'last_known' ? 'Last known location: ' : ''}${label}`);
  if (loc.placeLabel) {
    if (loc.source !== 'gps') parts[parts.length - 1] += ` near ${loc.placeLabel}`;
    else parts.push(loc.placeLabel);
  }
  if (loc.source === 'wifi') parts.push('WiFi positioning');
  else if (loc.source === 'lbs') parts.push('Cellular positioning');
  else if (loc.source !== 'gps') parts.push('Positioning source unconfirmed');
  if (loc.source !== 'gps' && loc.accuracyMeters !== null) {
    parts.push(`estimated accuracy radius ${Math.round(loc.accuracyMeters)} m`);
  }
  const age = formatLocationAge(snapshot.ageSeconds);
  parts.push(age === 'time unavailable' ? 'recording time unavailable'
    : age === 'just now' ? 'recorded less than 1 minute before SOS receipt'
      : `recorded ${age.replace(/ ago$/, '')} before SOS receipt`);
  if (snapshot.state === 'last_known') parts.push('Current position unconfirmed');
  const secondary = snapshot.latestObservation;
  if (snapshot.retainedSatellite && secondary &&
      ['wifi', 'lbs'].includes(secondary.source)) {
    const newer = secondary.recordedAt && loc.recordedAt &&
      secondary.recordedAt.getTime() > loc.recordedAt.getTime();
    const secondaryParts = [
      `${newer ? 'A newer' : 'An'} approximate network observation is also recorded`,
    ];
    if (secondary.accuracyMeters !== null) {
      secondaryParts.push(`estimated radius ${Math.round(secondary.accuracyMeters)} m`);
    }
    const secondaryDecision = classifySosLocation({
      device: { location: secondary }, now: snapshot.capturedAt,
    });
    const secondaryAge = formatLocationAge(secondaryDecision.ageSeconds);
    secondaryParts.push(secondaryAge === 'time unavailable' ? 'time unavailable'
      : secondaryAge === 'just now' ? 'less than 1 minute before SOS receipt'
        : `${secondaryAge.replace(/ ago$/, '')} before SOS receipt`);
    parts.push(secondaryParts.join(', '));
  }
  return parts.join(' · ');
}

/** One context for SOS narration, template copy and notification-log text. */
function buildSosSafetyContext({ device = {}, alert = {}, now = new Date() } = {}) {
  const snapshot = readSosLocationSnapshot(alert);
  const context = buildSafetyContext({
    device: deviceAtSos(device, alert),
    alert: { ...alert, eventAt: snapshot?.capturedAt || alert.eventAt },
    now,
  });
  return {
    ...context,
    locationFreshness: snapshot?.location
      ? formatAge(snapshot.location.recordedAt, snapshot.capturedAt) : null,
    approximate: Boolean(snapshot?.location && snapshot.location.source !== 'gps'),
    positioningLabel: snapshot?.location && !snapshot.location.source
      ? 'Positioning source unconfirmed' : context.positioningLabel,
  };
}

function buildSosSafetyMessage({ device = {}, alert = {}, now = new Date() } = {}) {
  const snapshot = readSosLocationSnapshot(alert);
  const ctx = buildSosSafetyContext({ device, alert, now });
  const status = [`Watch ${ctx.online ? 'online' : 'offline'}`];
  if (ctx.batteryPercent !== null) status.push(`Battery ${ctx.batteryPercent}%`);
  const lines = [
    `🚨 GUARDIAN SOS — ${ctx.wearerName}`, '',
    `SOS alert received${ctx.eventTime ? ` at ${ctx.eventTime}` : ''}.`, '',
    `📍 ${snapshot?.location ? formatSosLocationValue(snapshot) : 'Location unavailable'}`,
    status.join(' · '), '',
  ];
  if (ctx.mapsUrl) lines.push('Open recorded location:', ctx.mapsUrl);
  else lines.push('Location link unavailable.');
  return lines.join('\n');
}

module.exports = {
  SOS_LOCATION_SNAPSHOT_VERSION,
  SOS_LOCATION_SELECTION_POLICY,
  copySosLocation,
  buildSosLocationSnapshot,
  readSosLocationSnapshot,
  deviceAtSos,
  formatSosLocationValue,
  buildSosSafetyContext,
  buildSosSafetyMessage,
};
