const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldSkipOfflineWrite,
  clearOfflineTimersForTests,
} = require('../src/device-offline');

test('shouldSkipOfflineWrite during active connecting handshake', () => {
  assert.equal(
    shouldSkipOfflineWrite({
      connectionState: 'connecting',
      connectingAt: new Date(),
    }),
    true
  );
});

test('shouldSkipOfflineWrite during fresh connectingAt even if state is offline', () => {
  assert.equal(
    shouldSkipOfflineWrite({
      connectionState: 'offline',
      online: false,
      connectingAt: new Date(Date.now() - 30_000),
    }),
    true
  );
});

test('shouldSkipOfflineWrite allows offline after connecting grace', () => {
  assert.equal(
    shouldSkipOfflineWrite({
      connectionState: 'offline',
      connectingAt: new Date(Date.now() - 4 * 60 * 1000),
    }),
    false
  );
});

test.after(clearOfflineTimersForTests);
