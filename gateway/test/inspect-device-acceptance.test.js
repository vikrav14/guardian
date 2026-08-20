const test = require('node:test');
const assert = require('node:assert/strict');

const {
  docsWithIds,
  parseSince,
} = require('../scripts/inspect-device-acceptance');

test('parseSince supports bounded relative windows and ISO timestamps', () => {
  const now = new Date('2026-08-15T10:00:00.000Z');
  assert.equal(parseSince('30m', now).toISOString(), '2026-08-15T09:30:00.000Z');
  assert.equal(parseSince('12h', now).toISOString(), '2026-08-14T22:00:00.000Z');
  assert.equal(parseSince('2d', now).toISOString(), '2026-08-13T10:00:00.000Z');
  assert.equal(
    parseSince('2026-08-15T08:00:00Z', now).toISOString(),
    '2026-08-15T08:00:00.000Z'
  );
  assert.throws(() => parseSince('yesterday-ish', now), /--since/);
});

test('docsWithIds retains document ids without mutating evidence fields', () => {
  const docs = docsWithIds({
    docs: [{ id: 'a1', data: () => ({ type: 'sos', notifyStatus: 'sent' }) }],
  });
  assert.deepEqual(docs, [{ id: 'a1', type: 'sos', notifyStatus: 'sent' }]);
});
