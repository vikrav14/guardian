const test = require('node:test');
const assert = require('node:assert/strict');
const { trackJourneyPoint, closeJourney, journeyDistanceKm } = require('../src/journey-builder');
const { evaluateGeofenceTransitions, resetGeofenceStateForTests } = require('../src/geofence');

// Synthetic coordinates in a public park; no pilot location or device IDs.
const home = { lat: -20.25, lng: 57.5 };
function zoneDb() {
  const query = {
    where() { return query; },
    async get() {
      return { docs: [{ id: 'test-zone', data: () => ({
        center: home, radiusMeters: 150, name: 'Test zone',
      }) }] };
    },
  };
  return { collection: () => query };
}

test('network drift cannot start a journey after restart, even with reported speed', () => {
  const state = { lastPersistedLocation: home };
  const now = new Date('2026-09-06T20:16:00Z');
  const result = trackJourneyPoint(state, {
    lat: home.lat + 0.008, lng: home.lng,
    source: 'wifi', gpsValid: false, accuracyMeters: 519,
    speedKmh: 8, recordedAt: now,
  }, now);
  assert.equal(result.started, false);
  assert.equal(Boolean(state.currentJourney), false);
});

test('a disjoint approximate uncertainty circle cannot prove leaving Home', async () => {
  resetGeofenceStateForTests();
  const db = zoneDb();
  await evaluateGeofenceTransitions(db, 'synthetic-watch', {
    ...home, source: 'gps', gpsValid: true, satellites: 7,
  });
  // ~1.1 km offset: even a provider radius wholly outside the zone is an
  // approximate observation, not independent evidence the wearer moved.
  const events = await evaluateGeofenceTransitions(db, 'synthetic-watch', {
    lat: home.lat + 0.01, lng: home.lng,
    source: 'wifi', gpsValid: false, accuracyMeters: 519,
  });
  assert.deepEqual(events, []);
});

test('all 44 reported network updates produce no journey or flush', () => {
  const sample = require('../../docs/testing/journey-source-evidence.json').cases[0].journey;
  const { decodePolyline } = require('../src/polyline');
  const coords = decodePolyline(sample.polyline);
  const state = { lastPersistedLocation: home };
  for (let i = 0; i < coords.length; i++) {
    const at = new Date(Date.parse(sample.startAt) + sample.pointEvidence[i].offsetMs);
    const result = trackJourneyPoint(state, { ...coords[i], ...sample.pointEvidence[i], recordedAt: at }, at);
    assert.equal(result.started, false);
    assert.deepEqual(result.flushes, []);
  }
  assert.equal(closeJourney(state, new Date(sample.endAt), 'idle'), null);
});

test('approximate updates remain evidence in a real GPS trip but add no distance or stops', () => {
  const state = {};
  const start = Date.parse('2026-09-06T18:00:00Z');
  const points = [0, 0.001, 0.002, 0.01, 0.012].map((offset, i) => ({
    lat: home.lat + offset, lng: home.lng,
    source: i < 3 ? 'gps' : 'wifi', gpsValid: i < 3,
    speedKmh: i < 3 ? 8 : 0, recordedAt: new Date(start + i * 60000),
  }));
  points.forEach(p => trackJourneyPoint(state, p, p.recordedAt));
  const doc = closeJourney(state, points.at(-1).recordedAt, 'manual');
  assert.equal(doc.pointCount, 5);
  assert.equal(doc.routeCoverage.approximatePointCount, 2);
  assert.ok(doc.distanceKm > 0.22 && doc.distanceKm < 0.23);
  assert.equal(doc.distanceKm, Math.round(journeyDistanceKm(points.slice(0, 3)) * 1000) / 1000);
  assert.deepEqual(doc.stops, []);
  assert.equal(doc.routeCoverage.structureReliable, false);
});

test('network drift cannot keep a genuine generic trip moving forever', () => {
  const state = {};
  const start = Date.parse('2026-09-06T17:00:00Z');
  for (let i = 0; i < 3; i++) {
    const at = new Date(start + i * 60000);
    trackJourneyPoint(state, { lat: home.lat + i * 0.001, lng: home.lng,
      source: 'gps', gpsValid: true, speedKmh: 8, recordedAt: at }, at);
  }
  const lastMovementAt = +state.currentJourney.lastMovementAt;
  const at = new Date(start + 30 * 60000);
  const result = trackJourneyPoint(state, { lat: home.lat + 0.01, lng: home.lng,
    source: 'lbs', gpsValid: false, speedKmh: 9, recordedAt: at }, at);
  assert.equal(lastMovementAt, start + 2 * 60000);
  assert.equal(result.flushes.length, 1);
  assert.equal(result.flushes[0].closeReason, 'idle');
});

test('network observation cannot confirm a return or create an origin transition', () => {
  const state = {};
  const start = Date.parse('2026-09-06T16:00:00Z');
  const point = (minutes, source) => ({ ...home, source, gpsValid: source === 'gps',
    speedKmh: source === 'gps' ? 8 : 0, recordedAt: new Date(start + minutes * 60000) });
  const transition = type => ({ geofenceTransition: true, transitionType: type,
    geofenceId: 'home', geofenceName: 'Test zone' });
  const first = point(0, 'gps');
  trackJourneyPoint(state, first, first.recordedAt, transition('geofence_exit'));
  const entered = point(2, 'gps');
  trackJourneyPoint(state, entered, entered.recordedAt, transition('geofence_enter'));
  const indoor = point(5, 'wifi');
  const unconfirmed = trackJourneyPoint(state, indoor, indoor.recordedAt, transition('geofence_enter'));
  assert.deepEqual(unconfirmed.flushes, []);
  assert.equal(state.currentJourney.events.length, 2);
  const confirmed = point(6, 'gps');
  const result = trackJourneyPoint(state, confirmed, confirmed.recordedAt);
  assert.equal(result.flushes.length, 1);
  assert.equal(result.flushes[0].closeReason, 'return_to_origin');
});
