'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/context/weatherProvider');
const { buildWeatherProjection, startProfileWeather, MAX_AGE_MS } = require('../src/profile-weather');
const now = Date.parse('2026-09-17T12:00:00Z');
const location = { lat: -20.028, lng: 57.596, source: 'gps', placeLabel: 'Lower Vale', recordedAt: new Date(now - 120_000) };
const device = { lastLocationObservation: location, lastSatelliteLocation: location, lastHeartbeatAt: new Date(now) };
const weather = {
  source: 'openweathermap', conditionCode: 801, icon: '02d', temperature: 24,
  observedAt: new Date(now - 10 * 60_000).toISOString(), fetchedAt: now - 60_000,
  windSpeedMps: 4.5, windGustMps: 7.25, location: 'Grand Baie',
};
const project = (d = device, w = weather, time = now) => buildWeatherProjection({ device: d, weather: w, now: time });

test('weather uses source observation age, day/night, exact wind conversion and location expiry', () => {
  const value = project();
  assert.equal(value.state, 'available');
  assert.equal(value.condition, 'partly_cloudy');
  assert.equal(value.isDay, true);
  assert.equal(value.windKph, 16.2);
  assert.equal(value.gustKph, 26.1);
  assert.equal(value.placeName, 'Lower Vale');
  assert.equal(value.observedAt, weather.observedAt);
  assert.equal(value.expiresAt, new Date(now + 50 * 60_000).toISOString());
  assert.equal(project(device, { ...weather, icon: '02n' }).isDay, false);
  assert.equal(project(device, { ...weather, icon: null }).isDay, null);
  assert.equal(project(device, { ...weather, icon: '99d' }).isDay, null);
  assert.equal(project(device, { ...weather, windSpeedMps: 0 }).windKph, 0);
  assert.equal(project(device, { ...weather, windSpeedMps: null }).windKph, null);
  assert.equal(project(device, { ...weather, observedAt: new Date(now).toISOString(),
    fetchedAt: now - 59 * 60_000 }).expiresAt, new Date(now + 60_000).toISOString());
});

test('bad, absent, future and stale location timestamps never borrow a fresh heartbeat', () => {
  for (const recordedAt of [null, 'bad', new Date(now - MAX_AGE_MS), new Date(now + 120_000)]) {
    const fix = { ...location, recordedAt };
    assert.equal(project({ ...device, lastLocationObservation: fix, lastSatelliteLocation: fix }).state, 'unavailable');
  }
  for (const fix of [{ ...location, lat: null }, { ...location, lat: 91 }, { ...location, lat: 0, lng: 0 }]) {
    assert.equal(project({ ...device, lastLocationObservation: fix, lastSatelliteLocation: fix }).state, 'unavailable');
  }
});

test('cached weather without source time or with stale/future time fails closed', () => {
  for (const observedAt of [null, 'bad', new Date(now - MAX_AGE_MS).toISOString(), new Date(now + 120_000).toISOString()]) {
    const value = project(device, { ...weather, observedAt, fetchedAt: now });
    assert.equal(value.state, 'unavailable');
    assert.equal(value.temperatureC, null);
  }
  assert.equal(project(device, { ...weather, temperature: null }).state, 'unavailable');
  assert.equal(project(device, { ...weather, conditionCode: 999 }).state, 'unavailable');
  assert.equal(project(device, { ...weather, source: 'not_requested' }).state, 'unavailable');
});

test('recent satellite is retained, then fresh approximate area is used when it is too old', () => {
  const wifi = { ...location, source: 'wifi', placeLabel: 'Approximate area', lat: -20.04 };
  const retained = project({ ...device, lastLocationObservation: wifi });
  assert.equal(retained.location.retainedSatellite, true);
  assert.equal(retained.location.lat, location.lat);
  const approximate = project({ lastLocationObservation: wifi,
    lastSatelliteLocation: { ...location, recordedAt: new Date(now - MAX_AGE_MS - 1) } });
  assert.equal(approximate.location.source, 'wifi');
  assert.equal(approximate.location.approximate, true);
  assert.equal(approximate.placeName, 'Approximate area');
});

test('weather condition codes cover rain, thunder, snow, mist and cloudy skies without guessing', () => {
  for (const [code, condition] of [[211, 'thunderstorm'], [301, 'rain'], [501, 'rain'], [601, 'snow'],
    [741, 'mist'], [800, 'clear'], [802, 'partly_cloudy'], [804, 'cloudy']]) {
    assert.equal(project(device, { ...weather, conditionCode: code }).condition, condition);
  }
  assert.equal(project(device, { ...weather, conditionCode: null }).state, 'unavailable');
  for (const code of [711, 721, 731, 751, 761, 762, 771, 781]) {
    assert.equal(project(device, { ...weather, conditionCode: code }).state, 'unavailable');
  }
});

test('profile weather uses a fresh area despite expired or future GPS and keeps its real expiry', () => {
  const wifi = { ...location, source: 'wifi', placeLabel: 'Recent area',
    recordedAt: new Date(now - 45 * 60_000) };
  for (const recordedAt of [new Date(now - 70 * 60_000), new Date(now - MAX_AGE_MS),
    new Date(now + 2 * 60_000)]) {
    const value = project({ lastSatelliteLocation: { ...location, recordedAt },
      lastLocationObservation: wifi });
    assert.equal(value.state, 'available');
    assert.equal(value.location.source, 'wifi');
    assert.equal(value.locationObservedAt, wifi.recordedAt.toISOString());
    assert.equal(value.expiresAt, new Date(now + 15 * 60_000).toISOString());
  }
  assert.equal(project({ lastSatelliteLocation: { ...location, recordedAt: new Date(now - 70 * 60_000) },
    lastLocationObservation: { ...wifi, recordedAt: new Date(now - MAX_AGE_MS) },
    lastHeartbeatAt: new Date(now) }).state, 'unavailable');
});

