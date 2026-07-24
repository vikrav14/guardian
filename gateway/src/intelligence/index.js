const { haversineMeters } = require('../geofence');

const LEVEL_PRIORITY = { urgent: 0, warning: 1, info: 2 };

const DEFAULT_CONFIG = {
  offlineMinutes: 10,
  recentlyOnlineWindowMinutes: 120,
  staleGpsMinutes: 8,
  lowBatteryThreshold: 10,
  movingSpeedKmh: 1,
  offlineAlertCooldownMinutes: 30,
  batteryForecastMinSamples: 3,
  batteryForecastMinHours: 2,
};

/** @type {Map<string, Array<{ at: Date, batteryPercent: number }>>} */
const batterySamples = new Map();
/** @type {Map<string, number>} */
const lastOfflineAlertAt = new Map();

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toNumber === 'function') return new Date(value.toNumber());
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function minutesSince(date, now = new Date()) {
  if (!date) return null;
  return (now.getTime() - date.getTime()) / 60_000;
}

function resolveHomeGeofence(geofences = []) {
  const active = geofences.filter((g) => g && g.active !== false);
  if (active.length === 0) return null;
  const named = active.find((g) =>
    String(g.name || '')
      .toLowerCase()
      .includes('home')
  );
  if (named) return named;
  return active.length === 1 ? active[0] : null;
}

function isInsideGeofence(location, geofence) {
  if (!location || !geofence) return false;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const center = geofence.center || geofence;
  const centerLat = Number(center.lat);
  const centerLng = Number(center.lng);
  const radius = Number(geofence.radiusMeters) || 150;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return false;
  return haversineMeters(lat, lng, centerLat, centerLng) <= radius;
}

function formatAccuracyLabel(accuracy) {
  const source = String(accuracy || '').toLowerCase();
  if (source === 'gps') return 'satellite GPS';
  if (source === 'wifi') return 'WiFi positioning (approximate)';
  if (source === 'lbs') return 'cell tower positioning (approximate)';
  return null;
}

function buildLocationContext(device, now) {
  const location = device.location;
  const recordedAt = asDate(location?.recordedAt);
  const ageMinutes = recordedAt ? minutesSince(recordedAt, now) : null;
  const accuracy = String(device.accuracySource || location?.accuracySource || '').toLowerCase();
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  return {
    recordedAt,
    ageMinutes,
    accuracy,
    hasCoords,
    accuracyLabel: formatAccuracyLabel(accuracy),
  };
}

