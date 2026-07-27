const test = require('node:test');
const assert = require('node:assert/strict');
const {
  minutesSinceHeartbeat,
  isHeartbeatStale,
  shouldMarkDeviceOffline,
  shouldReconcileStaleOnline,
} = require('../src/device-presence');

test('shouldMarkDeviceOffline when TCP is gone', () => {
  const now = new Date('2026-07-23T18:00:00Z');
  const device = {
    lastHeartbeatAt: new Date('2026-07-23T17:59:00Z'),
  };

  assert.equal(
    shouldMarkDeviceOffline(device, { tcpConnected: false, staleMinutes: 6, now }),
    true
  );
});

test('shouldMarkDeviceOffline when TCP open but heartbeat is stale', () => {
  const now = new Date('2026-07-23T18:10:00Z');
  const device = {
    lastHeartbeatAt: new Date('2026-07-23T18:00:00Z'),
  };

  assert.equal(minutesSinceHeartbeat(device, now), 10);
  assert.equal(isHeartbeatStale(device, 6, now), true);
  assert.equal(
    shouldMarkDeviceOffline(device, { tcpConnected: true, staleMinutes: 6, now }),
    true
  );
});

test('shouldMarkDeviceOffline keeps live device with recent heartbeat', () => {
  const now = new Date('2026-07-23T18:05:00Z');
  const device = {
    lastHeartbeatAt: new Date('2026-07-23T18:02:00Z'),
  };

  assert.equal(
    shouldMarkDeviceOffline(device, { tcpConnected: true, staleMinutes: 6, now }),
    false
  );
});

test('shouldReconcileStaleOnline ignores missing TCP when heartbeat is fresh', () => {
  const now = new Date('2026-07-23T18:05:00Z');
  const device = {
    lastHeartbeatAt: new Date('2026-07-23T18:04:00Z'),
  };

  assert.equal(
    shouldReconcileStaleOnline(device, { staleMinutes: 3, now }),
    false
  );
});

test('shouldReconcileStaleOnline clears stale heartbeat regardless of TCP', () => {
  const now = new Date('2026-07-23T18:10:00Z');
  const device = {
    lastHeartbeatAt: new Date('2026-07-23T18:00:00Z'),
  };

  assert.equal(
    shouldReconcileStaleOnline(device, { staleMinutes: 3, now }),
    true
  );
});
