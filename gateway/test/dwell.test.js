const test = require('node:test');
const assert = require('node:assert/strict');
const { trackDwellPoint, flushDwellSegment, isStationary } = require('../src/dwell');

function emptyState() {
  return { currentDwell: null, lastPersistedLocation: null };
}

test('isStationary treats low speed as stationary', () => {
  assert.equal(isStationary({ lat: 0, lng: 0, speedKmh: 0.5 }, null), true);
  assert.equal(isStationary({ lat: 0, lng: 0, speedKmh: 5 }, null), false);
});

test('15 min same spot produces one dwell segment', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T12:00:00Z');
  const point = { lat: -20.2642, lng: 57.4791, speedKmh: 0 };

  trackDwellPoint(state, point, start);
  trackDwellPoint(state, point, new Date('2026-07-22T12:05:00Z'));
  trackDwellPoint(state, point, new Date('2026-07-22T12:10:00Z'));

  assert.ok(state.currentDwell);
  assert.equal(state.currentDwell.type, 'dwell');

  const end = new Date('2026-07-22T12:15:00Z');
  const segment = flushDwellSegment(state, end);
  assert.ok(segment);
  assert.equal(segment.type, 'dwell');
  assert.equal(segment.centerLat, point.lat);
  assert.equal(segment.centerLng, point.lng);
  assert.equal(state.currentDwell, null);
});

test('flushDwellSegment returns null before dwell minimum', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T12:00:00Z');
  trackDwellPoint(state, { lat: 1, lng: 2, speedKmh: 0 }, start);

  const segment = flushDwellSegment(state, new Date('2026-07-22T12:05:00Z'));
  assert.equal(segment, null);
  assert.ok(state.currentDwell);
});

test('flushDwellSegment force ends short dwell', () => {
  const state = emptyState();
  const start = new Date('2026-07-22T12:00:00Z');
  trackDwellPoint(state, { lat: 1, lng: 2, speedKmh: 0 }, start);

  const segment = flushDwellSegment(state, new Date('2026-07-22T12:05:00Z'), true);
  assert.ok(segment);
  assert.equal(state.currentDwell, null);
});
