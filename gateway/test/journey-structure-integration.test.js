const test = require('node:test');
const assert = require('node:assert/strict');
const { trackJourneyPoint } = require('../src/journey-builder');

function transition(type) {
  return {
    geofenceTransition: true,
    transitionType: type,
    geofenceId: 'home-id',
    geofenceName: 'Home',
  };
}

function point(lat, lng, at, speedKmh) {
  return {
    lat,
    lng,
    speedKmh,
    recordedAt: new Date(at),
  };
}

test('closed Home outing contains one stop and two legs without guessing the place', () => {
  const state = {
    currentJourney: null,
    lastPersistedLocation: { lat: -20.2642, lng: 57.4791 },
  };

  trackJourneyPoint(
    state,
    point(-20.2630, 57.4800, '2026-08-11T14:00:00Z', 8),
    new Date('2026-08-11T14:00:00Z'),
    transition('geofence_exit')
  );

  trackJourneyPoint(
    state,
    point(-20.2550, 57.4840, '2026-08-11T14:08:00Z', 0),
    new Date('2026-08-11T14:08:00Z')
  );
  trackJourneyPoint(
    state,
    point(-20.25502, 57.48401, '2026-08-11T14:12:00Z', 0),
    new Date('2026-08-11T14:12:00Z')
  );
  trackJourneyPoint(
    state,
    point(-20.25501, 57.48402, '2026-08-11T14:16:00Z', 0),
    new Date('2026-08-11T14:16:00Z')
  );

  trackJourneyPoint(
    state,
    point(-20.2600, 57.4810, '2026-08-11T14:22:00Z', 12),
    new Date('2026-08-11T14:22:00Z')
  );

  const enterAt = new Date('2026-08-11T14:30:00Z');
  trackJourneyPoint(
    state,
    point(-20.2641, 57.4791, '2026-08-11T14:30:00Z', 0),
    enterAt,
    transition('geofence_enter')
  );

  const result = trackJourneyPoint(
    state,
    point(-20.26415, 57.4791, '2026-08-11T14:32:05Z', 0),
    new Date('2026-08-11T14:32:05Z')
  );

  assert.equal(result.flushes.length, 1);

  const outing = result.flushes[0];
  assert.equal(outing.closeReason, 'return_to_origin');
  assert.equal(outing.stopCount, 1);
  assert.equal(outing.legCount, 2);
  assert.equal(outing.stops[0].durationMinutes, 8);
  assert.equal(outing.stops[0].placeName, null);
  assert.equal(outing.legs[0].toStopId, 'stop_1');
  assert.equal(outing.legs[1].fromStopId, 'stop_1');
});
