const test = require('node:test');
const assert = require('node:assert/strict');

const {
  asDate,
  formatDuration,
  inferStartTrigger,
  analyzeJourney,
  formatJourneyDiagnostic,
} = require('../src/journey-diagnostics');

test('asDate accepts Date, ISO string and Firestore-style timestamp', () => {
  const iso = '2026-08-11T10:00:00.000Z';
  const expected = Date.parse(iso);

  assert.equal(asDate(new Date(iso)).getTime(), expected);
  assert.equal(asDate(iso).getTime(), expected);
  assert.equal(
    asDate({ seconds: expected / 1000, nanoseconds: 0 }).getTime(),
    expected
  );
  assert.equal(
    asDate({ toDate: () => new Date(iso) }).getTime(),
    expected
  );
});

test('formatDuration gives compact human readable duration', () => {
  assert.equal(formatDuration(8 * 60_000), '8m');
  assert.equal(formatDuration((16 * 60 + 58) * 60_000), '16h 58m');
});

test('geofence exit is reported as authoritative journey start', () => {
  const trigger = inferStartTrigger({
    originGeofenceName: 'Home',
    events: [
      {
        type: 'geofence_exit',
        name: 'Home',
        at: new Date('2026-08-11T10:00:00Z'),
      },
    ],
  });

  assert.equal(trigger.type, 'geofence_exit');
  assert.match(trigger.label, /Home/);
});

test('legacy journey without exit event is identified as generic movement start', () => {
  const trigger = inferStartTrigger({ events: [] });
  assert.equal(trigger.type, 'generic_movement');
});

test('17-hour 0.5km sparse journey is flagged as likely stationary drift', () => {
  const analysis = analyzeJourney({
    id: 'false-trip',
    startAt: new Date('2026-08-11T03:03:00Z'),
    endAt: new Date('2026-08-11T20:01:00Z'),
    distanceKm: 0.5,
    pointCount: 14,
    events: [],
    closeReason: 'idle',
  });

  assert.equal(analysis.assessment, 'likely_stationary_drift');
  assert.ok(analysis.reasons.length >= 2);
  assert.equal(analysis.startTrigger.type, 'generic_movement');
});

test('normal Home round trip is assessed as OK', () => {
  const analysis = analyzeJourney({
    id: 'good-trip',
    startAt: new Date('2026-08-12T06:00:00Z'),
    endAt: new Date('2026-08-12T06:35:00Z'),
    distanceKm: 4.2,
    pointCount: 24,
    originGeofenceId: 'home-id',
    originGeofenceName: 'Home',
    closeReason: 'return_to_origin',
    stopCount: 1,
    legCount: 2,
    stops: [{ durationMinutes: 8 }],
    events: [
      {
        type: 'geofence_exit',
        name: 'Home',
        at: new Date('2026-08-12T06:00:00Z'),
      },
      {
        type: 'geofence_enter',
        name: 'Home',
        at: new Date('2026-08-12T06:33:00Z'),
      },
      {
        type: 'outing_return',
        name: 'Home',
        at: new Date('2026-08-12T06:33:00Z'),
        confirmedAt: new Date('2026-08-12T06:35:00Z'),
      },
    ],
  });

  assert.equal(analysis.assessment, 'ok');
  assert.equal(analysis.stopCount, 1);
  assert.equal(analysis.legCount, 2);
  assert.equal(analysis.closeLabel, 'Confirmed return to Home');
});

test('formatted diagnostic includes the core evidence fields', () => {
  const output = formatJourneyDiagnostic(
    {
      id: 'journey_1',
      startAt: new Date('2026-08-12T06:00:00Z'),
      endAt: new Date('2026-08-12T06:30:00Z'),
      distanceKm: 3,
      pointCount: 20,
      closeReason: 'return_to_origin',
      originGeofenceName: 'Home',
      originGeofenceId: 'home-id',
      stopCount: 1,
      legCount: 2,
      stops: [{ durationMinutes: 5 }],
      events: [
        {
          type: 'geofence_exit',
          name: 'Home',
          at: new Date('2026-08-12T06:00:00Z'),
        },
      ],
    },
    { timeZone: 'UTC' }
  );

  assert.match(output, /Started by: Safe-zone exit: Home/);
  assert.match(output, /Closed by:\s+Confirmed return to Home/);
  assert.match(output, /1 \(5m total\) stop\(s\) · 2 leg\(s\)/);
  assert.match(output, /Assessment: OK/);
});
