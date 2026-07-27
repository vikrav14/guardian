const test = require('node:test');
const assert = require('node:assert/strict');
const {
  trackJourneyPoint,
  closeJourney,
  forceCloseJourney,
  journeyDistanceKm,
} = require('../src/journey-builder');
const { decodePolyline } = require('../src/polyline');

function emptyState() {
  return { currentJourney: null, lastPersistedLocation: null };
}

function movingPoint(latOffset = 0, at = '2026-07-22T08:00:00Z') {
  const recordedAt = new Date(at);
  return {
    lat: -20.2642 + latOffset,
    lng: 57.4791,
    speedKmh: 12,
    recordedAt,
  };
}

test('trackJourneyPoint starts journey when moving', () => {
  const state = emptyState();
  const now = new Date('2026-07-22T08:00:00Z');

  const result = trackJourneyPoint(state, movingPoint(), now);
  assert.equal(result.started, true);
  assert.equal(result.flushes.length, 0);
  assert.ok(state.currentJourney);
});

test('trackJourneyPoint closes journey after idle timeout', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T08:00:00Z');

  trackJourneyPoint(state, movingPoint(), start);
  trackJourneyPoint(state, movingPoint(0.001, '2026-07-22T08:05:00Z'), new Date('2026-07-22T08:05:00Z'));

  const idleAt = new Date('2026-07-22T08:20:00Z');
  const result = trackJourneyPoint(
    state,
    {
      lat: -20.2632,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: idleAt,
    },
    idleAt
  );

  assert.equal(result.flushes.length, 1);
  assert.equal(result.flushes[0].closeReason, 'idle');
  assert.equal(result.flushes[0].compressed, true);
  assert.ok(result.flushes[0].polyline);
  assert.equal(state.currentJourney, null);
});

test('geofence exit closes active journey with event', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T09:00:00Z');

  trackJourneyPoint(state, movingPoint(), start);
  trackJourneyPoint(state, movingPoint(0.002, '2026-07-22T09:02:00Z'), new Date('2026-07-22T09:02:00Z'));

  const exitAt = new Date('2026-07-22T09:05:00Z');
  const result = trackJourneyPoint(
    state,
    movingPoint(0.003, '2026-07-22T09:05:00Z'),
    exitAt,
    {
      geofenceTransition: true,
      transitionType: 'geofence_exit',
      geofenceName: 'Home',
      geofenceId: 'home-id',
    }
  );

  assert.equal(result.flushes.length, 1);
  assert.equal(result.flushes[0].closeReason, 'geofence_exit');
  assert.equal(result.flushes[0].events[0].type, 'geofence_exit');
  assert.equal(result.flushes[0].events[0].name, 'Home');
});

test('forceCloseJourney flushes open journey on disconnect', () => {
  const state = emptyState();
  const now = new Date('2026-07-22T10:00:00Z');

  trackJourneyPoint(state, movingPoint(), now);
  trackJourneyPoint(state, movingPoint(0.001, '2026-07-22T10:02:00Z'), new Date('2026-07-22T10:02:00Z'));

  const doc = forceCloseJourney(state, new Date('2026-07-22T10:05:00Z'));
  assert.ok(doc);
  assert.equal(doc.closeReason, 'disconnect');
  assert.equal(state.currentJourney, null);
});

test('journeyDistanceKm matches decoded polyline path', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T11:00:00Z');
  trackJourneyPoint(
    state,
    { lat: -20.2642, lng: 57.4791, speedKmh: 10, recordedAt: start },
    start
  );
  trackJourneyPoint(
    state,
    { lat: -20.2652, lng: 57.4791, speedKmh: 10, recordedAt: new Date('2026-07-22T11:01:00Z') },
    new Date('2026-07-22T11:01:00Z')
  );
  trackJourneyPoint(
    state,
    { lat: -20.2662, lng: 57.4791, speedKmh: 10, recordedAt: new Date('2026-07-22T11:02:00Z') },
    new Date('2026-07-22T11:02:00Z')
  );

  const doc = closeJourney(state, new Date('2026-07-22T11:03:00Z'), 'idle');
  assert.ok(doc);
  assert.equal(doc.pointCount, 3);
  assert.ok(doc.distanceKm > 0);

  const decoded = decodePolyline(doc.polyline);
  assert.equal(decoded.length, 3);
});
