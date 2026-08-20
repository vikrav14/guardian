const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLocationObservation,
  buildLocationProvenancePatch,
  backfillLegacyLocationProvenance,
  selectLocationForDisplay,
} = require('../src/location-provenance');

const gpsAt = new Date('2026-08-14T19:42:33.000Z');
const indoorAt = new Date('2026-08-14T19:47:33.000Z');

test('satellite observation clears an older fallback accuracy radius', () => {
  const observation = buildLocationObservation(
    {
      lat: -20.029278,
      lng: 57.5960427,
      recordedAt: gpsAt,
      accuracyMeters: 308.701,
    },
    'gps',
    true
  );

  assert.equal(observation.source, 'gps');
  assert.equal(observation.gpsValid, true);
  assert.equal(observation.accuracyMeters, null);
});

test('approximate observation keeps its source and estimated radius', () => {
  const observation = buildLocationObservation(
    {
      lat: -20.028,
      lng: 57.596,
      recordedAt: indoorAt,
      accuracyMeters: 308.701,
    },
    'wifi',
    false
  );

  assert.equal(observation.source, 'wifi');
  assert.equal(observation.gpsValid, false);
  assert.equal(observation.accuracyMeters, 308.701);
});

test('GPS and approximate observations are retained independently', () => {
  const gpsPatch = buildLocationProvenancePatch(
    { lat: -20.029278, lng: 57.5960427, recordedAt: gpsAt },
    'gps',
    true
  );
  const wifiPatch = buildLocationProvenancePatch(
    {
      lat: -20.028,
      lng: 57.596,
      recordedAt: indoorAt,
      accuracyMeters: 308.701,
    },
    'wifi',
    false
  );

  assert.ok(gpsPatch.lastSatelliteLocation);
  assert.equal(gpsPatch.lastApproximateLocation, undefined);
  assert.ok(wifiPatch.lastApproximateLocation);
  assert.equal(wifiPatch.lastSatelliteLocation, undefined);
});

test('legacy GPS is retained before the first indoor observation replaces it', () => {
  const incoming = buildLocationProvenancePatch(
    {
      lat: -20.028,
      lng: 57.596,
      recordedAt: indoorAt,
      accuracyMeters: 308.701,
    },
    'wifi',
    false
  );
  const seeded = backfillLegacyLocationProvenance(
    {
      accuracySource: 'gps',
      location: {
        lat: -20.029278,
        lng: 57.5960427,
        recordedAt: gpsAt,
        // This is the stale radius that exposed the legacy merge bug.
        accuracyMeters: 308.701,
      },
    },
    incoming
  );

  assert.equal(seeded.location.source, 'wifi');
  assert.equal(seeded.lastApproximateLocation.accuracyMeters, 308.701);
  assert.equal(seeded.lastSatelliteLocation.source, 'gps');
  assert.equal(seeded.lastSatelliteLocation.accuracyMeters, null);
  assert.equal(seeded.lastSatelliteLocation.lat, -20.029278);
});

test('recent indoor fallback does not displace the last satellite display fix', () => {
  const device = {
    accuracySource: 'wifi',
    lastLocationObservation: {
      lat: -20.028,
      lng: 57.596,
      source: 'wifi',
      recordedAt: indoorAt,
      accuracyMeters: 308.701,
    },
    lastSatelliteLocation: {
      lat: -20.029278,
      lng: 57.5960427,
      source: 'gps',
      recordedAt: gpsAt,
      accuracyMeters: null,
    },
  };

  const selected = selectLocationForDisplay(device);
  assert.equal(selected.retainedSatellite, true);
  assert.equal(selected.source, 'gps');
  assert.equal(selected.location.lat, -20.029278);
  assert.equal(selected.latestObservation.source, 'wifi');
});

test('newer approximate observation becomes display location after retention window', () => {
  const device = {
    accuracySource: 'lbs',
    lastLocationObservation: {
      lat: -20.02,
      lng: 57.60,
      source: 'lbs',
      recordedAt: new Date('2026-08-14T20:22:33.000Z'),
      accuracyMeters: 900,
    },
    lastSatelliteLocation: {
      lat: -20.029278,
      lng: 57.5960427,
      source: 'gps',
      recordedAt: gpsAt,
      accuracyMeters: null,
    },
  };

  const selected = selectLocationForDisplay(device);
  assert.equal(selected.retainedSatellite, false);
  assert.equal(selected.source, 'lbs');
  assert.equal(selected.location.lat, -20.02);
});