function fakeDb(initial) {
  const writes = [];
  const documents = initial.map(([id, data]) => ({ id, data: () => data }));
  let failure = false;
  return {
    writes, documents, failNext() { failure = true; },
    collection(name) {
      assert.equal(name, 'devices');
      return {
        orderBy(field) {
          assert.equal(field, '__name__');
          let count, after = '';
          return {
            limit(value) { count = value; return this; },
            startAfter(value) { after = value; return this; },
            async get() { return { docs: documents.filter(doc => doc.id > after).slice(0, count) }; },
          };
        },
        doc(id) { return { collection(collection) {
          assert.equal(collection, 'weather');
          return { doc(key) {
            assert.equal(key, 'current');
            return { async set(value, options) {
              assert.equal(options, undefined, 'replace the projection; do not merge old weather');
              if (failure) { failure = false; throw new Error('write failed'); }
              writes.push({ id, value });
            } };
          } };
        } }; },
      };
    },
  };
}

function runtime(db, getWeather, overrides = {}) {
  return startProfileWeather({ db, provider: { getWeather }, now: () => now,
    onError() {}, setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {}, ...overrides });
}

test('scheduler skips invalid locations, deduplicates successful cached writes and replaces failures', async () => {
  const db = fakeDb([['a', device], ['b', { lastHeartbeatAt: new Date(now) }]]);
  let calls = 0, result = weather;
  const service = runtime(db, async () => { calls++; return result; });
  await service.refresh();
  assert.equal(calls, 1);
  assert.equal(db.writes.length, 2);
  await service.refresh();
  assert.equal(db.writes.length, 2);
  result = { error: 'network failed' };
  await service.refresh();
  assert.equal(db.writes.length, 3);
  assert.equal(db.writes[2].value.state, 'unavailable');
  assert.equal(db.writes[2].value.temperatureC, null);
  service.stop();
});

test('failed writes retry, overlapping sweeps share work and paging stays bounded', async () => {
  const db = fakeDb([['a', device], ['b', device], ['c', device]]);
  db.failNext();
  const service = runtime(db, async () => weather, { maxDevices: 2 });
  assert.equal(service.refresh(), service.refresh());
  await service.refresh();
  assert.equal(db.writes.length, 1);
  await service.refresh();
  assert.equal(db.writes.length, 2);
  await service.refresh();
  assert.deepEqual(db.writes.map(w => w.id).sort(), ['a', 'b', 'c']);
  service.stop();
  await service.refresh();
  assert.equal(db.writes.length, 3);
  assert.equal(startProfileWeather({ db, apiKey: '' }).active, false);
});

test('provider preserves dt/code/icon and coalesces same-cell calls without relabelling fetch time', async () => {
  const provider = new WeatherProvider('test', 10);
  let calls = 0;
  provider._fetchFromOpenWeatherMap = async () => {
    calls++;
    return { dt: now / 1000, weather: [{ id: 211, main: 'Thunderstorm', icon: '11n' }],
      main: { temp: 24.3 }, wind: { speed: 4.5, gust: 7.25 }, name: 'Lower Vale' };
  };
  const [a, b] = await Promise.all([provider.getWeather(-20.028, 57.596), provider.getWeather(-20.028, 57.596)]);
  assert.equal(calls, 1);
  assert.equal(a.conditionCode, 211);
  assert.equal(a.icon, '11n');
  assert.equal(a.windSpeedMps, 4.5);
  assert.equal(a.observedAt, new Date(now).toISOString());
  assert.equal(a.fetchedAt, b.fetchedAt);
  await provider.getWeather(-20.028, 57.596);
  assert.equal(calls, 1);
  const absent = provider._normalizeWeather({ main: { temp: null } });
  assert.equal(absent.observedAt, null);
  assert.equal(absent.temperature, null);
});

test('provider HTTP failures, request timeout and oversized responses settle without cache entries', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const originalGet = https.get;
  try {
    for (const mode of ['http_error', 'timeout', 'oversized']) {
      let request, response, onTimeout;
      https.get = (_url, receive) => {
        request = new EventEmitter();
        request.setTimeout = (_ms, callback) => { onTimeout = callback; };
        request.destroy = error => { request.emit('error', error); request.emit('close'); };
        process.nextTick(() => {
          response = new EventEmitter();
          response.statusCode = mode === 'http_error' ? 429 : 200;
          receive(response);
          if (mode === 'timeout') onTimeout();
          if (mode === 'oversized') response.emit('data', 'x'.repeat(256 * 1024 + 1));
          if (mode === 'http_error') {
            response.emit('data', JSON.stringify({ message: 'rate limited' }));
            response.emit('end');
            request.emit('close');
          }
        });
        return request;
      };
      const provider = new WeatherProvider('test', 10);
      await assert.rejects(provider._fetchFromOpenWeatherMap(-20, 57),
        mode === 'http_error' ? /429/ : mode === 'timeout' ? /timed out/ : /too large/);
      assert.equal(provider.cache.size, 0);
    }
  } finally { https.get = originalGet; }
});
