'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRemovalDispatcher } = require('../src/removal-dispatcher');
const imei = '999999999999999', start = Date.parse('2026-09-14T18:00:00Z');
const at = seconds => new Date(start + seconds * 1000);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const docs = new Map(), alerts = [], errors = [];
  let clock = at(0);
  const db = { hold: null, collection: name => ref(name),
    runTransaction: async fn => fn({ get: r => r.get(), set: (r, value) => docs.set(r.path, value) }) };
  const ref = path => ({ path, doc: id => ref(`${path}/${id}`), collection: name => ref(`${path}/${name}`),
    add: async () => {},
    get: async () => {
      if (path === `devices/${imei}`) {
        await db.hold;
        return { exists: true, data: () => ({ removalAlerts: { enabled: true, debounceSeconds: 30 } }) };
      }
      return { exists: docs.has(path), data: () => docs.get(path) };
    },
  });
  const worker = createRemovalDispatcher({ db,
    config: { removalAlertsIngestEnabled: true, removalAlertsDeviceMode: 'accepted', removalAlertsCustomerEnabled: true },
    now: () => clock, createAlert: async (_imei, alert) => alerts.push(alert), onError: error => errors.push(error) });
  const observe = (seconds, state = 'removed') => {
    clock = at(seconds);
    worker.observe({ imei, command: 'UD_LTE', wearEvidence: {
      version: 1, state, deviceAccepted: true, observedAt: clock, expiresAt: at(seconds + 120),
      continuityId: state === 'worn' ? 'fixture-worn' : null,
    } }, clock);
  };
  return { db, docs, alerts, errors, observe };
}

test('qualified sustained removal from positioning packets delivers once without raw AL packets', async () => {
  const run = fixture(); run.observe(0); await flush();
  assert.equal(run.alerts.length, 0);
  run.observe(31); await flush();
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].type, 'watch_removed');
  run.observe(60); await flush();
  assert.equal(run.alerts.length, 1);
  assert.deepEqual(run.errors, []);
});

test('a stalled removal write does not hold ingress or deliver an obsolete alert after restoration', async () => {
  const run = fixture(); run.observe(0); await flush();
  let release; run.db.hold = new Promise(resolve => { release = resolve; });
  run.observe(31); // returns immediately while persistence is blocked
  run.observe(32, 'worn'); // latest accepted status supersedes pending removal
  release(); await flush();
  assert.equal(run.alerts.length, 0);
  assert.deepEqual(run.errors, []);
});
