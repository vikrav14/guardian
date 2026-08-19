const test = require('node:test');
const assert = require('node:assert/strict');

const {
  answerWeatherQuery,
  formatWeatherReply,
  selectWeatherLocation,
} = require('../src/weather-reply');

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

test('weather reply reports provider facts naturally for a satellite location', () => {
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
  assert.match(reply, /Weather near Jesh in/);
  assert.match(reply, /Lower Vale/);
  assert.match(reply, /light rain/);
  assert.match(reply, /27°C/);
  assert.match(reply, /humidity 82%/);
});

test('weather reply describes a fresh approximate area naturally', () => {
  const reply = formatWeatherReply({
    adapted: adapted({ accuracyClass: 'approximate' }),
    weather: { condition: 'Clear', description: 'clear sky', temperature: 26, alerts: [] },
  });
  assert.match(reply, /Weather around Jesh in \*Lower Vale\*/);
  assert.doesNotMatch(reply, /approximate recorded location/);
});

test('weather selection keeps a recent reliable GPS fix beyond map retention', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  const selection = selectWeatherLocation({
    accuracySource: 'wifi',
    lastLocationObservation: {
      lat: -20.02,
      lng: 57.60,
      source: 'wifi',
      placeLabel: 'Approximate area',
      recordedAt: new Date('2026-08-19T23:58:00.000Z'),
    },
    lastSatelliteLocation: {
      lat: -20.0279,
      lng: 57.5961,
      source: 'gps',
      placeLabel: 'Lower Vale',
      recordedAt: new Date('2026-08-19T23:20:00.000Z'),
    },
  }, { now, maxLocationAgeMinutes: 60 });

  assert.equal(selection.source, 'gps');
  assert.equal(selection.retainedSatellite, true);
  assert.equal(selection.location.placeLabel, 'Lower Vale');
});

test('weather lookup uses a recent reliable GPS fix and says so', async () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  let requestedLocation;
  const reply = await answerWeatherQuery({
    now,
    device: {
      nickname: 'Jesh',
      accuracySource: 'wifi',
      lastHeartbeatAt: now,
      lastLocationObservation: {
        lat: -20.02,
        lng: 57.60,
        source: 'wifi',
        placeLabel: 'Approximate area',
        recordedAt: new Date('2026-08-19T23:58:00.000Z'),
      },
      lastSatelliteLocation: {
        lat: -20.0279,
        lng: 57.5961,
        source: 'gps',
        placeLabel: 'Lower Vale',
        recordedAt: new Date('2026-08-19T23:20:00.000Z'),
      },
    },
    contextService: {
      weatherProvider: {
        getWeather: async (lat, lng, placeName) => {
          requestedLocation = { lat, lng, placeName };
          return {
            condition: 'Clouds',
            description: 'few clouds',
            temperature: 22,
            alerts: [],
          };
        },
      },
    },
  });

  assert.deepEqual(requestedLocation, {
    lat: -20.0279,
    lng: 57.5961,
    placeName: 'Lower Vale',
  });
  assert.match(reply, /Weather near Jesh’s last reliable location in \*Lower Vale\*/);
  assert.doesNotMatch(reply, /approximate recorded location/);
});

test('weather lookup uses a fresh approximate area when GPS is too old', async () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  let requestedLocation;
  const reply = await answerWeatherQuery({
    now,
    device: {
      nickname: 'Jesh',
      accuracySource: 'wifi',
      lastHeartbeatAt: now,
      lastLocationObservation: {
        lat: -20.028,
        lng: 57.596,
        source: 'wifi',
        placeLabel: 'Lower Vale',
        recordedAt: new Date('2026-08-19T23:58:00.000Z'),
      },
      lastSatelliteLocation: {
        lat: -20.10,
        lng: 57.50,
        source: 'gps',
        placeLabel: 'Old GPS area',
        recordedAt: new Date('2026-08-19T21:00:00.000Z'),
      },
    },
    contextService: {
      weatherProvider: {
        getWeather: async (lat, lng, placeName) => {
          requestedLocation = { lat, lng, placeName };
          return {
            condition: 'Clouds',
            description: 'few clouds',
            temperature: 22,
            alerts: [],
          };
        },
      },
    },
  });

  assert.deepEqual(requestedLocation, {
    lat: -20.028,
    lng: 57.596,
    placeName: 'Lower Vale',
  });
  assert.match(reply, /Weather around Jesh in \*Lower Vale\*/);
  assert.doesNotMatch(reply, /Old GPS area/);
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
