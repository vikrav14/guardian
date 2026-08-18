const { adaptDeviceContext } = require('./context/deviceContextAdapter');

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

  const place = location.placeName || weather.location || 'the recorded location';
  const accuracy = location.accuracyClass === 'approximate'
    ? 'approximate recorded location'
    : 'recorded location';
  const condition = String(weather.description || weather.condition || 'conditions unavailable').trim();
  const facts = [`${rounded(weather.temperature)}°C`];
  const feelsLike = rounded(weather.feelsLike);
  if (feelsLike != null) facts.push(`feels like ${feelsLike}°C`);
  if (rounded(weather.humidity) != null) facts.push(`humidity ${rounded(weather.humidity)}%`);
  if (rounded(weather.windSpeed) != null) facts.push(`wind ${rounded(weather.windSpeed)} m/s`);

  const lines = [
    `Weather near ${name}’s ${accuracy} at *${place}*: ${condition}, ${facts.join(' · ')}.`,
  ];
  const alerts = Array.isArray(weather.alerts) ? weather.alerts : [];
  if (alerts.length > 0) {
    lines.push(`⚠️ ${alerts.map((alert) => alert.message).filter(Boolean).join('; ')}.`);
  }
  return lines.join('\n');
}

async function answerWeatherQuery({ device, contextService, maxLocationAgeMinutes } = {}) {
  const adapted = adaptDeviceContext(device || {});
  if (!adapted) return formatWeatherReply({ adapted: null });

  const age = finiteNumber(adapted.location.freshnessMinutes);
  const maxAge = maxLocationAgeMinutes ?? MAX_WEATHER_LOCATION_AGE_MINUTES;
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
  formatWeatherReply,
  answerWeatherQuery,
};
