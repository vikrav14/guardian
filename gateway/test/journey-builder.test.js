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

function transition(type, id = 'home-id', name = 'Home') {
  return {
    geofenceTransition: true,
    transitionType: type,
    geofenceName: name,
    geofenceId: id,
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

test('trackJourneyPoint closes generic journey after idle timeout', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T08:00:00Z');

  trackJourneyPoint(state, movingPoint(), start);
  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T08:05:00Z'),
    new Date('2026-07-22T08:05:00Z')
  );

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

test('geofence exit starts an outing and records its origin', () => {
  const state = emptyState();
  state.lastPersistedLocation = { lat: -20.2642, lng: 57.4791 };

  const exitAt = new Date('2026-07-22T09:05:00Z');
  const result = trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T09:05:00Z'),
    exitAt,
    transition('geofence_exit')
  );

  assert.equal(result.started, true);
  assert.equal(result.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.originGeofenceId, 'home-id');
  assert.equal(state.currentJourney.originGeofenceName, 'Home');
  assert.equal(state.currentJourney.events.length, 1);
  assert.equal(state.currentJourney.events[0].type, 'geofence_exit');
});

test('geofence exit never flushes an already-active outing', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T09:00:00Z');

  trackJourneyPoint(state, movingPoint(), start);

  const result = trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T09:02:00Z'),
    new Date('2026-07-22T09:02:00Z'),
    transition('geofence_exit')
  );

  assert.equal(result.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.originGeofenceId, 'home-id');
  assert.equal(state.currentJourney.events.length, 1);
  assert.equal(state.currentJourney.events[0].type, 'geofence_exit');
});

test('origin outing survives a long stop away from home', () => {
  const state = emptyState();
  state.lastPersistedLocation = { lat: -20.2642, lng: 57.4791 };

  const exitAt = new Date('2026-07-22T10:00:00Z');
  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T10:00:00Z'),
    exitAt,
    transition('geofence_exit')
  );

  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T10:05:00Z'),
    new Date('2026-07-22T10:05:00Z')
  );

  // Twenty minutes stationary at the stop: this must remain the same outing,
  // even though the generic journey idle threshold is 15 minutes.
  const stoppedAt = new Date('2026-07-22T10:25:00Z');
  const stopped = trackJourneyPoint(
    state,
    {
      lat: -20.2622,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: stoppedAt,
    },
    stoppedAt
  );

  assert.equal(stopped.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.originGeofenceId, 'home-id');
});

test('Home to stop to Home closes as one confirmed outing', () => {
  const state = emptyState();
  state.lastPersistedLocation = { lat: -20.2642, lng: 57.4791 };

  const exitAt = new Date('2026-07-22T11:00:00Z');
  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T11:00:00Z'),
    exitAt,
    transition('geofence_exit')
  );

  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T11:05:00Z'),
    new Date('2026-07-22T11:05:00Z')
  );

  // A stop away from home does not close the outing.
  const stopAt = new Date('2026-07-22T11:15:00Z');
  const stopped = trackJourneyPoint(
    state,
    {
      lat: -20.2622,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: stopAt,
    },
    stopAt
  );
  assert.equal(stopped.flushes.length, 0);

  // First Home-enter fix only creates a return candidate.
  const enterAt = new Date('2026-07-22T11:30:00Z');
  const entered = trackJourneyPoint(
    state,
    {
      lat: -20.2641,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: enterAt,
    },
    enterAt,
    transition('geofence_enter')
  );

  assert.equal(entered.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.ok(state.currentJourney.returnCandidateAt);

  // One minute later is still inside the confirmation window.
  const oneMinuteLater = new Date('2026-07-22T11:31:00Z');
  const waiting = trackJourneyPoint(
    state,
    {
      lat: -20.26415,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: oneMinuteLater,
    },
    oneMinuteLater
  );

  assert.equal(waiting.flushes.length, 0);
  assert.ok(state.currentJourney);

  // After two minutes, with no origin-exit transition in between, close exactly once.
  const confirmedAt = new Date('2026-07-22T11:32:05Z');
  const confirmed = trackJourneyPoint(
    state,
    {
      lat: -20.26418,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: confirmedAt,
    },
    confirmedAt
  );

  assert.equal(confirmed.flushes.length, 1);
  assert.equal(confirmed.flushes[0].closeReason, 'return_to_origin');
  assert.equal(confirmed.flushes[0].originGeofenceId, 'home-id');
  assert.equal(confirmed.flushes[0].originGeofenceName, 'Home');
  assert.equal(
    new Date(confirmed.flushes[0].endAt).toISOString(),
    enterAt.toISOString()
  );
  assert.equal(state.currentJourney, null);

  const eventTypes = confirmed.flushes[0].events.map((event) => event.type);
  assert.deepEqual(eventTypes, [
    'geofence_exit',
    'geofence_enter',
    'outing_return',
  ]);
});

test('brief origin re-entry followed by exit does not close outing', () => {
  const state = emptyState();
  state.lastPersistedLocation = { lat: -20.2642, lng: 57.4791 };

  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T12:00:00Z'),
    new Date('2026-07-22T12:00:00Z'),
    transition('geofence_exit')
  );

  const enterAt = new Date('2026-07-22T12:10:00Z');
  trackJourneyPoint(
    state,
    {
      lat: -20.2641,
      lng: 57.4791,
      speedKmh: 0,
      recordedAt: enterAt,
    },
    enterAt,
    transition('geofence_enter')
  );

  const exitAgainAt = new Date('2026-07-22T12:11:00Z');
  const leftAgain = trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T12:11:00Z'),
    exitAgainAt,
    transition('geofence_exit')
  );

  assert.equal(leftAgain.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.returnCandidateAt, null);

  const afterOriginalWindow = new Date('2026-07-22T12:13:00Z');
  const stillOpen = trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T12:13:00Z'),
    afterOriginalWindow
  );

  assert.equal(stillOpen.flushes.length, 0);
  assert.ok(state.currentJourney);
});

