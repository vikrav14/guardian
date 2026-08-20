const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectStops,
  deriveJourneyStructure,
} = require('../src/journey-structure');

function p(lat, lng, at, speedKmh) {
  return {
    lat,
    lng,
    speedKmh,
    recordedAt: new Date(at),
  };
}

test('route with no meaningful stop produces one leg', () => {
  const points = [
    p(-20.2642, 57.4791, '2026-08-11T10:00:00Z', 12),
    p(-20.2600, 57.4800, '2026-08-11T10:05:00Z', 18),
    p(-20.2550, 57.4810, '2026-08-11T10:10:00Z', 16),
  ];

  const result = deriveJourneyStructure(points);

  assert.equal(result.stopCount, 0);
  assert.equal(result.legCount, 1);
  assert.ok(result.legs[0].distanceKm > 0);
});

test('eight-minute stationary cluster becomes one factual stop and two legs', () => {
  const points = [
    p(-20.2642, 57.4791, '2026-08-11T10:00:00Z', 12),
    p(-20.2580, 57.4820, '2026-08-11T10:05:00Z', 16),
    p(-20.2550, 57.4840, '2026-08-11T10:08:00Z', 0),
    p(-20.25505, 57.48402, '2026-08-11T10:12:00Z', 0),
    p(-20.25503, 57.48401, '2026-08-11T10:16:00Z', 0),
    p(-20.2580, 57.4820, '2026-08-11T10:20:00Z', 14),
    p(-20.2641, 57.4791, '2026-08-11T10:28:00Z', 5),
  ];

  const result = deriveJourneyStructure(points);

  assert.equal(result.stopCount, 1);
  assert.equal(result.legCount, 2);
  assert.equal(result.stops[0].durationMinutes, 8);
  assert.equal(result.stops[0].placeName, null);
  assert.equal(result.stops[0].source, 'gps_dwell');
  assert.equal(result.legs[0].toStopId, 'stop_1');
  assert.equal(result.legs[1].fromStopId, 'stop_1');
});

test('short two-minute pause is not promoted to a stop', () => {
  const points = [
    p(-20.2642, 57.4791, '2026-08-11T11:00:00Z', 12),
    p(-20.2550, 57.4840, '2026-08-11T11:05:00Z', 0),
    p(-20.25502, 57.48401, '2026-08-11T11:07:00Z', 0),
    p(-20.2500, 57.4900, '2026-08-11T11:10:00Z', 15),
  ];

  assert.equal(detectStops(points).length, 0);
});

test('two stationary clusters produce two stops and three movement legs', () => {
  const points = [
    p(-20.2642, 57.4791, '2026-08-11T12:00:00Z', 10),
    p(-20.2580, 57.4820, '2026-08-11T12:05:00Z', 0),
    p(-20.25802, 57.48201, '2026-08-11T12:09:00Z', 0),
    p(-20.2500, 57.4900, '2026-08-11T12:15:00Z', 15),
    p(-20.2450, 57.4950, '2026-08-11T12:20:00Z', 0),
    p(-20.24503, 57.49501, '2026-08-11T12:25:00Z', 0),
    p(-20.2641, 57.4791, '2026-08-11T12:35:00Z', 12),
  ];

  const result = deriveJourneyStructure(points);

  assert.equal(result.stopCount, 2);
  assert.equal(result.legCount, 3);
});

test('stop radius can be tuned independently from trip identity', () => {
  const points = [
    p(-20.2642, 57.4791, '2026-08-11T13:00:00Z', 10),
    p(-20.2550, 57.4840, '2026-08-11T13:05:00Z', 0),
    p(-20.2544, 57.4840, '2026-08-11T13:10:00Z', 0),
    p(-20.2500, 57.4900, '2026-08-11T13:15:00Z', 12),
  ];

  assert.equal(detectStops(points, { radiusMetres: 80 }).length, 1);
  assert.equal(detectStops(points, { radiusMetres: 40 }).length, 0);
});
