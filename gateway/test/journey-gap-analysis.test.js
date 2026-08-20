'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeJourneyGaps } = require('../src/journey-gap-analysis');

function journey(events = []) {
  return {
    routeGaps: [
      { fromOffsetMs: 60_000, toOffsetMs: 660_000, durationSeconds: 600 },
    ],
    diagnosticEvents: events,
  };
}

test('disconnect inside a gap identifies transport loss', () => {
  const [gap] = analyzeJourneyGaps(
    journey([{ type: 'tcp_disconnected', offsetMs: 120_000 }])
  );
  assert.equal(gap.cause, 'transport_disconnect');
  assert.equal(gap.confidence, 'high');
});

test('heartbeats without locations identify GPS or reporting failure', () => {
  const [gap] = analyzeJourneyGaps(
    journey([
      { type: 'heartbeat_received', offsetMs: 120_000 },
      { type: 'heartbeat_received', offsetMs: 180_000 },
    ])
  );
  assert.equal(gap.cause, 'location_reporting_or_gps');
  assert.match(gap.explanation, /2 heartbeats/);
});

test('failed V fallback is identified separately', () => {
  const [gap] = analyzeJourneyGaps(
    journey([
      { type: 'approximate_packet_received', offsetMs: 120_000 },
      { type: 'approximate_resolution_failed', offsetMs: 121_000 },
    ])
  );
  assert.equal(gap.cause, 'fallback_resolution_failed');
});

test('legacy journey is explicitly inconclusive', () => {
  const [gap] = analyzeJourneyGaps(journey());
  assert.equal(gap.cause, 'insufficient_telemetry');
  assert.equal(gap.confidence, 'none');
});