function locationAgePhrase(ageMinutes) {
  const rounded = Math.max(1, Math.round(ageMinutes));
  if (rounded < 60) return `${rounded} minute${rounded === 1 ? '' : 's'}`;
  const hours = Math.round(rounded / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function deviceDisplayName(device = {}) {
  const nickname = String(device.nickname || '').trim();
  if (nickname) return nickname;
  const relationship = String(device.relationship || '').trim();
  if (relationship) return relationship;
  const name = String(device.name || '').trim();
  if (name && !name.toLowerCase().startsWith('device ')) {
    const cleaned = name.replace(/(?:'s)?\s+(?:pendant|device)$/i, '').trim();
    return cleaned || name;
  }
  return 'Your loved one';
}

/**
 * User-facing alert copy for push/in-app notifications — no ISO timestamps or jargon.
 */
function buildOfflineAlertCopy(device, staleMinutes, loc = buildLocationContext(device)) {
  const who = deviceDisplayName(device);
  const contactPhrase = locationAgePhrase(staleMinutes);
  const title = `${who} hasn't checked in`;

  let message =
    `We haven't heard from ${who} for ${contactPhrase}. Live tracking is paused — the pendant may be off, out of coverage, or unable to reach the server.`;

  if (loc.hasCoords && loc.ageMinutes != null) {
    const fixPhrase = locationAgePhrase(loc.ageMinutes);
    message += ` The map shows their last known position from ${fixPhrase} ago`;
    if (loc.accuracyLabel) {
      message += ` (${loc.accuracyLabel})`;
    }
    message += '. They may have moved since then.';
  } else {
    message += ' Last known location is unavailable.';
  }

  return { title, message };
}

function finalizeInsight(raw) {
  const suppressBelow = raw.suppressBelow ?? 50;
  const confidence = Math.round(Math.max(0, Math.min(100, raw.confidence ?? 0)));
  const inference =
    confidence < suppressBelow
      ? 'Unable to determine with confidence. Continue monitoring.'
      : raw.inference;
  return {
    id: raw.id,
    facts: raw.facts || [],
    inference,
    confidence,
    level: raw.level || 'info',
    suppressBelow,
  };
}

function ruleOffline(device, config, now) {
  const lastHeartbeat = asDate(device.lastHeartbeatAt);
  const staleMinutes = minutesSince(lastHeartbeat, now);
  if (staleMinutes == null) return null;

  const offlineThreshold = config.offlineMinutes;
  const recentlyOnlineWindow = config.recentlyOnlineWindowMinutes;

  if (staleMinutes < offlineThreshold) return null;

  const wasRecentlyOnline =
    staleMinutes <= recentlyOnlineWindow + offlineThreshold ||
    device.online === true;

  if (!wasRecentlyOnline) return null;

  const confidence = Math.min(
    100,
    60 + Math.round((staleMinutes - offlineThreshold) * 3)
  );

  const loc = buildLocationContext(device, now);
  const contactPhrase = locationAgePhrase(staleMinutes);

  let inference =
    `No contact for ${contactPhrase}. Live tracking is unavailable — the pendant may be off, out of coverage, or unable to reach the server.`;

  if (loc.hasCoords && loc.ageMinutes != null) {
    const fixPhrase = locationAgePhrase(loc.ageMinutes);
    inference += ` The map pin shows their last known position from ${fixPhrase} ago`;
    if (loc.accuracyLabel) {
      inference += ` (${loc.accuracyLabel})`;
    }
    inference += '. They may have moved since then.';
  } else {
    inference += ' Last known location is unavailable.';
  }

  const facts = [
    { field: 'lastHeartbeatAt', value: lastHeartbeat.toISOString() },
    { field: 'minutesSinceHeartbeat', value: Math.round(staleMinutes) },
    { field: 'online', value: device.online === true },
  ];
  if (loc.recordedAt) {
    facts.push({ field: 'location.recordedAt', value: loc.recordedAt.toISOString() });
    facts.push({ field: 'locationAgeMinutes', value: Math.round(loc.ageMinutes) });
  }
  if (loc.accuracy) facts.push({ field: 'accuracySource', value: loc.accuracy });

  return finalizeInsight({
    id: 'offline',
    facts,
    inference,
    confidence,
    level: staleMinutes >= offlineThreshold * 2 ? 'urgent' : 'warning',
    suppressBelow: 50,
  });
}

function ruleLowBatteryMoving(device, geofences, config) {
  const battery = device.batteryPercent;
  if (battery == null || battery >= config.lowBatteryThreshold) return null;

  const speed = Number(device.speedKmh);
  if (!Number.isFinite(speed) || speed <= config.movingSpeedKmh) return null;

  const home = resolveHomeGeofence(geofences);
  const location = device.location;
  let distanceFact = null;
  let distancePhrase = '';

  if (home && location) {
    const center = home.center || home;
    const distance = haversineMeters(
      Number(location.lat),
      Number(location.lng),
      Number(center.lat),
      Number(center.lng)
    );
    distanceFact = { field: 'distanceFromHomeMeters', value: Math.round(distance) };
    distancePhrase = `, ${Math.round(distance)} m from ${home.name || 'home zone'}`;
  }

  const facts = [
    { field: 'batteryPercent', value: battery },
    { field: 'speedKmh', value: speed },
  ];
  if (distanceFact) facts.push(distanceFact);

  return finalizeInsight({
    id: 'low_battery_moving',
    facts,
    inference: `Battery at ${battery}% while moving at ${speed.toFixed(1)} km/h${distancePhrase}. Charge soon.`,
    confidence: distanceFact ? 90 : 75,
    level: battery <= 5 ? 'urgent' : 'warning',
    suppressBelow: 50,
  });
}

function ruleStaleGps(device, config, now) {
  const location = device.location;
  const recordedAt = asDate(location?.recordedAt);
  const accuracy = String(device.accuracySource || location?.accuracySource || '').toLowerCase();

  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const coordsInvalid = !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

  const ageMinutes = recordedAt ? minutesSince(recordedAt, now) : null;
  const stale =
    coordsInvalid ||
    ageMinutes == null ||
    ageMinutes > config.staleGpsMinutes;

  if (!stale) return null;

  const facts = [];
  if (recordedAt) {
    facts.push({ field: 'location.recordedAt', value: recordedAt.toISOString() });
    facts.push({ field: 'locationAgeMinutes', value: Math.round(ageMinutes) });
  } else {
    facts.push({ field: 'location.recordedAt', value: null });
  }
  if (accuracy) facts.push({ field: 'accuracySource', value: accuracy });

  const accuracyLabel = formatAccuracyLabel(accuracy);
  let inference;
  let confidence;
  if (coordsInvalid) {
    inference =
      'Still waiting for a clear location from the pendant. This usually updates once it has a stronger signal.';
    confidence = 85;
  } else {
    const fixPhrase = locationAgePhrase(ageMinutes);
    inference = `Last saw them about ${fixPhrase} ago`;
    if (accuracy === 'wifi' || accuracy === 'lbs') {
      inference += ' (approximate)';
    }
    inference +=
      '. The map may be a little behind until a fresher update arrives.';
    confidence = Math.min(95, 55 + Math.round(ageMinutes));
  }

  return finalizeInsight({
    id: 'stale_gps',
    facts,
    inference,
    confidence,
    level: ageMinutes != null && ageMinutes > config.staleGpsMinutes * 2 ? 'warning' : 'info',
    suppressBelow: 50,
  });
}

function ruleGeofenceExitUrgent(device, geofences) {
  const home = resolveHomeGeofence(geofences);
  if (!home) return null;

  const location = device.location;
  if (!location) return null;

  const inside = isInsideGeofence(location, home);
  if (inside) return null;

  const center = home.center || home;
  const distance = haversineMeters(
    Number(location.lat),
    Number(location.lng),
    Number(center.lat),
    Number(center.lng)
  );
  const radius = Number(home.radiusMeters) || 150;
  const outsideBy = Math.max(0, Math.round(distance - radius));

  return finalizeInsight({
    id: 'geofence_exit_urgent',
    facts: [
      { field: 'geofenceName', value: home.name || 'Home' },
      { field: 'distanceOutsideMeters', value: outsideBy },
      { field: 'speedKmh', value: device.speedKmh ?? null },
    ],
    inference: `Outside ${home.name || 'home zone'} by ~${outsideBy} m. Geofence exit alerts may already be active.`,
    confidence: 80,
    level: 'warning',
    suppressBelow: 50,
  });
}

function recordBatterySample(imei, device, at = new Date()) {
  if (device.batteryPercent == null) return;
  const samples = batterySamples.get(imei) || [];
  samples.push({ at, batteryPercent: Number(device.batteryPercent) });
  while (samples.length > 48) samples.shift();
  batterySamples.set(imei, samples);
}

function ruleBatteryForecast(imei, device, config) {
  const samples = batterySamples.get(imei) || [];
  if (samples.length < config.batteryForecastMinSamples) return null;

  const current = device.batteryPercent;
  if (current == null) return null;

  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const hoursSpan = (newest.at.getTime() - oldest.at.getTime()) / 3_600_000;
  if (hoursSpan < config.batteryForecastMinHours) return null;

  const drainPerHour = (oldest.batteryPercent - newest.batteryPercent) / hoursSpan;
  if (drainPerHour <= 0) return null;

  const daysRemaining = current / (drainPerHour * 24);
  if (!Number.isFinite(daysRemaining) || daysRemaining <= 0 || daysRemaining > 30) return null;

  return finalizeInsight({
    id: 'battery_forecast',
    facts: [
      { field: 'batteryPercent', value: current },
      { field: 'drainPerHour', value: Number(drainPerHour.toFixed(2)) },
      { field: 'sampleCount', value: samples.length },
      { field: 'sampleSpanHours', value: Number(hoursSpan.toFixed(1)) },
    ],
    inference: `Battery at ${current}%, draining ~${drainPerHour.toFixed(1)}%/hour over ${hoursSpan.toFixed(1)} h (${samples.length} samples). About ${daysRemaining.toFixed(1)} days remaining at this rate.`,
    confidence: samples.length >= 6 ? 75 : 60,
    level: daysRemaining < 1 ? 'warning' : 'info',
    suppressBelow: 50,
  });
}

/**
 * @param {{ device: object, geofences?: object[], recentLocations?: object[], config?: object, imei?: string, now?: Date }} input
 * @returns {object[]}
 */
function evaluateDeviceIntelligence(input) {
  const {
    device,
    geofences = [],
    config: userConfig = {},
    imei = device?.imei || '',
    now = new Date(),
  } = input;

  if (!device) return [];

  const config = { ...DEFAULT_CONFIG, ...userConfig };
  if (imei) recordBatterySample(imei, device, now);

  const raw = [
    ruleOffline(device, config, now),
    ruleLowBatteryMoving(device, geofences, config),
    ruleStaleGps(device, config, now),
    ruleGeofenceExitUrgent(device, geofences),
    imei ? ruleBatteryForecast(imei, device, config) : null,
  ].filter(Boolean);

  return raw.sort((a, b) => {
    const levelDiff = (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9);
    if (levelDiff !== 0) return levelDiff;
    return b.confidence - a.confidence;
  });
}

function shouldCreateOfflineAlert(imei, config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const last = lastOfflineAlertAt.get(imei) || 0;
  const cooldownMs = merged.offlineAlertCooldownMinutes * 60_000;
  if (Date.now() - last < cooldownMs) return false;
  lastOfflineAlertAt.set(imei, Date.now());
  return true;
}

function resetIntelligenceStateForTests() {
  batterySamples.clear();
  lastOfflineAlertAt.clear();
}

module.exports = {
  evaluateDeviceIntelligence,
  resolveHomeGeofence,
  shouldCreateOfflineAlert,
  resetIntelligenceStateForTests,
  buildOfflineAlertCopy,
  buildLocationContext,
  deviceDisplayName,
  locationAgePhrase,
  DEFAULT_CONFIG,
};
