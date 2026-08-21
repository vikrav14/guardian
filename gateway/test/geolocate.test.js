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
    // Locally administered placeholder; never use a captured device address.
    wifiAccessPoints: [{ macAddress: '02:00:00:00:00:01', signalStrength: -80 }],
    cellTowers: [{
      mobileCountryCode: 617,
      mobileNetworkCode: 1,
      locationAreaCode: 101,
      cellId: 1001,
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

  // dotenv (loaded by ../src/config) fills in any env var absent from
  // process.env, so deleting GOOGLE_GEOLOCATION_API_KEY above doesn't
  // actually simulate "missing" in a dev environment that has a real
  // .env on disk -- it just gets reloaded on the require above. Clear it
  // on the resolved config object itself so this test holds regardless
  // of what's in .env.
  const config = require('../src/config');
  const realApiKey = config.googleGeolocationApiKey;
  config.googleGeolocationApiKey = '';

  t.after(() => {
    config.googleGeolocationApiKey = realApiKey;
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

test('forward geocoding accepts only Mauritius results and caches place labels', async (t) => {
  process.env.FIRESTORE_DISABLED = 'false';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/geolocate/google')];
  const {
    clearGeolocationCache,
    forwardGeocodeMauritiusPlace,
  } = require('../src/geolocate/google');
  clearGeolocationCache();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.match(url, /address=La%20Rosa%2C%20Mauritius/);
    return {
      ok: true,
      async json() {
        return {
          results: [{
            formatted_address: 'La Rosa, Mauritius',
            place_id: 'place-la-rosa',
            address_components: [{
              short_name: 'MU',
              long_name: 'Mauritius',
              types: ['country'],
            }],
            geometry: { location: { lat: -20.02, lng: 57.57 } },
          }],
        };
      },
    };
  };

  t.after(() => {
    delete process.env.FIRESTORE_DISABLED;
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/geolocate/google')];
  });
  const first = await forwardGeocodeMauritiusPlace('La Rosa', {
    apiKey: 'test-key',
    fetchImpl,
  });
  const second = await forwardGeocodeMauritiusPlace('La Rosa', {
    apiKey: 'test-key',
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(first, {
    lat: -20.02,
    lng: 57.57,
    placeName: 'La Rosa',
    formattedAddress: 'La Rosa, Mauritius',
    placeId: 'place-la-rosa',
    source: 'google_geocoding',
  });
});
