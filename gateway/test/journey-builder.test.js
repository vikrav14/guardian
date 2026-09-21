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
  return { source: 'gps', gpsValid: true,
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
    { source: 'gps', gpsValid: true,
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
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

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

test('confirmed safe-zone exit prepends the latest trusted inside GPS point', () => {
  const state = emptyState();
  const insideAt = new Date('2026-08-17T09:00:00Z');

  const inside = trackJourneyPoint(
    state,
    {
      lat: -20.029232,
      lng: 57.595928,
      speedKmh: 0,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 7,
      recordedAt: insideAt,
    },
    insideAt,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: true,
      insideSafeZoneIds: ['home-id'],
    }
  );

  assert.equal(inside.started, false);
  assert.equal(state.currentJourney, null);
  assert.ok(state.lastConfirmedSafeZonePoint);

  const exitAt = new Date('2026-08-17T09:01:00Z');
  const exited = trackJourneyPoint(
    state,
    {
      lat: -20.027307,
      lng: 57.6018805,
      speedKmh: 18.28,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 8,
      recordedAt: exitAt,
    },
    exitAt,
    {
      ...transition('geofence_exit'),
      transitionEvidence: { classification: 'outside', source: 'gps' },
      hasActiveSafeZones: true,
      insideAnySafeZone: false,
      insideSafeZoneIds: [],
    }
  );

  assert.equal(exited.started, true);
  assert.equal(state.currentJourney.points.length, 2);
  assert.equal(state.currentJourney.routeStartAnchored, true);
  assert.equal(
    new Date(state.currentJourney.startAt).toISOString(),
    insideAt.toISOString()
  );
  assert.equal(
    new Date(state.currentJourney.departureAt).toISOString(),
    exitAt.toISOString()
  );

  const enterAt = new Date('2026-08-17T09:03:00Z');
  trackJourneyPoint(
    state,
    {
      lat: -20.029232,
      lng: 57.595928,
      speedKmh: 4,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 6,
      recordedAt: enterAt,
    },
    enterAt,
    {
      ...transition('geofence_enter'),
      transitionEvidence: { classification: 'inside', source: 'gps' },
      hasActiveSafeZones: true,
      insideAnySafeZone: true,
      insideSafeZoneIds: ['home-id'],
    }
  );

  const confirmedAt = new Date('2026-08-17T09:05:05Z');
  const confirmed = trackJourneyPoint(
    state,
    {
      lat: -20.02923,
      lng: 57.59593,
      speedKmh: 0,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 6,
      recordedAt: confirmedAt,
    },
    confirmedAt,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: true,
      insideSafeZoneIds: ['home-id'],
    }
  );

  assert.equal(confirmed.flushes.length, 1);
  const doc = confirmed.flushes[0];
  assert.equal(doc.evidenceVersion, 3);
  assert.equal(doc.routeStartAnchored, true);
  assert.equal(doc.pointCount, 3);
  assert.equal(new Date(doc.startAt).toISOString(), insideAt.toISOString());
  assert.equal(new Date(doc.departureAt).toISOString(), exitAt.toISOString());
  assert.equal(new Date(doc.returnAt).toISOString(), enterAt.toISOString());
  assert.equal(doc.routeCoverage.gapCount, 0);
  assert.equal(doc.routeStartEvidence.gpsValid, true);

  const decoded = decodePolyline(doc.polyline);
  assert.equal(decoded[0].lat, -20.02923);
  assert.equal(decoded[0].lng, 57.59593);
});

