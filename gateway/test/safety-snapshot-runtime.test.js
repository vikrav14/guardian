const test = require('node:test');
const assert = require('node:assert/strict');

const { readSafetySnapshotRuntime } = require('../src/safety-snapshot-runtime');

test('Safety snapshot runtime is fully default-off', () => {
  const runtime = readSafetySnapshotRuntime({});
  assert.equal(runtime.requestsEnabled, false);
  assert.equal(runtime.customerEnabled, false);
  assert.equal(runtime.mediaIngressEnabled, false);
  assert.equal(runtime.deviceMode, 'unverified');
  assert.equal(runtime.requestWatcherEnabled, false);
  assert.equal(runtime.deviceDispatchAllowed, false);
  assert.equal(runtime.mediaIngressAllowed, false);
});

test('accepted device mode alone cannot enable capture or request processing', () => {
  const runtime = readSafetySnapshotRuntime({
    SAFETY_SNAPSHOT_DEVICE_MODE: 'accepted',
  });
  assert.equal(runtime.requestWatcherEnabled, false);
  assert.equal(runtime.deviceDispatchAllowed, false);
  assert.equal(runtime.mediaIngressAllowed, false);
});

test('media ingress requires its explicit gate and accepted mode but dispatch remains impossible', () => {
  const runtime = readSafetySnapshotRuntime({
    SAFETY_SNAPSHOT_REQUESTS_ENABLED: 'true',
    SAFETY_SNAPSHOT_MEDIA_INGRESS_ENABLED: 'true',
    SAFETY_SNAPSHOT_DEVICE_MODE: 'accepted',
  });
  assert.equal(runtime.requestWatcherEnabled, true);
  assert.equal(runtime.mediaIngressAllowed, true);
  assert.equal(runtime.deviceDispatchAllowed, false);
});
