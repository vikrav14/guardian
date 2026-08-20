'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerSession,
  unregisterSession,
  getSession,
  noteSessionPacket,
  noteDeviceLocation,
  setDeviceReportingContext,
  idleTimeoutMsForInterval,
  handleIdleTimeout,
  handleLocationStale,
} = require('../src/sessions');

function fakeSocket() {
  return {
    destroyed: false,
    keepAlive: null,
    destroy() {
      this.destroyed = true;
    },
    setKeepAlive(enabled, delayMs) {
      this.keepAlive = { enabled, delayMs };
    },
  };
}

test('idle timeout follows the applied watch interval', () => {
  assert.equal(idleTimeoutMsForInterval(60, 12), 180_000);
  assert.equal(idleTimeoutMsForInterval(300, 12), 660_000);
  assert.equal(idleTimeoutMsForInterval(600, 12), 1_260_000);
  assert.equal(idleTimeoutMsForInterval(900, 12), 1_860_000);
  assert.equal(idleTimeoutMsForInterval(null, 12), 720_000);
});

test('session enables TCP keepalive', (t) => {
  const socket = fakeSocket();
  t.after(() => unregisterSession(socket));
  registerSession(socket);
  assert.equal(socket.keepAlive.enabled, true);
  assert.ok(socket.keepAlive.delayMs >= 10_000);
});

test('packet silence probes once before destroying the socket', (t) => {
  const socket = fakeSocket();
  let probes = 0;
  t.after(() => unregisterSession(socket));
  registerSession(socket, {
    imei: '861397052547492',
    protocolId: '9705254749',
    onRecoveryProbe: ({ reason }) => {
      probes += 1;
      assert.equal(reason, 'packet_silence');
      return { ok: true };
    },
  });

  const first = handleIdleTimeout(socket);
  assert.equal(first.action, 'probe');
  assert.equal(probes, 1);
  assert.equal(socket.destroyed, false);

  const second = handleIdleTimeout(socket);
  assert.equal(second.action, 'destroy');
  assert.equal(probes, 1);
  assert.equal(socket.destroyed, true);
});

test('a packet after recovery clears the pending destroy path', (t) => {
  const socket = fakeSocket();
  let probes = 0;
  t.after(() => unregisterSession(socket));
  registerSession(socket, {
    imei: '861397052547492',
    onRecoveryProbe: () => {
      probes += 1;
      return true;
    },
  });

  handleIdleTimeout(socket);
  assert.equal(noteSessionPacket(socket), true);
  const next = handleIdleTimeout(socket);
  assert.equal(next.action, 'probe');
  assert.equal(probes, 2);
  assert.equal(socket.destroyed, false);
});

test('outing context requests CR when location becomes stale but keeps TCP open', (t) => {
  const socket = fakeSocket();
  const reasons = [];
  t.after(() => unregisterSession(socket));
  registerSession(socket, {
    imei: '861397052547492',
    onRecoveryProbe: ({ reason }) => {
      reasons.push(reason);
      return { ok: true };
    },
  });

  assert.equal(
    setDeviceReportingContext('861397052547492', {
      expectedReportingIntervalSeconds: 60,
      outingActive: true,
    }),
    1,
  );
  assert.equal(getSession(socket).expectedReportingIntervalSeconds, 60);
  assert.equal(getSession(socket).outingActive, true);

  const result = handleLocationStale(socket);
  assert.equal(result.action, 'probe');
  assert.deepEqual(reasons, ['location_stale']);
  assert.equal(socket.destroyed, false);

  assert.equal(noteDeviceLocation('861397052547492'), 1);
  setDeviceReportingContext('861397052547492', {
    expectedReportingIntervalSeconds: 300,
    outingActive: false,
  });
  assert.equal(getSession(socket).outingActive, false);
});

test('one stale-location CR also covers packet recovery without duplicate probing', (t) => {
  const socket = fakeSocket();
  let probes = 0;
  t.after(() => unregisterSession(socket));
  registerSession(socket, {
    imei: '861397052547492',
    onRecoveryProbe: () => {
      probes += 1;
      return { ok: true };
    },
  });
  setDeviceReportingContext('861397052547492', {
    expectedReportingIntervalSeconds: 60,
    outingActive: true,
  });
  getSession(socket).lastPacketAt = Date.now() - 180_000;

  assert.equal(handleLocationStale(socket).action, 'probe');
  assert.ok(getSession(socket).packetRecoveryProbeAt);
  assert.equal(probes, 1);

  assert.equal(handleIdleTimeout(socket).action, 'destroy');
  assert.equal(probes, 1);
});
