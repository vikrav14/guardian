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

  const acceptedImeis = String(env.SAFETY_SNAPSHOT_ACCEPTED_IMEIS || '')
    .split(',').map(value => value.trim()).filter(value => /^\d{15}$/.test(value));
  const bucketName = String(env.FIREBASE_STORAGE_BUCKET || '').trim();
  const deviceDispatchAllowed = requestsEnabled && customerEnabled && mediaIngressEnabled &&
    deviceMode === 'accepted' && acceptedImeis.length > 0 && /^[a-z0-9][a-z0-9._-]+$/.test(bucketName);
  return Object.freeze({
    requestsEnabled,
    customerEnabled,
    mediaIngressEnabled,
    deviceMode,
    requestWatcherEnabled: false,
    deviceDispatchAllowed,
    acceptedImeis: Object.freeze(acceptedImeis),
    bucketName,
    mediaIngressAllowed: deviceDispatchAllowed,
  });
}

module.exports = {
  asBool,
  readSafetySnapshotRuntime,
};
