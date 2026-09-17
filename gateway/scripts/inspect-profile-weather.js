'use strict';

const { selectWeatherLocation } = require('../src/weather-reply');
const { buildWeatherProjection } = require('../src/profile-weather');

function time(value) {
  if (value == null || value === '') return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function locationSummary(location, now, source = null) {
  const at = time(location?.recordedAt);
  return {
    source: location?.source || source,
    observedAt: at?.toISOString() || null,
    ageMinutes: at ? Math.round((now - at) / 6000) / 10 : null,
    validCoordinates: typeof location?.lat === 'number' && Number.isFinite(location.lat) &&
      Math.abs(location.lat) <= 90 && typeof location?.lng === 'number' &&
      Number.isFinite(location.lng) && Math.abs(location.lng) <= 180 &&
      !(location.lat === 0 && location.lng === 0),
  };
}

function buildReport({ device, weather, config, now = new Date() }) {
  const selection = selectWeatherLocation(device || {}, { now });
  const preflight = buildWeatherProjection({ device: device || {}, weather: null, now: +now });
  return {
    outcome: 'read_only',
    asOf: now.toISOString(),
    configurationSource: 'this_command_environment_not_running_gateway',
    weatherKeyConfiguredHere: Boolean(config.openWeatherMapKey),
    deviceFound: device != null,
    locations: {
      latestObservation: locationSummary(device?.lastLocationObservation, now, device?.accuracySource),
      currentLocation: locationSummary(device?.location, now, device?.accuracySource),
      lastSatellite: locationSummary(device?.lastSatelliteLocation, now, 'gps'),
      lastApproximate: locationSummary(device?.lastApproximateLocation, now),
    },
    selectedLocation: {
      ...locationSummary(selection.location, now, selection.source),
      retainedSatellite: selection.retainedSatellite === true,
      rejectionReason: preflight.reason.startsWith('location_') ? preflight.reason : null,
    },
    storedWeather: {
      exists: weather != null,
      state: weather?.state || null,
      reason: weather?.reason || null,
      locationObservedAt: time(weather?.locationObservedAt)?.toISOString() || null,
      weatherObservedAt: time(weather?.observedAt)?.toISOString() || null,
      fetchedAt: time(weather?.fetchedAt)?.toISOString() || null,
      expiresAt: time(weather?.expiresAt)?.toISOString() || null,
    },
    interpretation: 'Location selection uses this checkout. Stored weather was written by the gateway; it may predate these checks. No API key value, watch command, weather request or database write is produced.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !/^--imei=\d{15}$/.test(args[0]))) {
    throw new Error('Usage: npm run weather:check [-- --imei=<15 digits>]');
  }
  const config = require('../src/config');
  const imei = args[0]?.slice(7) || String(config.wifiHomePilotImei || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('Set WIFI_HOME_PILOT_IMEI or pass --imei=<15 digits>.');
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('Firestore is unavailable.');
  const ref = db.collection('devices').doc(imei);
  const [device, weather] = await Promise.all([
    ref.get(), ref.collection('weather').doc('current').get(),
  ]);
  console.log(JSON.stringify(buildReport({
    device: device.exists ? device.data() : null,
    weather: weather.exists ? weather.data() : null,
    config,
  }), null, 2));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { buildReport };
