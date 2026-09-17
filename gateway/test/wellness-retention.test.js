'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanupWellnessRecords } = require('../src/wellness-retention');
function fixture(plan, { consent = true, trusted = true, displayable = true, expired = false } = {}) {
  const calls = [];
  const now = new Date('2026-09-14T12:00:00Z');
  const subscription = { version: 1, managedBy: trusted ? 'guardian_admin' : 'client', plan, status: 'active', currentPeriodEnd: new Date(+now + (expired ? -1 : 1) * 86_400_000) };
  const db = { collection: name => name === 'users' ? { where: () => ({ get: async () => ({ docs: [{ id: 'owner', data: () => ({ linkedImeis: ['test-watch'] }) }] }) }) }
    : { doc: () => ({ get: async () => ({ exists: true, data: () => subscription }) }) },
    batch: () => ({ update: (ref, data) => calls.push(['renew', data]), delete: () => calls.push(['delete']), commit: async () => {} }) };
  return { db, calls, now, consent, docs: [{ ref: {}, data: () => ({ imei: 'test-watch', displayable }) }] };
}
test('active trusted Care renews accepted history without changing its source time', async () => {
  const f = fixture('care');
  assert.deepEqual(await cleanupWellnessRecords(f.db, f.docs, { now: f.now }), { deleted: 0, renewed: 1 });
  assert.deepEqual(Object.keys(f.calls[0][1]).sort(), ['expiresAt', 'retentionPolicy']);
});
test('lower plans, expired service, shadow evidence and revoked consent are not retained indefinitely', async () => {
  for (const [plan, options] of [['essential', {}], ['family', {}], ['care', { expired: true }], ['care', { trusted: false }], ['care', { displayable: false }], ['care', { consent: false }]]) {
    const f = fixture(plan, options);
    assert.deepEqual(await cleanupWellnessRecords(f.db, f.docs, { now: f.now, canRetain: async () => f.consent }), { deleted: 1, renewed: 0 });
  }
});
