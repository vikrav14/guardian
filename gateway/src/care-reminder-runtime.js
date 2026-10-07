'use strict';

function envTrue(name) {
  return String(process.env[name] || 'false').trim().toLowerCase() === 'true';
}

function normalizeDeviceMode(value) {
  const mode = String(value || 'unverified').trim().toLowerCase();
  return ['unverified', 'accepted'].includes(mode) ? mode : 'unverified';
}

function loadCareReminderRuntime(env = process.env) {
  const requestsEnabled = String(env.CARE_REMINDERS_REQUESTS_ENABLED || 'false').toLowerCase() === 'true';
  const customerEnabled = String(env.CARE_REMINDERS_CUSTOMER_ENABLED || 'false').toLowerCase() === 'true';
  const deviceMode = normalizeDeviceMode(env.CARE_REMINDERS_DEVICE_MODE);

  return Object.freeze({
    requestsEnabled,
    customerEnabled,
    deviceMode,
    deviceDispatchAccepted: deviceMode === 'accepted',
  });
}

const careReminderRuntime = loadCareReminderRuntime();

module.exports = {
  envTrue,
  normalizeDeviceMode,
  loadCareReminderRuntime,
  careReminderRuntime,
};
