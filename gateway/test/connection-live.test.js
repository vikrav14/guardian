const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionPersistPatch, SESSION_LIVE_PACKETS } = require('../src/connection-live');

test('buildSessionPersistPatch stays connecting until enough session packets', () => {
  const session = {};
  const base = { lastHeartbeatAt: new Date(), batteryPercent: 80 };

  const first = buildSessionPersistPatch(session, base);
  assert.equal(first.online, false);
  assert.equal(first.connectionState, 'connecting');
  assert.equal(session.persistCount, 1);

  const second = buildSessionPersistPatch(session, base);
  assert.equal(second.online, true);
  assert.equal(second.connectionState, 'live');
  assert.equal(session.persistCount, SESSION_LIVE_PACKETS);
});

test('shouldForceSessionPersist until session reaches live threshold', () => {
  const { shouldForceSessionPersist } = require('../src/connection-live');
  assert.equal(shouldForceSessionPersist({ persistCount: 0 }), true);
  assert.equal(shouldForceSessionPersist({ persistCount: 1 }), true);
  assert.equal(shouldForceSessionPersist({ persistCount: 2 }), false);
  assert.equal(shouldForceSessionPersist(null), false);
});

test('buildPresenceTouchPatch keeps online while TCP session is live', () => {
  const { buildPresenceTouchPatch, PRESENCE_TOUCH_MS } = require('../src/connection-live');
  const session = { persistCount: SESSION_LIVE_PACKETS };
  const first = buildPresenceTouchPatch(session, 1_000_000);
  assert.equal(first.online, true);
  assert.equal(first.connectionState, 'live');
  assert.ok(first.lastHeartbeatAt instanceof Date);

  const tooSoon = buildPresenceTouchPatch(session, 1_000_000 + PRESENCE_TOUCH_MS - 1);
  assert.equal(tooSoon, null);

  const next = buildPresenceTouchPatch(session, 1_000_000 + PRESENCE_TOUCH_MS);
  assert.equal(next.online, true);
});

test('buildPresenceTouchPatch skips until session is live', () => {
  const { buildPresenceTouchPatch } = require('../src/connection-live');
  assert.equal(buildPresenceTouchPatch({ persistCount: 1 }), null);
  assert.equal(buildPresenceTouchPatch(null), null);
});

test('buildSessionPersistPatch promotes live without session (tests/simulator)', () => {
  const patch = buildSessionPersistPatch(null, { lastHeartbeatAt: new Date() });
  assert.equal(patch.online, true);
  assert.equal(patch.connectionState, 'live');
});
