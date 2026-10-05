'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoProgress } = require('../src/incident-photo-progress');
const { inspectIncidentWorker } = require('../scripts/inspect-incident-worker');

test('a stuck operation stays locked, reports its stage once and recovers when its own promise settles', async () => {
  let clock = new Date('2026-09-30T00:00:00Z');
  const logs = [];
  const worker = createPhotoProgress({ name: 'capture', now: () => clock, log: line => logs.push(line) });
  let release;
  assert.equal(worker.begin(), true);
  const operation = worker.step('pending_alerts_read', () => new Promise(resolve => { release = resolve; }));
  clock = new Date(clock.getTime() + 60_001);
  assert.equal(worker.getStatus().operationSlow, true);
  assert.equal(logs.length, 0, 'status inspection is read only');
  assert.equal(worker.begin(), false);
  assert.equal(worker.begin(), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /pending_alerts_read/);
  assert.equal(worker.getStatus().skippedRuns, 2);
  release(); await operation; worker.finish();
  assert.equal(worker.getStatus().running, false);
  assert.equal(worker.getStatus().operationSlow, false);
  assert.equal(worker.begin(), true);
  await assert.rejects(worker.step('incident_enqueue', () => Promise.reject(Error('SECRET'))));
  worker.finish();
  assert.equal(worker.getStatus().lastFailureStage, 'incident_enqueue');
  assert.ok(!JSON.stringify(worker.getStatus()).includes('SECRET'));
  assert.ok(!logs.join('').includes('SECRET'));
});

test('worker inspection makes one authenticated loopback GET and rejects redirects/errors without their bodies', async () => {
  let calls = 0;
  const status = { version: 1, workerStarted: true, enabled: true };
  const result = await inspectIncidentWorker({ port: 9001, adminKey: 'test-key', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:9001/ops/incident-photos');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-Admin-Key'], 'test-key');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => status };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { outcome: 'read_only', ...status });
  for (const code of [401, 404, 500]) {
    await assert.rejects(inspectIncidentWorker({ port: 9001, adminKey: 'test-key', fetchImpl: async () => ({
      ok: false, status: code, json() { assert.fail('must not read private error body'); },
    }) }), new RegExp(code === 404 ? 'updated_gateway_required' : 'gateway_request_rejected'));
  }
});
