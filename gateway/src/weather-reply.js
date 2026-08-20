const { adaptDeviceContext } = require('./context/deviceContextAdapter');
const {
  isApproximateLocationSource,
  normalizeLocationSource,
  selectLocationForDisplay,
} = require('./location-provenance');

const MAX_WEATHER_LOCATION_AGE_MINUTES = 60;

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value) {
  const number = finiteNumber(value);
  return number == null ? null : Math.round(number);
}

function locationAgeText(minutes) {
  const value = rounded(minutes);
  if (value == null) return 'has an unknown age';
  if (value < 1) return 'is less than a minute old';
  if (value === 1) return 'is 1 minute old';
  return `is ${value} minutes old`;
}

function validLocation(location) {
  const lat = finiteNumber(location?.lat);
  const lng = finiteNumber(location?.lng);
  return lat != null && lng != null &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}

function recordedAgeMinutes(location, now) {
  const recordedAt = location?.recordedAt?.toDate?.() || location?.recordedAt;
  const timestamp = recordedAt ? new Date(recordedAt) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
  return Math.max(0, (now.getTime() - timestamp.getTime()) / 60_000);
}

/**
 * Weather does not need metre-level positioning, but it should agree with the
 * family map while a trustworthy satellite fix is still current. Once that
 * fix is too old for current weather, retain the normal provenance selector so
 * a fresh WiFi/LBS area can still answer honestly instead of borrowing an old
 * GPS timestamp.
 */
function selectWeatherLocation(
  device,
  { now = new Date(), maxLocationAgeMinutes = MAX_WEATHER_LOCATION_AGE_MINUTES } = {},
) {
  const fallback = selectLocationForDisplay(device);
  const latest = device?.lastLocationObservation || device?.location || null;
  const latestSource = normalizeLocationSource(
    latest?.source || device?.accuracySource,
  );
  const satellite = device?.lastSatelliteLocation ||
    (latestSource === 'gps' ? latest : null);
  const satelliteAge = recordedAgeMinutes(satellite, now);

  if (
    validLocation(satellite) &&
    satelliteAge != null &&
    satelliteAge <= maxLocationAgeMinutes
  ) {
    return {
      location: satellite,
      source: 'gps',
      retainedSatellite:
        isApproximateLocationSource(latestSource) && latest !== satellite,
      latestObservation: latest,
    };
  }

  return fallback;
}

function formatWeatherReply({ adapted, weather, maxLocationAgeMinutes = MAX_WEATHER_LOCATION_AGE_MINUTES } = {}) {
  const name = adapted?.person?.displayName || 'your loved one';
  const location = adapted?.location;
  if (!location) {
    return `I can’t check weather near ${name} because no trustworthy location is available.`;
  }

  const age = finiteNumber(location.freshnessMinutes);
  if (age == null || age > maxLocationAgeMinutes) {
    return `I can’t check current weather near ${name} reliably because the latest trustworthy location ${locationAgeText(location.freshnessMinutes)}.`;
  }

  if (!weather || weather.error || weather.condition === 'unknown' || rounded(weather.temperature) == null) {
    return `I couldn’t retrieve current weather near ${name} at ${location.placeName || 'the recorded location'} right now.`;
  }

  const place = location.placeName || weather.location || 'the recorded area';
  const condition = String(weather.description || weather.condition || 'conditions unavailable').trim();
  const facts = [`${rounded(weather.temperature)}°C`];
  const feelsLike = rounded(weather.feelsLike);
  if (feelsLike != null) facts.push(`feels like ${feelsLike}°C`);
  if (rounded(weather.humidity) != null) facts.push(`humidity ${rounded(weather.humidity)}%`);
  if (rounded(weather.windSpeed) != null) facts.push(`wind ${rounded(weather.windSpeed)} m/s`);

  const locationLead = location.accuracyClass === 'approximate'
    ? `Weather around ${name} in`
    : location.retainedSatellite === true
      ? `Weather near ${name}’s last reliable location in`
      : `Weather near ${name} in`;
  const lines = [`${locationLead} *${place}*: ${condition}, ${facts.join(' · ')}.`];
  const alerts = Array.isArray(weather.alerts) ? weather.alerts : [];
  if (alerts.length > 0) {
    lines.push(`⚠️ ${alerts.map((alert) => alert.message).filter(Boolean).join('; ')}.`);
  }
  return lines.join('\n');
}

async function answerWeatherQuery({
  device,
  contextService,
  maxLocationAgeMinutes,
  now,
} = {}) {
  const maxAge = maxLocationAgeMinutes ?? MAX_WEATHER_LOCATION_AGE_MINUTES;
  const observedAt = now instanceof Date ? now : new Date(now || Date.now());
  const locationSelection = selectWeatherLocation(device || {}, {
    now: observedAt,
    maxLocationAgeMinutes: maxAge,
  });
  const adapted = adaptDeviceContext(device || {}, {
    now: observedAt,
    locationSelection,
  });
  if (!adapted) return formatWeatherReply({ adapted: null });

  const age = finiteNumber(adapted.location.freshnessMinutes);
  if (age == null || age > maxAge) {
    return formatWeatherReply({ adapted, maxLocationAgeMinutes: maxAge });
  }

  const provider = contextService?.weatherProvider;
  if (!provider || typeof provider.getWeather !== 'function') {
    return formatWeatherReply({ adapted, weather: null, maxLocationAgeMinutes: maxAge });
  }
  const weather = await provider.getWeather(
    adapted.location.lat,
    adapted.location.lng,
    adapted.location.placeName,
  );
  return formatWeatherReply({ adapted, weather, maxLocationAgeMinutes: maxAge });
}

module.exports = {
  MAX_WEATHER_LOCATION_AGE_MINUTES,
  selectWeatherLocation,
  formatWeatherReply,
  answerWeatherQuery,
};
