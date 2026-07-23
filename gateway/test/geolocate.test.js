const test = require('node:test');
const assert = require('node:assert/strict');

const originalFetch = global.fetch;

test('geolocateFromV caches successful responses', async (t) => {
  process.env.GOOGLE_GEOLOCATION_API_KEY = 'test-key';
  process.env.FIRESTORE_DISABLED = 'false';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/geolocate/google')];
  const {
    geolocateFromV,
    cacheKey,
    clearGeolocationCache,
  } = require('../src/geolocate/google');

  clearGeolocationCache();

  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return { location: { lat: -20.261, lng: 57.478 }, accuracy: 45 };
      },
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.GOOGLE_GEOLOCATION_API_KEY;
    delete process.env.FIRESTORE_DISABLED;
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/geolocate/google')];
  });

  const input = {
    wifiAccessPoints: [{ macAddress: '8c:14:b4:5e:4b:a8', signalStrength: -80 }],
    cellTowers: [{
      mobileCountryCode: 617,
      mobileNetworkCode: 1,
      locationAreaCode: 10142,
      cellId: 225274433,
    }],
  };

  const key = cacheKey(input);
  assert.ok(key.length > 10);

  const first = await geolocateFromV(input);
  const second = await geolocateFromV(input);

  assert.equal(calls, 1);
  assert.deepEqual(first, { lat: -20.261, lng: 57.478, accuracyMeters: 45 });
  assert.deepEqual(second, first);
});

test('geolocateFromV skips when API key missing', async (t) => {
  delete process.env.GOOGLE_GEOLOCATION_API_KEY;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/geolocate/google')];
  const { geolocateFromV, clearGeolocationCache } = require('../src/geolocate/google');
  clearGeolocationCache();

  t.after(() => {
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/geolocate/google')];
  });

  const result = await geolocateFromV({
    wifiAccessPoints: [{ macAddress: 'aa:bb:cc:dd:ee:ff' }],
  });
  assert.equal(result, null);
});

test('geolocateFromV skips when FIRESTORE_DISABLED', async (t) => {
  process.env.GOOGLE_GEOLOCATION_API_KEY = 'test-key';
  process.env.FIRESTORE_DISABLED = 'true';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/geolocate/google')];
  const { geolocateFromV, clearGeolocationCache } = require('../src/geolocate/google');
  clearGeolocationCache();

  let called = false;
  global.fetch = async () => {
    called = true;
    return { ok: true, async json() { return {}; } };
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.GOOGLE_GEOLOCATION_API_KEY;
    delete process.env.FIRESTORE_DISABLED;
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/geolocate/google')];
  });

  const result = await geolocateFromV({
    cellTowers: [{
      mobileCountryCode: 617,
      mobileNetworkCode: 1,
      locationAreaCode: 1,
      cellId: 2,
    }],
  });
  assert.equal(result, null);
  assert.equal(called, false);
});
