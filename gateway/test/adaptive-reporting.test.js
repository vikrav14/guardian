'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  policyForBattery,
  effectivePolicy,
  shouldSend,
} = require('../src/adaptive-reporting');

test('battery policy uses 1m/5m/10m/15m bands', () => {
  assert.equal(policyForBattery(100).seconds, 60);
  assert.equal(policyForBattery(60).seconds, 60);
  assert.equal(policyForBattery(59).seconds, 300);
  assert.equal(policyForBattery(30).seconds, 300);
  assert.equal(policyForBattery(29).seconds, 600);
  assert.equal(policyForBattery(15).seconds, 600);
  assert.equal(policyForBattery(14).seconds, 900);
});

test('SOS overrides battery policy', () => {
  const now = 1_000_000;
  assert.deepEqual(
    effectivePolicy({
      batteryPercent: 80,
      nowMs: now,
      sosActiveUntilMs: now + 1000,
      sosCooldownUntilMs: now + 2000,
    }),
    { seconds: 60, reason: 'sos_emergency_override' },
  );

  assert.deepEqual(
    effectivePolicy({
      batteryPercent: 8,
      nowMs: now,
      sosActiveUntilMs: now + 1000,
      sosCooldownUntilMs: now + 2000,
    }),
    { seconds: 300, reason: 'sos_critical_battery' },
  );
});

test('SOS cooldown uses 5 minute reporting', () => {
  const now = 1_000_000;
  assert.deepEqual(
    effectivePolicy({
      batteryPercent: 80,
      nowMs: now,
      sosActiveUntilMs: now - 1,
      sosCooldownUntilMs: now + 1000,
    }),
    { seconds: 300, reason: 'sos_cooldown' },
  );
});

test('normal changes respect cooldown but urgent changes bypass it', () => {
  const now = 1_000_000;
  assert.equal(
    shouldSend({
      desiredSeconds: 300,
      lastRequestedSeconds: 60,
      lastCommandAtMs: now - 60_000,
      nowMs: now,
    }),
    false,
  );

  assert.equal(
    shouldSend({
      desiredSeconds: 300,
      lastRequestedSeconds: 60,
      lastCommandAtMs: now - 60_000,
      nowMs: now,
      urgent: true,
    }),
    true,
  );
});
