const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateJourneyTruth,
  summarizeJourney,
} = require('../scripts/inspect-journey-truth');

function confirmedJourney(overrides = {}) {
  return {
    startAt: new Date('2026-08-17T08:10:00Z'),
    endAt: new Date('2026-08-17T08:43:00Z'),
    departureAt: new Date('2026-08-17T08:11:00Z'),
    returnAt: new Date('2026-08-17T08:43:00Z'),
    distanceKm: 4.2,
    pointCount: 3,
    evidenceVersion: 3,
    pointEvidence: [{ offsetMs: 0 }, { offsetMs: 60_000 }, { offsetMs: 1_980_000 }],
    closeReason: 'return_to_origin',
    originGeofenceName: 'Home',
    departureEvidence: { classification: 'outside', source: 'gps' },
    routeStartAnchored: true,
    routeStartEvidence: { recordedAt: new Date('2026-08-17T08:10:00Z') },
    returnEvidence: { classification: 'inside', source: 'gps' },
    routeCoverage: { gpsPointCount: 3, approximatePointCount: 0 },
    routeGaps: [],
    routeSegments: [{ pointCount: 3 }],
    ...overrides,
  };
}

test('acceptance passes one evidence-backed confirmed outing with no gaps', () => {
  const journey = summarizeJourney('truth', confirmedJourney());
  const decision = evaluateJourneyTruth([journey]);

  assert.equal(journey.authoritative, true);
  assert.equal(journey.durationMinutes, 32);
  assert.equal(journey.routeStartAnchored, true);
  assert.equal(decision.releaseReady, true);
  assert.deepEqual(decision.failureReasons, []);
});

test('acceptance fails the old WiFi ghost record', () => {
  const ghost = summarizeJourney('legacy-ghost', {
    startAt: new Date('2026-08-17T08:10:00Z'),
    endAt: new Date('2026-08-17T08:13:58Z'),
    distanceKm: 2.1,
    pointCount: 11,
    closeReason: 'return_to_origin',
    originGeofenceName: 'Home',
  });
  const decision = evaluateJourneyTruth([ghost]);

  assert.equal(ghost.authoritative, false);
  assert.equal(decision.releaseReady, false);
  assert.ok(decision.failureReasons.some((reason) => reason.includes('v3')));
});

test('acceptance fails a concrete tracking gap and reports its times', () => {
  const gap = summarizeJourney(
    'gap',
    confirmedJourney({
      routeGaps: [
        {
          fromPointIndex: 1,
          toPointIndex: 2,
          fromOffsetMs: 6 * 60 * 1000,
          toOffsetMs: 33 * 60 * 1000,
          durationSeconds: 27 * 60,
        },
      ],
      routeSegments: [{ pointCount: 2 }, { pointCount: 1 }],
    })
  );
  const decision = evaluateJourneyTruth([gap]);

  assert.equal(decision.releaseReady, false);
  assert.equal(decision.totalTrackingGaps, 1);
  assert.equal(gap.trackingGaps[0].stoppedAt, '2026-08-17T08:16:00.000Z');
  assert.equal(gap.trackingGaps[0].resumedAt, '2026-08-17T08:43:00.000Z');
});

test('acceptance fails a confirmed outing whose route starts outside Home', () => {
  const partial = summarizeJourney(
    'outside-start',
    confirmedJourney({
      evidenceVersion: 3,
      routeStartAnchored: false,
      routeStartEvidence: null,
    })
  );
  const decision = evaluateJourneyTruth([partial]);

  assert.equal(partial.boundaryConfirmed, true);
  assert.equal(partial.authoritative, false);
  assert.equal(decision.releaseReady, false);
  assert.ok(
    decision.failureReasons.some((reason) => reason.includes('inside-Home'))
  );
});
