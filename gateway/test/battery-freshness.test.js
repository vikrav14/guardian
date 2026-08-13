const test = require('node:test');
const assert = require('node:assert/strict');

const {
  batteryFreshness,
  formatBatteryReply,
} = require('../src/battery-freshness');

const NOW = new Date('2026-08-13T20:00:00.000Z');

test('fresh battery reading uses the battery timestamp and recent heartbeat', () => {
  const result = batteryFreshness({
    batteryUpdatedAt: new Date('2026-08-13T19:58:00.000Z'),
    lastHeartbeatAt: new Date('2026-08-13T19:59:00.000Z'),
  }, { now: NOW });
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.ageMinutes, 2);
  assert.equal(result.online, true);
  assert.equal(result.stale, false);
});

test('stale reading and stale heartbeat are not presented as current', () => {
  const result = batteryFreshness({
    lastHeartbeatAt: new Date('2026-08-13T17:00:00.000Z'),
  }, { now: NOW });
  assert.equal(result.freshness, 'stale');
  assert.equal(result.online, false);
  assert.equal(result.stale, true);
});

test('batteryUpdatedAt is preferred over a newer generic heartbeat', () => {
  const result = batteryFreshness({
    batteryUpdatedAt: new Date('2026-08-13T18:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-08-13T19:59:00.000Z'),
  }, { now: NOW });
  assert.equal(result.ageMinutes, 120);
  assert.equal(result.stale, true);
  assert.equal(result.online, true);
});

test('fresh deterministic reply includes percentage and age', () => {
  const reply = formatBatteryReply({
    name: 'Jesh',
    batteryPercent: 76,
    ageSeconds: 120,
    stale: false,
    online: true,
  });
  assert.equal(reply, "Jesh's watch last reported 76% battery 2 minutes ago.");
});

test('stale offline reply carries an explicit warning', () => {
  const reply = formatBatteryReply({
    name: 'Jesh',
    batteryPercent: 14,
    ageSeconds: 3 * 60 * 60,
    stale: true,
    online: false,
  });
  assert.match(reply, /last reported 14% battery 3 hours ago/i);
  assert.match(reply, /offline/i);
  assert.match(reply, /may have changed/i);
});

test('missing battery is never invented', () => {
  const reply = formatBatteryReply({ name: 'Jesh', batteryPercent: null });
  assert.equal(reply, "I don't have a battery reading for Jesh's watch yet.");
  assert.doesNotMatch(reply, /\d+%/);
});
