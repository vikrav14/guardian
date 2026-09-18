'use strict';

function asBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function readSafetySnapshotRuntime(env = process.env) {
  const requestsEnabled = asBool(env.SAFETY_SNAPSHOT_REQUESTS_ENABLED, false);
  const customerEnabled = asBool(env.SAFETY_SNAPSHOT_CUSTOMER_ENABLED, false);
  const mediaIngressEnabled = asBool(env.SAFETY_SNAPSHOT_MEDIA_INGRESS_ENABLED, false);
  const deviceMode = String(env.SAFETY_SNAPSHOT_DEVICE_MODE || 'unverified')
    .trim()
    .toLowerCase();

  return Object.freeze({
    requestsEnabled,
    customerEnabled,
    mediaIngressEnabled,
    deviceMode,
    requestWatcherEnabled: requestsEnabled,
    deviceDispatchAllowed: false,
    mediaIngressAllowed: mediaIngressEnabled && deviceMode === 'accepted',
  });
}

module.exports = {
  asBool,
  readSafetySnapshotRuntime,
};
