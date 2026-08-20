'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALL_LOCATION_SNAPSHOT_VERSION,
  buildFallLocationSnapshot,
  withFallLocationSnapshot,
  deviceAtFall,
} = require('../src/fall-location-snapshot');

const now = new Date('2026-08-15T10:00:00.000Z');

function gpsLocation(recordedAt, overrides = {}) {
  return {
    lat: -20.029192,
    lng: 57.5959408,
    recordedAt,
    placeLabel: 'Lower Vale',
    source: 'gps',
    gpsValid: true,
    accuracyMeters: null,
    ...overrides,
  };
}

test('fall snapshot freezes a fresh satellite location', () => {
  const snapshot = buildFallLocationSnapshot({
    accuracySource: 'gps',
    location: gpsLocation(new Date('2026-08-15T09:58:00.000Z')),
  }, { now });

  assert.equal(snapshot.version, FALL_LOCATION_SNAPSHOT_VERSION);
  assert.equal(snapshot.state, 'fresh');
  assert.equal(snapshot.location.source, 'gps');
  assert.equal(snapshot.location.accuracyMeters, null);
  assert.equal(snapshot.location.placeLabel, 'Lower Vale');
});

test('fall snapshot retains the selected satellite fix over a newer indoor estimate', () => {
  const satellite = gpsLocation(new Date('2026-08-15T09:55:00.000Z'));
  const approximate = {
    lat: -20.0242914,
    lng: 57.5912515,
    recordedAt: new Date('2026-08-15T09:56:00.000Z'),
    placeLabel: 'Grand Baie',
    source: 'wifi',
    gpsValid: false,
    accuracyMeters: 579.851,
  };
  const snapshot = buildFallLocationSnapshot({
    location: approximate,
    lastLocationObservation: approximate,
    lastSatelliteLocation: satellite,
    accuracySource: 'wifi',
  }, { now });

  assert.equal(snapshot.retainedSatellite, true);
  assert.equal(snapshot.location.placeLabel, 'Lower Vale');
  assert.equal(snapshot.location.source, 'gps');
});

test('fall snapshot records unavailable without trustworthy coordinates', () => {
  const snapshot = buildFallLocationSnapshot({
    location: { lat: 0, lng: 0, source: 'gps', gpsValid: true },
    accuracySource: 'gps',
  }, { now });

  assert.equal(snapshot.state, 'unavailable');
  assert.equal(snapshot.location, null);
});

test('later device movement cannot replace the location frozen in the alert', () => {
  const snapshot = buildFallLocationSnapshot({
    accuracySource: 'gps',
    location: gpsLocation(new Date('2026-08-15T09:58:00.000Z')),
  }, { now });
  const laterDevice = {
    accuracySource: 'gps',
    location: gpsLocation(new Date('2026-08-15T10:10:00.000Z'), {
      lat: -20.1609,
      lng: 57.5012,
      placeLabel: 'Port Louis',
    }),
  };
  const frozen = deviceAtFall(laterDevice, {
    type: 'fall',
    payload: { locationSnapshot: snapshot },
  });

  assert.equal(frozen.location.placeLabel, 'Lower Vale');
  assert.equal(frozen.location.lat, -20.029192);
  assert.equal(frozen.accuracySource, 'gps');
});

test('legacy fall without a snapshot never borrows the current device location', () => {
  const frozen = deviceAtFall({
    accuracySource: 'gps',
    location: gpsLocation(now),
  }, { type: 'fall', payload: {} });

  assert.equal(frozen.location, null);
  assert.equal(frozen.accuracySource, null);
});

test('non-fall payloads are returned untouched', () => {
  const payload = { alarmCode: '10000' };
  const result = withFallLocationSnapshot(
    'sos',
    payload,
    { location: gpsLocation(now), accuracySource: 'gps' },
    { now }
  );

  assert.equal(result, payload);
  assert.equal(result.locationSnapshot, undefined);
});

test('fall snapshot preserves existing alarm payload fields', () => {
  const result = withFallLocationSnapshot(
    'fall',
    { alarmCode: '400000' },
    { location: gpsLocation(now), accuracySource: 'gps' },
    { now }
  );

  assert.equal(result.alarmCode, '400000');
  assert.equal(result.locationSnapshot.state, 'fresh');
});
