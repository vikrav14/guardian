'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SYNC_STATE,
  buildCareReminderSchedule,
  isWithinQuietHours,
  evaluateWatchSync,
  recordDeliveryEvidence,
} = require('../src/care-reminder-policy');

const base = {
  imei: '861397012345670',
  kind: 'routine',
  label: 'Evening tablets',
  localTime: '20:30',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  quietHours: { start: '22:00', end: '06:00' },
};

test('canonical reminder is backend-owned and never invents acknowledgement', () => {
  const schedule = buildCareReminderSchedule(base, { now: new Date('2026-08-23T12:00:00Z') });
  assert.equal(schedule.syncState, SYNC_STATE.BLOCKED_UNVERIFIED);
  assert.equal(schedule.deviceCommand, null);
  assert.equal(schedule.acknowledgementSupported, false);
  assert.equal(schedule.acknowledgementState, 'unavailable');
  assert.equal(schedule.timezone, 'Indian/Mauritius');
});

test('invalid clock, weekday and identifier values fail closed', () => {
  assert.throws(() => buildCareReminderSchedule({ ...base, localTime: '25:00' }), /HH:MM/);
  assert.throws(() => buildCareReminderSchedule({ ...base, weekdays: [0, 8] }), /1-7/);
  assert.throws(() => buildCareReminderSchedule({ ...base, imei: '123' }), /15-digit/);
});

test('quiet hours correctly handle same-day and overnight windows', () => {
  assert.equal(isWithinQuietHours('22:30', { start: '22:00', end: '06:00' }), true);
  assert.equal(isWithinQuietHours('05:59', { start: '22:00', end: '06:00' }), true);
  assert.equal(isWithinQuietHours('12:00', { start: '22:00', end: '06:00' }), false);
  assert.equal(isWithinQuietHours('13:00', { start: '12:00', end: '14:00' }), true);
});

test('feature disabled and unverified protocol both block watch sync', () => {
  const schedule = buildCareReminderSchedule(base);
  const disabled = evaluateWatchSync(schedule, {
    featureEnabled: false,
    deviceMode: 'accepted',
    acceptedProtocol: true,
  });
  assert.deepEqual(disabled, {
    allowed: false,
    state: SYNC_STATE.BACKEND_ONLY,
    reason: 'feature_disabled',
  });

  const unverified = evaluateWatchSync(schedule, {
    featureEnabled: true,
    deviceMode: 'unverified',
    acceptedProtocol: false,
  });
  assert.deepEqual(unverified, {
    allowed: false,
    state: SYNC_STATE.BLOCKED_UNVERIFIED,
    reason: 'protocol_unverified',
  });
});

test('delivery evidence never becomes wearer acknowledgement', () => {
  const schedule = buildCareReminderSchedule(base);
  const delivered = recordDeliveryEvidence(schedule, {
    transportAccepted: true,
    at: new Date('2026-08-23T13:00:00Z'),
  });
  assert.equal(delivered.syncState, SYNC_STATE.SENT);
  assert.equal(delivered.acknowledgementSupported, false);
  assert.equal(delivered.acknowledgementState, 'unavailable');
});
