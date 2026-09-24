const test = require('node:test');
const assert = require('node:assert/strict');
const { readSafetySnapshotRuntime } = require('../src/safety-snapshot-runtime');
const enabled = {
  SAFETY_SNAPSHOT_REQUESTS_ENABLED: 'true', SAFETY_SNAPSHOT_CUSTOMER_ENABLED: 'true',
  SAFETY_SNAPSHOT_MEDIA_INGRESS_ENABLED: 'true', SAFETY_SNAPSHOT_DEVICE_MODE: 'accepted',
  SAFETY_SNAPSHOT_ACCEPTED_IMEIS: '861397052547492', FIREBASE_STORAGE_BUCKET: 'example.firebasestorage.app',
};
test('capture is default-off; the legacy request watcher never dispatches', () => {
  const config = readSafetySnapshotRuntime({});
  assert.equal(config.deviceDispatchAllowed, false);
  assert.equal(config.mediaIngressAllowed, false);
  assert.equal(config.requestWatcherEnabled, false);
});
test('all gates, a valid device allowlist and explicit private bucket are required', () => {
  assert.equal(readSafetySnapshotRuntime(enabled).deviceDispatchAllowed, true);
  for (const key of Object.keys(enabled)) {
    assert.equal(readSafetySnapshotRuntime({ ...enabled, [key]: '' }).deviceDispatchAllowed, false, key);
  }
  assert.equal(readSafetySnapshotRuntime({ ...enabled, SAFETY_SNAPSHOT_ACCEPTED_IMEIS: '*' }).deviceDispatchAllowed, false);
  assert.equal(readSafetySnapshotRuntime({ ...enabled, FIREBASE_STORAGE_BUCKET: 'https://bucket.example' }).deviceDispatchAllowed, false);
});