test('forceCloseJourney remains available for explicit administrative closure', () => {
  const state = emptyState();
  const now = new Date('2026-07-22T13:00:00Z');

  trackJourneyPoint(state, movingPoint(), now);
  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T13:02:00Z'),
    new Date('2026-07-22T13:02:00Z')
  );

  const doc = forceCloseJourney(
    state,
    new Date('2026-07-22T13:05:00Z'),
    'manual'
  );
  assert.ok(doc);
  assert.equal(doc.closeReason, 'manual');
  assert.equal(state.currentJourney, null);
});

test('journeyDistanceKm matches decoded polyline path', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T14:00:00Z');

  trackJourneyPoint(
    state,
    { lat: -20.2642, lng: 57.4791, speedKmh: 10, recordedAt: start },
    start
  );
  trackJourneyPoint(
    state,
    {
      lat: -20.2652,
      lng: 57.4791,
      speedKmh: 10,
      recordedAt: new Date('2026-07-22T14:01:00Z'),
    },
    new Date('2026-07-22T14:01:00Z')
  );
  trackJourneyPoint(
    state,
    {
      lat: -20.2662,
      lng: 57.4791,
      speedKmh: 10,
      recordedAt: new Date('2026-07-22T14:02:00Z'),
    },
    new Date('2026-07-22T14:02:00Z')
  );

  const doc = closeJourney(
    state,
    new Date('2026-07-22T14:03:00Z'),
    'idle'
  );

  assert.ok(doc);
  assert.equal(doc.pointCount, 3);
  assert.ok(doc.distanceKm > 0);

  const decoded = decodePolyline(doc.polyline);
  assert.equal(decoded.length, 3);
});

test('duplicate timestamp is ignored inside an active outing', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T15:00:00Z');

  trackJourneyPoint(state, movingPoint(0, '2026-07-22T15:00:00Z'), start);
  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T15:01:00Z'),
    new Date('2026-07-22T15:01:00Z')
  );

  const duplicate = trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T15:01:00Z'),
    new Date('2026-07-22T15:01:05Z')
  );

  assert.equal(duplicate.flushes.length, 0);
  assert.equal(duplicate.started, false);
  assert.equal(state.currentJourney.points.length, 2);
});

test('out-of-order point is ignored inside an active outing', () => {
  const state = emptyState();

  trackJourneyPoint(
    state,
    movingPoint(0, '2026-07-22T16:00:00Z'),
    new Date('2026-07-22T16:00:00Z')
  );
  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T16:02:00Z'),
    new Date('2026-07-22T16:02:00Z')
  );

  const stale = trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T16:01:00Z'),
    new Date('2026-07-22T16:03:00Z')
  );

  assert.equal(stale.flushes.length, 0);
  assert.equal(stale.started, false);
  assert.equal(state.currentJourney.points.length, 2);
  assert.equal(
    new Date(state.currentJourney.points[1].recordedAt).toISOString(),
    '2026-07-22T16:02:00.000Z'
  );
});

test('closed journey blocks stale packets from starting an overlapping journey', () => {
  const state = emptyState();

  trackJourneyPoint(
    state,
    movingPoint(0, '2026-07-22T17:00:00Z'),
    new Date('2026-07-22T17:00:00Z')
  );
  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T17:02:00Z'),
    new Date('2026-07-22T17:02:00Z')
  );

  const first = closeJourney(
    state,
    new Date('2026-07-22T17:03:00Z'),
    'manual'
  );
  assert.ok(first);

  const stale = trackJourneyPoint(
    state,
    movingPoint(0.003, '2026-07-22T17:02:30Z'),
    new Date('2026-07-22T17:04:00Z')
  );

  assert.equal(stale.started, false);
  assert.equal(stale.flushes.length, 0);
  assert.equal(state.currentJourney, null);
});

test('sequential closed journeys cannot overlap', () => {
  const state = emptyState();

  trackJourneyPoint(
    state,
    movingPoint(0, '2026-07-22T18:00:00Z'),
    new Date('2026-07-22T18:00:00Z')
  );
  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-07-22T18:02:00Z'),
    new Date('2026-07-22T18:02:00Z')
  );

  const first = closeJourney(
    state,
    new Date('2026-07-22T18:03:00Z'),
    'manual'
  );
  assert.ok(first);

  const secondStartAt = new Date('2026-07-22T18:04:00Z');
  const started = trackJourneyPoint(
    state,
    movingPoint(0.003, '2026-07-22T18:04:00Z'),
    secondStartAt
  );
  assert.equal(started.started, true);

  trackJourneyPoint(
    state,
    movingPoint(0.004, '2026-07-22T18:05:00Z'),
    new Date('2026-07-22T18:05:00Z')
  );

  const second = closeJourney(
    state,
    new Date('2026-07-22T18:06:00Z'),
    'manual'
  );
  assert.ok(second);

  assert.ok(
    new Date(first.endAt).getTime() <= new Date(second.startAt).getTime()
  );
});
