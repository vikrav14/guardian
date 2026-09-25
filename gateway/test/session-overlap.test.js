'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const sessions = require('../src/sessions');
const liveCache = require('../src/live-cache');
const connectionLive = require('../src/connection-live');

const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const noop = () => {};
const imei = '861397052547492';

// Exercise the actual TCP close handler, session registry and live cache.
// Network listeners and external writes are replaced at their boundaries.
function gateway(t) {
  let accept;
  const sockets = [];
  const offline = [];
  const flushes = [];
  const diagnostics = [];
  const captures = [];
  const wearDisconnects = [];
  const modules = {
    net: { createServer: callback => {
      accept = callback;
      return { on: noop, listen: noop };
    } },
    './config': { firestoreDisabled: true, wearCaptureEnabled: true, offlineDebounceMs: 15000 },
    './sessions': sessions,
    './connection-live': connectionLive,
    './temperature-trial-quarantine': require('../src/temperature-trial-quarantine'),
    './wear-evidence': { createWearEvidence: () => ({
      disconnect: (device, session) => wearDisconnects.push({ device, session }),
    }) },
    './wear-capture': { startWearCapture: () => ({
      observeSocket: (kind, socket, session) => captures.push({ kind, socket, session }),
    }) },
    './firestore': {
      initFirestore: noop, getDb: () => null, startIntelligenceMonitor: noop,
      appendSegment: async () => {}, appendJourney: async () => {},
    },
    './http': { startHttpServer: noop },
    './safety-snapshot-live': { startSnapshotController: () => null, isPhotoFrame: () => false },
    './device-offline': { scheduleDeviceOffline: device => offline.push(device) },
    './live-cache': {
      ...liveCache,
      noteDiagnosticEventForJourney: (device, kind) => diagnostics.push({ device, kind }),
      flushDwellIfNeeded: (...args) => {
        flushes.push({ kind: 'dwell', device: args[0] });
        return liveCache.flushDwellIfNeeded(...args);
      },
      flushJourneyIfNeeded: (...args) => {
        flushes.push({ kind: 'journey', device: args[0] });
        return liveCache.flushJourneyIfNeeded(...args);
      },
    },
  };
  vm.runInNewContext(source, {
    require: name => modules[name] || {},
    console: { log: noop, warn: noop, error: noop },
    setInterval: () => ({ unref: noop }),
  });
  t.after(() => {
    for (const socket of sockets) sessions.unregisterSession(socket);
    liveCache.resetCacheForTests();
  });

  function connect(device = imei, persistCount = connectionLive.SESSION_LIVE_PACKETS) {
    const socket = Object.assign(new EventEmitter(), {
      remoteAddress: '127.0.0.1', remotePort: 10000 + sockets.length,
      destroyed: false, bytesRead: 0, bytesWritten: 0, setKeepAlive: noop,
    });
    sockets.push(socket);
    accept(socket);
    Object.assign(sessions.getSession(socket), { imei: device, persistCount });
    return socket;
  }
  function close(socket) {
    socket.destroyed = true;
    socket.emit('close', false);
  }
  function seedLive() {
    liveCache.updateLiveState(imei, {
      location: { lat: -20.1, lng: 57.5 }, batteryPercent: 90,
      speedKmh: 0, accuracySource: 'gps',
    });
    liveCache.recordPersist(imei, { location: { lat: -20.1, lng: 57.5 }, batteryPercent: 90 });
    return liveCache.getLiveDeviceState(imei);
  }
  return { connect, close, seedLive, offline, flushes, diagnostics, captures, wearDisconnects };
}

test('closing an older connection preserves the replacement connection and its live data', t => {
  const run = gateway(t);
  const old = run.connect();
  const replacement = run.connect();
  const oldSession = sessions.getSession(old);
  const before = run.seedLive();
  run.close(old);

  assert.deepEqual(liveCache.getLiveDeviceState(imei), before);
  assert.equal(sessions.getSession(old), undefined);
  assert.equal(oldSession.idleTimer, null, 'closed socket timers must still be cleared');
  assert.ok(sessions.getSession(replacement));
  assert.deepEqual(run.offline, []);
  assert.deepEqual(run.flushes, []);
  assert.deepEqual(run.diagnostics, []);
  assert.equal(run.captures[0].kind, 'socket_closed');
  assert.equal(run.captures[0].session, oldSession, 'keep per-socket diagnostics');
  assert.equal(run.wearDisconnects[0].session, oldSession, 'retain session-scoped wear cleanup');
});

test('closing the final connection still clears live data and schedules offline once', t => {
  const run = gateway(t);
  const old = run.connect();
  const replacement = run.connect();
  run.seedLive();
  run.close(old);
  run.close(replacement);

  assert.equal(liveCache.getLiveDeviceState(imei).location, null);
  assert.equal(liveCache.getLiveDeviceState(imei).batteryPercent, null);
  assert.deepEqual(run.offline, [imei]);
  assert.deepEqual(run.flushes.map(value => value.kind), ['dwell', 'journey']);
  assert.deepEqual(run.diagnostics, [{ device: imei, kind: 'tcp_disconnected' }]);
  assert.equal(sessions.findSocketsForDevice(imei).length, 0);
});

test('a replacement still connecting is not cleared by the older connection closing', t => {
  const run = gateway(t);
  const old = run.connect();
  run.connect(imei, 0);
  const before = run.seedLive();
  run.close(old);

  assert.deepEqual(liveCache.getLiveDeviceState(imei), before);
  assert.deepEqual(run.offline, []);
  assert.deepEqual(run.flushes, []);
});

test('closing the newest socket also preserves a surviving older socket', t => {
  const run = gateway(t);
  run.connect();
  const newest = run.connect();
  const before = run.seedLive();
  run.close(newest);

  assert.deepEqual(liveCache.getLiveDeviceState(imei), before);
  assert.deepEqual(run.offline, []);
  assert.deepEqual(run.flushes, []);
});

for (const other of ['destroyed', 'different device', 'unidentified']) {
  test(`${other} socket cannot conceal the last usable connection closing`, t => {
    const run = gateway(t);
    const closing = run.connect();
    const remaining = run.connect(other === 'different device' ? 'other-watch' : other === 'unidentified' ? null : imei);
    if (other === 'destroyed') remaining.destroyed = true;
    run.seedLive();
    run.close(closing);

    assert.deepEqual(run.offline, [imei]);
    assert.equal(liveCache.getLiveDeviceState(imei).location, null);
  });
}

test('closing an unidentified socket still unregisters it without device cleanup', t => {
  const run = gateway(t);
  const socket = run.connect(null, 0);
  run.close(socket);
  assert.equal(sessions.getSession(socket), undefined);
  assert.deepEqual(run.offline, []);
  assert.deepEqual(run.flushes, []);
  assert.equal(run.captures[0].kind, 'socket_closed');
});

test('last-session cleanup retains the existing live-packet threshold for offline writes', t => {
  const run = gateway(t);
  const socket = run.connect(imei, 0);
  run.seedLive();
  run.close(socket);
  assert.deepEqual(run.offline, []);
  assert.equal(liveCache.getLiveDeviceState(imei).location, null);
});
