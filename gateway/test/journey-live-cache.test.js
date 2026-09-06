const test = require('node:test');
const assert = require('node:assert/strict');

const {
  onDeviceConnect,
  onDeviceDisconnect,
  trackPointForJourney,
  flushJourneyIfNeeded,
  isJourneyActive,
  resetCacheForTests,
} = require('../src/live-cache');

test.beforeEach(() => {
  resetCacheForTests();
});

test('TCP disconnect and reconnect preserve the active outing', () => {
  const imei = 'OUTING-RECONNECT-1';
  const start = new Date('2026-08-11T08:00:00Z');

  const started = trackPointForJourney(
    imei,
    {
      lat: -20.16196,
      lng: 57.64834,
      source: 'gps', gpsValid: true,
      speedKmh: 12,
      recordedAt: start,
    },
    start
  );

  assert.equal(started.started, true);
  assert.equal(started.flushes.length, 0);
  assert.equal(isJourneyActive(imei), true);

  const disconnectAt = new Date('2026-08-11T08:01:00Z');

  assert.equal(
    flushJourneyIfNeeded(imei, disconnectAt, true),
    null
  );

  onDeviceDisconnect(imei);

  assert.equal(isJourneyActive(imei), true);

  onDeviceConnect(imei);

  const reconnectAt = new Date('2026-08-11T08:02:00Z');

  const continued = trackPointForJourney(
    imei,
    {
      lat: -20.16050,
      lng: 57.64750,
      source: 'gps', gpsValid: true,
      speedKmh: 10,
      recordedAt: reconnectAt,
    },
    reconnectAt
  );

  assert.equal(continued.started, false);
  assert.equal(continued.flushes.length, 0);
  assert.equal(isJourneyActive(imei), true);
});