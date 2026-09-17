'use strict';

const WeatherProvider = require('./context/weatherProvider');
const { selectWeatherLocation } = require('./weather-reply');

const MAX_AGE_MS = 60 * 60_000;
const FUTURE_TOLERANCE_MS = 60_000;
const REFRESH_MS = 5 * 60_000;

function dateMs(value) {
  if (value == null || value === '') return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date?.getTime()) ? date.getTime() : null;
}

function fresh(value, now) {
  return value != null && value <= now + FUTURE_TOLERANCE_MS && now - value < MAX_AGE_MS;
}

function finite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function weatherCondition(code) {
  if (!Number.isInteger(code)) return 'unknown';
  if (code >= 200 && code <= 232) return 'thunderstorm';
  if ((code >= 300 && code <= 321) || (code >= 500 && code <= 531)) return 'rain';
  if (code >= 600 && code <= 622) return 'snow';
  if (code === 701 || code === 741) return 'mist';
  if (code === 800) return 'clear';
  if (code === 801 || code === 802) return 'partly_cloudy';
  if (code === 803 || code === 804) return 'cloudy';
  return 'unknown';
}

function areaName(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 100)
    : '';
}

function selectedLocation(device, now) {
  const selection = selectWeatherLocation(device, { now: new Date(now) });
  const location = selection.location;
  const observedAt = dateMs(location?.recordedAt);
  if (!location || !finite(location.lat, -90, 90) || !finite(location.lng, -180, 180) ||
      (location.lat === 0 && location.lng === 0) || !['gps', 'wifi', 'lbs'].includes(selection.source)) {
    return { reason: 'location_unavailable' };
  }
  // Never substitute lastHeartbeatAt/updatedAt for a location observation.
  if (!fresh(observedAt, now)) return { reason: 'location_stale_or_undated' };
  return { ...selection, observedAt };
}

function unavailable(reason, now) {
  return {
    schemaVersion: 1, state: 'unavailable', reason, condition: 'unknown',
    isDay: null, temperatureC: null, windKph: null, gustKph: null,
    placeName: null, locationObservedAt: null, observedAt: null,
    fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(),
    source: 'openweathermap', conditionCode: null, icon: null, location: null,
  };
}

function buildWeatherProjection({ device, weather, now = Date.now() }) {
  const selection = selectedLocation(device, now);
  if (selection.reason) return unavailable(selection.reason, now);
  if (!weather || weather.error || weather.source !== 'openweathermap') {
    return unavailable('weather_unavailable', now);
  }
  const observedAt = dateMs(weather.observedAt);
  const fetchedAt = dateMs(weather.fetchedAt);
  if (!fresh(observedAt, now) || !fresh(fetchedAt, now)) {
    return unavailable('weather_stale_or_undated', now);
  }
  const condition = weatherCondition(weather.conditionCode);
  if (condition === 'unknown' || !finite(weather.temperature, -100, 80)) {
    return unavailable('weather_unavailable', now);
  }
  const icon = typeof weather.icon === 'string' && /^(01|02|03|04|09|10|11|13|50)[dn]$/.test(weather.icon)
    ? weather.icon : null;
  const kmh = (value) => finite(value, 0, 200) ? Math.round(value * 36) / 10 : null;
  const location = selection.location;
  return {
    schemaVersion: 1, state: 'available', reason: null, condition,
    isDay: icon == null ? null : icon.endsWith('d'),
    temperatureC: weather.temperature,
    windKph: kmh(weather.windSpeedMps), gustKph: kmh(weather.windGustMps),
    placeName: areaName(location.placeLabel || location.placeName) ||
      areaName(weather.location) || 'Recorded area',
    locationObservedAt: new Date(selection.observedAt).toISOString(),
    observedAt: new Date(observedAt).toISOString(),
    fetchedAt: new Date(fetchedAt).toISOString(),
    expiresAt: new Date(Math.min(selection.observedAt + MAX_AGE_MS, observedAt + MAX_AGE_MS,
      fetchedAt + MAX_AGE_MS)).toISOString(),
    source: 'openweathermap', conditionCode: weather.conditionCode, icon,
    location: {
      lat: location.lat, lng: location.lng, source: selection.source,
      retainedSatellite: selection.retainedSatellite === true,
      approximate: selection.source !== 'gps',
    },
  };
}

/** Passive, bounded fleet refresh. No watch commands, alert evaluation or AI. */
function startProfileWeather({
  db, apiKey, enabled = true, provider = null,
  now = Date.now, maxDevices = 100, concurrency = 4,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  onError = (error) => console.warn(`[profile-weather] refresh failed: ${error.message}`),
} = {}) {
  if (!enabled || !db || (!apiKey && !provider)) return { active: false, stop() {} };
  const weatherProvider = provider || new WeatherProvider(apiKey, 10);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(maxDevices) || 100)));
  const workers = Math.max(1, Math.min(4, Math.floor(Number(concurrency) || 4)));
  const written = new Map();
  let cursor = null;
  let pending = null;
  let stopped = false;

  async function refreshDevice(document) {
    const device = document.data();
    const startedAt = now();
    const selection = selectedLocation(device, startedAt);
    let weather = null;
    if (!selection.reason) {
      try {
        weather = await weatherProvider.getWeather(selection.location.lat, selection.location.lng);
      } catch (error) { onError(error); }
    }
    // Recheck ages after the network request, not just at its start.
    const projection = buildWeatherProjection({ device, weather, now: now() });
    const fingerprint = projection.state === 'unavailable'
      ? `${projection.state}:${projection.reason}` : JSON.stringify(projection);
    if (written.get(document.id) === fingerprint || stopped) return;
    await db.collection('devices').doc(document.id).collection('weather').doc('current').set(projection);
    // Only remember successful writes; failures retry at the next refresh.
    written.delete(document.id);
    written.set(document.id, fingerprint);
    if (written.size > 2000) written.delete(written.keys().next().value);
  }

  async function sweep() {
    let query = db.collection('devices').orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const documents = snapshot.docs;
    cursor = documents.length === limit ? documents[documents.length - 1].id : null;
    let next = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      while (next < documents.length && !stopped) {
        const document = documents[next++];
        try { await refreshDevice(document); } catch (error) { onError(error); }
      }
    }));
    return { devicesRead: documents.length };
  }

  function refresh() {
    if (stopped) return Promise.resolve({ stopped: true });
    if (pending) return pending;
    pending = sweep().catch((error) => { onError(error); return { error: true }; })
      .finally(() => { pending = null; });
    return pending;
  }
  const timer = setIntervalFn(() => { void refresh(); }, REFRESH_MS);
  timer.unref?.();
  void refresh();
  return {
    active: true, refresh,
    stop() { stopped = true; clearIntervalFn(timer); written.clear(); },
  };
}

module.exports = { MAX_AGE_MS, REFRESH_MS, buildWeatherProjection, startProfileWeather, weatherCondition };