test('stale inside GPS point cannot masquerade as the departure route start', () => {
  const state = emptyState();
  const insideAt = new Date('2026-08-17T10:00:00Z');
  trackJourneyPoint(
    state,
    {
      lat: -20.029232,
      lng: 57.595928,
      speedKmh: 0,
      source: 'gps',
      gpsValid: true,
      recordedAt: insideAt,
    },
    insideAt,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: true,
      insideSafeZoneIds: ['home-id'],
    }
  );

  const exitAt = new Date('2026-08-17T10:06:00Z');
  trackJourneyPoint(
    state,
    {
      lat: -20.027307,
      lng: 57.6018805,
      speedKmh: 18,
      source: 'gps',
      gpsValid: true,
      recordedAt: exitAt,
    },
    exitAt,
    {
      ...transition('geofence_exit'),
      hasActiveSafeZones: true,
    }
  );

  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.routeStartAnchored, false);
  assert.equal(state.currentJourney.points.length, 1);
  assert.equal(new Date(state.currentJourney.startAt).toISOString(), exitAt.toISOString());
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
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

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
    { source: 'gps', gpsValid: true,
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
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

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
    { source: 'gps', gpsValid: true,
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
    { source: 'gps', gpsValid: true,
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
    { source: 'gps', gpsValid: true,
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
    { source: 'gps', gpsValid: true,
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
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

  trackJourneyPoint(
    state,
    movingPoint(0.001, '2026-07-22T12:00:00Z'),
    new Date('2026-07-22T12:00:00Z'),
    transition('geofence_exit')
  );

  const enterAt = new Date('2026-07-22T12:10:00Z');
  trackJourneyPoint(
    state,
    { source: 'gps', gpsValid: true,
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
    { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791, speedKmh: 10, recordedAt: start },
    start
  );
  trackJourneyPoint(
    state,
    { source: 'gps', gpsValid: true,
      lat: -20.2652,
      lng: 57.4791,
      speedKmh: 10,
      recordedAt: new Date('2026-07-22T14:01:00Z'),
    },
    new Date('2026-07-22T14:01:00Z')
  );
  trackJourneyPoint(
    state,
    { source: 'gps', gpsValid: true,
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
test('active safe zone context blocks drift-only generic journey start', () => {
  const state = emptyState();
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

  const now = new Date('2026-08-11T08:00:00Z');
  const result = trackJourneyPoint(
    state,
    {
      // ~67m coordinate wobble: enough to satisfy the legacy 50m movement
      // threshold even though the watch has not actually left Home.
      lat: -20.2636,
      lng: 57.4791,
      speedKmh: 0,
      accuracySource: 'wifi',
      recordedAt: now,
    },
    now,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: true,
    }
  );

  assert.equal(result.started, false);
  assert.equal(result.flushes.length, 0);
  assert.equal(state.currentJourney, null);
});

test('confirmed safe-zone exit still starts outing when active zones are configured', () => {
  const state = emptyState();
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

  const exitAt = new Date('2026-08-11T09:00:00Z');
  const result = trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-08-11T09:00:00Z'),
    exitAt,
    {
      ...transition('geofence_exit'),
      hasActiveSafeZones: true,
    }
  );

  assert.equal(result.started, true);
  assert.equal(result.flushes.length, 0);
  assert.ok(state.currentJourney);
  assert.equal(state.currentJourney.originGeofenceId, 'home-id');
});
test('active safe zone configured but currently outside still allows generic journey start', () => {
  const state = emptyState();
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };

  const now = new Date('2026-08-11T10:00:00Z');
  const result = trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-08-11T10:00:00Z'),
    now,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: false,
    }
  );

  assert.equal(result.started, true);
  assert.equal(result.flushes.length, 0);
  assert.ok(state.currentJourney);
});

test('uncertain safe-zone presence blocks a drift-only generic journey start', () => {
  const state = emptyState();
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.029234, lng: 57.5957028 };
  const now = new Date('2026-08-17T08:10:00Z');

  const result = trackJourneyPoint(
    state,
    {
      lat: -20.0242989,
      lng: 57.5912873,
      speedKmh: 0,
      source: 'wifi',
      accuracySource: 'wifi',
      gpsValid: false,
      accuracyMeters: 581.672,
      recordedAt: now,
    },
    now,
    {
      hasActiveSafeZones: true,
      insideAnySafeZone: false,
      hasUncertainSafeZones: true,
    }
  );

  assert.equal(result.started, false);
  assert.equal(result.flushes.length, 0);
  assert.equal(state.currentJourney, null);
});

test('completed journey stores real point timing, provenance, and route gaps', () => {
  const state = emptyState();
  const start = new Date('2026-08-17T08:00:00Z');
  const departureEvidence = {
    classification: 'outside',
    source: 'gps',
    gpsValid: true,
    satellites: 10,
  };

  trackJourneyPoint(
    state,
    {
      lat: -20.029234,
      lng: 57.5957028,
      speedKmh: 8,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 10,
      recordedAt: start,
    },
    start,
    {
      ...transition('geofence_exit'),
      transitionEvidence: departureEvidence,
    }
  );

  trackJourneyPoint(
    state,
    {
      lat: -20.027307,
      lng: 57.6018805,
      speedKmh: 18.28,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 8,
      recordedAt: new Date('2026-08-17T08:01:00Z'),
    },
    new Date('2026-08-17T08:01:00Z')
  );

  trackJourneyPoint(
    state,
    {
      lat: -20.029232,
      lng: 57.595928,
      speedKmh: 16.04,
      source: 'gps',
      accuracySource: 'gps',
      gpsValid: true,
      satellites: 6,
      recordedAt: new Date('2026-08-17T08:28:00Z'),
    },
    new Date('2026-08-17T08:28:00Z')
  );

  const doc = closeJourney(
    state,
    new Date('2026-08-17T08:30:00Z'),
    'manual'
  );

  assert.equal(doc.evidenceVersion, 3);
  assert.equal(doc.pointEvidence.length, 3);
  assert.deepEqual(
    doc.pointEvidence.map((point) => point.offsetMs),
    [0, 60_000, 1_680_000]
  );
  assert.equal(doc.pointEvidence[0].source, 'gps');
  assert.equal(doc.pointEvidence[0].satellites, 10);
  assert.equal(doc.routeCoverage.gpsPointCount, 3);
  assert.equal(doc.routeCoverage.approximatePointCount, 0);
  assert.equal(doc.routeCoverage.gapCount, 1);
  assert.equal(doc.routeCoverage.interrupted, true);
  assert.equal(doc.routeGaps[0].durationSeconds, 27 * 60);
  assert.equal(doc.routeGaps[0].fromPointIndex, 1);
  assert.equal(doc.routeGaps[0].toPointIndex, 2);
  assert.equal(doc.routeSegments.length, 2);
  assert.deepEqual(
    doc.routeSegments.map((segment) => segment.pointCount),
    [2, 1]
  );
  assert.equal(doc.distanceKm, doc.routeSegments[0].distanceKm);
  assert.equal(doc.routeCoverage.structureReliable, false);
  assert.deepEqual(doc.departureEvidence, departureEvidence);
});

test('journey events retain the geofence observation evidence used for transitions', () => {
  const state = emptyState();
  state.lastPersistedLocation = { source: 'gps', gpsValid: true, lat: -20.2642, lng: 57.4791 };
  const at = new Date('2026-08-17T09:00:00Z');
  const evidence = {
    classification: 'outside',
    source: 'gps',
    gpsValid: true,
    satellites: 7,
  };

  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-08-17T09:00:00Z'),
    at,
    {
      ...transition('geofence_exit'),
      transitionEvidence: evidence,
    }
  );

  assert.deepEqual(state.currentJourney.events[0].evidence, evidence);
  assert.deepEqual(state.currentJourney.departureEvidence, evidence);
});

test('completed journey explains approximate positioning outcomes', () => {
  const state = emptyState();
  const start = new Date('2026-08-19T14:00:00Z');
  trackJourneyPoint(state, movingPoint(0, start.toISOString()), start);

  const { noteJourneyObservation } = require('../src/journey-builder');
  noteJourneyObservation(state, 'approximatePacketsReceived');
  noteJourneyObservation(state, 'approximateResolved');

  trackJourneyPoint(
    state,
    {
      lat: -20.263,
      lng: 57.48,
      source: 'wifi',
      accuracySource: 'wifi',
      gpsValid: false,
      recordedAt: new Date('2026-08-19T14:01:00Z'),
    },
    new Date('2026-08-19T14:01:00Z')
  );

  noteJourneyObservation(state, 'approximatePacketsReceived');
  noteJourneyObservation(state, 'approximateResolved');
  trackJourneyPoint(
    state,
    {
      lat: -20.1,
      lng: 57.9,
      source: 'lbs',
      accuracySource: 'lbs',
      gpsValid: false,
      recordedAt: new Date('2026-08-19T14:01:30Z'),
    },
    new Date('2026-08-19T14:01:30Z')
  );

  const doc = closeJourney(state, new Date('2026-08-19T14:02:00Z'), 'manual');
  assert.deepEqual(doc.observationAudit, {
    approximatePacketsReceived: 2,
    approximateResolved: 2,
    approximateResolutionFailed: 0,
    approximateAccepted: 1,
    approximateRejected: 1,
  });
  assert.equal(doc.routeCoverage.approximatePointCount, 1);
});

test('completed journey retains bounded timestamped diagnostic evidence', () => {
  const state = emptyState();
  const start = new Date('2026-08-19T14:00:00Z');
  trackJourneyPoint(state, movingPoint(0, start.toISOString()), start);

  const { noteJourneyDiagnosticEvent } = require('../src/journey-builder');
  noteJourneyDiagnosticEvent(
    state,
    'heartbeat_received',
    new Date('2026-08-19T14:01:00Z'),
    { batteryPercent: 61 }
  );
  trackJourneyPoint(
    state,
    movingPoint(0.002, '2026-08-19T14:02:00Z'),
    new Date('2026-08-19T14:02:00Z')
  );

  const doc = closeJourney(state, new Date('2026-08-19T14:03:00Z'), 'manual');
  assert.deepEqual(doc.diagnosticEvents, [
    {
      type: 'heartbeat_received',
      offsetMs: 60_000,
      details: { batteryPercent: 61 },
    },
  ]);
});
