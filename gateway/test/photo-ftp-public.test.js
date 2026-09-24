'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planEndpoints, validateJournal, trial, restore } = require('../scripts/check-photo-ftp-public');

const id = '0123456789abcdef';
function endpoints() {
  return [
    { name: 'command_line', url: 'tcp://0.tcp.in.ngrok.io:10595', upstream: { url: 'localhost:9000' }, inspect: false },
    { name: 'guardian-answer-capture', url: 'tcp://0.tcp.in.ngrok.io:29315', upstream: { url: '127.0.0.1:9002' }, inspect: false, metrics: { conns: { gauge: 0 } } },
    { name: 'guardian-wa-https', url: 'https://example.ngrok-free.dev', upstream: { url: 'http://localhost:9001' }, inspect: true },
  ];
}
function fake({ failAfter = '', failRestoreWhatsapp = false, changeCapture = false } = {}) {
  const rows = new Map(endpoints().map(row => [row.name, row]));
  const calls = [];
  let failed = false;
  const request = async (method, name, body) => {
    if (method === 'GET') return { endpoints: structuredClone([...rows.values()]) };
    assert.notEqual(name || body?.name, 'command_line', 'must never mutate the Guardian endpoint');
    calls.push({ method, name: name || body?.name });
    if (method === 'DELETE') rows.delete(name);
    else {
      if (body.name === 'guardian-wa-https' && failRestoreWhatsapp) throw Error('simulated_restore_failure');
      rows.set(body.name, { ...structuredClone(body), url: body.url === 'tcp://' ? 'tcp://data.ngrok.test:24680' : body.url });
    }
    if (!failed && `${method}:${name || body?.name}` === failAfter) {
      failed = true;
      throw Error('simulated_response_lost_after_mutation');
    }
    return structuredClone(rows.get(name || body?.name));
  };
  const probe = async () => {
    if (changeCapture) rows.get('guardian-answer-capture').upstream.url = '127.0.0.1:9999';
    return { event: 'ftp_probe_passed', bytesVerified: 1024, watchCommandsSent: false };
  };
  return { request, rows, calls, probe };
}

test('public probe restores both original routes and never mutates Guardian', async () => {
  const plan = planEndpoints(endpoints(), id), deps = fake();
  const result = await trial({ plan, ...deps });
  assert.equal(result.outcome, 'public_ftp_probe_passed');
  assert.equal(result.restoration.endpointConfigurationRestored, true);
  assert.equal(deps.rows.size, 3);
  assert.equal(deps.rows.get('guardian-answer-capture').upstream.url, '127.0.0.1:9002');
  assert.ok(deps.rows.has('guardian-wa-https'));
});

test('response lost after each setup mutation still triggers endpoint restoration', async () => {
  for (const failAfter of ['PUT:guardian-answer-capture', 'DELETE:guardian-wa-https', `POST:guardian-photo-ftp-data-${id}`]) {
    const plan = planEndpoints(endpoints(), id), deps = fake({ failAfter });
    const result = await trial({ plan, ...deps });
    assert.equal(result.outcome, 'public_ftp_probe_incomplete');
    assert.equal(result.restoration.endpointConfigurationRestored, true);
    assert.equal(deps.rows.size, 3);
  }
});

test('probe failure and cancellation restore endpoints before reporting failure', async () => {
  for (const cancelled of [false, true]) {
    const plan = planEndpoints(endpoints(), id), deps = fake();
    const abort = new AbortController();
    if (cancelled) abort.abort();
    const result = await trial({ plan, ...deps, signal: abort.signal, probe: async () => { throw Error('probe_failed'); } });
    assert.equal(result.outcome, 'public_ftp_probe_incomplete');
    assert.equal(result.restoration.endpointConfigurationRestored, true);
    if (cancelled) assert.deepEqual(deps.calls, []);
  }
});

test('WhatsApp restoration failure does not skip recorder restoration or claim success', async () => {
  const plan = planEndpoints(endpoints(), id), deps = fake({ failRestoreWhatsapp: true });
  const result = await trial({ plan, ...deps });
  assert.equal(result.restoration.endpointConfigurationRestored, false);
  assert.equal(result.outcome, 'public_ftp_probe_incomplete');
  assert.equal(deps.rows.get('guardian-answer-capture').upstream.url, '127.0.0.1:9002');
});

test('external changes are preserved and restoration remains visibly incomplete', async () => {
  const plan = planEndpoints(endpoints(), id), deps = fake({ changeCapture: true });
  const result = await trial({ plan, ...deps });
  assert.equal(result.restoration.endpointConfigurationRestored, false);
  assert.equal(deps.rows.get('guardian-answer-capture').upstream.url, '127.0.0.1:9999');
  assert.ok(deps.rows.has('guardian-wa-https'));
});

test('journal restoration is repeatable; malformed journals and active/foreign routes are rejected', async () => {
  const plan = planEndpoints(endpoints(), id), deps = fake();
  assert.deepEqual(validateJournal(JSON.parse(JSON.stringify(plan))), plan);
  assert.equal((await restore(plan, deps.request)).endpointConfigurationRestored, true);
  assert.deepEqual(deps.calls, []);
  const altered = structuredClone(plan); altered.captureTrial.upstream.url = 'external.test:9000';
  assert.throws(() => validateJournal(altered), /invalid_restore_journal/);
  for (const change of [rows => rows[1].metrics.conns.gauge = 1,
    rows => rows[0].upstream.url = 'localhost:5555', rows => rows[2].traffic_policy = 'custom',
    rows => rows.push({ name: 'someone_else' })]) {
    const rows = endpoints(); change(rows);
    assert.throws(() => planEndpoints(rows, id));
  }
});
