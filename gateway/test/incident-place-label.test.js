'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichIncidentPlaceLabel } = require('../src/incident-place-label');
const { buildIncidentLocationSnapshot } = require('../src/incident-location-evidence');
const now = new Date('2026-09-01T12:00:00Z');
const point = { lat: -20.2, lng: 57.2, source: 'lbs', accuracyMeters: 267, recordedAt: now };
const snapshot = () => buildIncidentLocationSnapshot({}, { now, observation: point });

test('identical coordinates reuse a name without renewing time or borrowing old GPS coordinates', async () => {
  const original = snapshot();
  const result = await enrichIncidentPlaceLabel(original, { device: {
    lastSatelliteLocation: { ...point, source: 'gps', recordedAt: new Date(0), placeLabel: 'Fixture town' },
  }, reverseGeocode: () => { throw Error('must use cached name'); } });
  assert.equal(result.location.placeLabel, 'Fixture town');
  assert.equal(result.location.source, 'lbs');
  assert.equal(result.location.accuracyMeters, 267);
  assert.equal(result.location.recordedAt.getTime(), +now);
  assert.equal(original.location.placeLabel, null);
});

test('a different previous place cannot label the current point; enrichment only changes the name', async () => {
  const original = snapshot();
  const result = await enrichIncidentPlaceLabel(original, { device: {
    location: { ...point, lat: -20.1, placeLabel: 'Old town' },
  }, reverseGeocode: async (lat, lng) => {
    assert.deepEqual([lat, lng], [point.lat, point.lng]); return 'Current town';
  } });
  assert.equal(result.location.placeLabel, 'Current town');
  assert.deepEqual({ ...result, location: { ...result.location, placeLabel: null },
    latestObservation: { ...result.latestObservation, placeLabel: null } }, original);
});

test('stalled lookup is bounded and aborted; a late answer cannot rewrite the snapshot', async () => {
  const original = snapshot();
  let complete, signal;
  const started = performance.now();
  const result = await enrichIncidentPlaceLabel(original, { timeoutMs: 20,
    reverseGeocode: (_lat, _lng, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve; }); } });
  assert.ok(performance.now() - started < 500);
  assert.equal(signal.aborted, true);
  assert.equal(result, original);
  complete('Late town');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.location.placeLabel, null);
});

test('provider error or empty name preserves original evidence', async () => {
  for (const reverseGeocode of [async () => { throw Error('offline'); }, async () => null, async () => '  ']) {
    const original = snapshot();
    assert.equal(await enrichIncidentPlaceLabel(original, { reverseGeocode }), original);
  }
});

test('Home, unavailable and already labelled snapshots do not request another name', async () => {
  for (const original of [{ state: 'unavailable', location: null },
    { state: 'fresh', location: { ...point, source: 'home_wifi', placeLabel: 'Home' } },
    { state: 'fresh', location: { ...point, placeLabel: 'Named town' } }]) {
    let calls = 0;
    assert.equal(await enrichIncidentPlaceLabel(original, { reverseGeocode: async () => { calls++; return 'Wrong'; } }), original);
    assert.equal(calls, 0);
  }
});
