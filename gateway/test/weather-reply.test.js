const test = require('node:test');
const assert = require('node:assert/strict');

const { answerWeatherQuery, formatWeatherReply } = require('../src/weather-reply');

function adapted(overrides = {}) {
  return {
    person: { displayName: 'Jesh' },
    location: {
      placeName: 'Lower Vale',
      freshnessMinutes: 2,
      accuracyClass: 'precise',
      ...overrides,
    },
  };
}

test('weather reply reports provider facts for the recorded location', () => {
  const reply = formatWeatherReply({
    adapted: adapted(),
    weather: {
      condition: 'Rain',
      description: 'light rain',
      temperature: 27,
      feelsLike: 29,
      humidity: 82,
      windSpeed: 4,
      alerts: [],
    },
  });
  assert.match(reply, /Weather near Jesh/);
  assert.match(reply, /Lower Vale/);
  assert.match(reply, /light rain/);
  assert.match(reply, /27°C/);
  assert.match(reply, /humidity 82%/);
});

test('weather reply discloses approximate location', () => {
  const reply = formatWeatherReply({
    adapted: adapted({ accuracyClass: 'approximate' }),
    weather: { condition: 'Clear', description: 'clear sky', temperature: 26, alerts: [] },
  });
  assert.match(reply, /approximate recorded location/);
});

test('stale location blocks a weather lookup and says why', async () => {
  let calls = 0;
  const reply = await answerWeatherQuery({
    device: {
      nickname: 'Jesh',
      lastHeartbeatAt: new Date(),
      lastSatelliteLocation: {
        lat: -20.0279,
        lng: 57.5961,
        source: 'gps',
        recordedAt: new Date(Date.now() - 90 * 60_000),
      },
    },
    contextService: {
      weatherProvider: { getWeather: async () => { calls += 1; } },
    },
  });
  assert.equal(calls, 0);
  assert.match(reply, /latest trustworthy location is 90 minutes old/);
});

test('missing weather provider fails without inventing conditions', async () => {
  const reply = await answerWeatherQuery({
    device: {
      nickname: 'Jesh',
      lastHeartbeatAt: new Date(),
      lastSatelliteLocation: {
        lat: -20.0279,
        lng: 57.5961,
        source: 'gps',
        placeLabel: 'Lower Vale',
        recordedAt: new Date(),
      },
    },
    contextService: null,
  });
  assert.match(reply, /couldn’t retrieve current weather/);
  assert.doesNotMatch(reply, /\d+°C/);
});

test('missing temperature is never converted into zero degrees', () => {
  const reply = formatWeatherReply({
    adapted: adapted(),
    weather: { condition: 'Clear', description: 'clear sky', temperature: null },
  });
  assert.match(reply, /couldn’t retrieve current weather/);
  assert.doesNotMatch(reply, /0°C/);
});

test('missing location age is treated as unknown rather than fresh', () => {
  const reply = formatWeatherReply({
    adapted: adapted({ freshnessMinutes: null }),
    weather: { condition: 'Clear', description: 'clear sky', temperature: 26 },
  });
  assert.match(reply, /location has an unknown age/);
  assert.doesNotMatch(reply, /26°C/);
});
