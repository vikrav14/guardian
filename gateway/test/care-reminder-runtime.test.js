'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDeviceMode,
  loadCareReminderRuntime,
} = require('../src/care-reminder-runtime');

test('care reminder runtime is fail-closed by default', () => {
  const runtime = loadCareReminderRuntime({});
  assert.deepEqual(runtime, {
    requestsEnabled: false,
    customerEnabled: false,
    deviceMode: 'unverified',
    deviceDispatchAccepted: false,
  });
});

test('unknown device mode falls back to unverified', () => {
  assert.equal(normalizeDeviceMode('experimental'), 'unverified');
  assert.equal(loadCareReminderRuntime({ CARE_REMINDERS_DEVICE_MODE: 'experimental' }).deviceDispatchAccepted, false);
});

test('accepted device mode never enables requests or customers by itself', () => {
  const runtime = loadCareReminderRuntime({ CARE_REMINDERS_DEVICE_MODE: 'accepted' });
  assert.equal(runtime.deviceMode, 'accepted');
  assert.equal(runtime.deviceDispatchAccepted, true);
  assert.equal(runtime.requestsEnabled, false);
  assert.equal(runtime.customerEnabled, false);
});

test('request and customer gates require explicit true values', () => {
  const runtime = loadCareReminderRuntime({
    CARE_REMINDERS_REQUESTS_ENABLED: 'true',
    CARE_REMINDERS_CUSTOMER_ENABLED: 'TRUE',
  });
  assert.equal(runtime.requestsEnabled, true);
  assert.equal(runtime.customerEnabled, true);
  assert.equal(runtime.deviceDispatchAccepted, false);
});
