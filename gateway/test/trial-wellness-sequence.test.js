'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments, runSequence } = require('../scripts/trial-wellness-sequence');

const config = { adminApiKey: 'private-sequence-test-key', httpPort: 9001, wifiHomePilotImei: '861000000000001' };
const endpoint = 'http://127.0.0.1:9001/admin/wellness-sequence';
const attemptId = 'attempt-new';
const handedOff = { outcome: 'optical_request_handed_off', attemptId,
  requestedAt: '2026-09-17T12:00:00.000Z', opticalDeadlineAt: '2026-09-17T12:02:00.000Z' };
const waiting = { attemptId, phase: 'waiting_optical', outcome: 'awaiting_optical_uploads', terminal: false };
const complete = { attemptId, phase: 'complete', outcome: 'temperature_upload_observed', terminal: true };
const response = (body, ok = true, status = ok ? 200 : 409) => ({ ok, status, json: async () => body });

function harness(replies) {
  let time = 0;
  const calls = [], printed = [], sleeps = [];
  return {
    calls, printed, sleeps,
    last: () => JSON.parse(printed.at(-1)),
    options: {
      args: ['--once', '--worn'], config, print: value => printed.push(value), now: () => time,
      sleep: async ms => { time += ms; sleeps.push(ms); },
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        const next = replies.shift();
        if (next instanceof Error) throw next;
        assert.ok(next, 'unexpected extra HTTP request');
        return next;
      },
    },
  };
}

test('arguments require one explicit operator position for a one-shot and reject arbitrary commands', () => {
  assert.deepEqual(parseArguments([]), { once: false, includeValues: false });
  assert.deepEqual(parseArguments(['--include-values']), { once: false, includeValues: true });
  assert.deepEqual(parseArguments(['--once', '--worn']), { once: true, includeValues: false, operatorPosition: 'worn' });
  assert.deepEqual(parseArguments(['--removed', '--include-values', '--once']),
    { once: true, includeValues: true, operatorPosition: 'removed' });
  for (const args of [['--once'], ['--worn'], ['--removed'], ['--once', '--worn', '--removed'],
    ['--once', '--worn', '--once'], ['--include-values', '--include-values'], ['--command=BODYTEMP2'],
    ['--once', '--worn', '--uppercase'], ['--once', '--removed', '--imei=123'], ['--schedule=300']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('default and explicit-value status checks use a single authenticated GET without mutation', async () => {
  for (const includeValues of [false, true]) {
    const h = harness([response({ connected: true, sequence: complete,
      temperatureTrial: { trialId: 'temp-new' }, temperatureIngestionSuppressed: true })]);
    assert.equal(await runSequence({ ...h.options, args: includeValues ? ['--include-values'] : [] }), 0);
    assert.deepEqual(h.calls.map(call => call.method), ['GET']);
    assert.equal(h.calls[0].url, endpoint + (includeValues ? '?includeValues=1' : ''));
    assert.equal(h.calls[0].headers['X-Admin-Key'], config.adminApiKey);
    assert.equal(h.last().outcome, 'read_only');
    assert.equal(h.last().temperatureTrial.trialId, 'temp-new');
    assert.equal(h.last().temperatureIngestionSuppressed, true);
  }
});

test('invalid config or unavailable preflight cannot send a measurement request', async () => {
  for (const invalid of [{ ...config, adminApiKey: '' }, { ...config, httpPort: 'invalid' }]) {
    await assert.rejects(runSequence({ args: ['--once', '--worn'], config: invalid,
      fetchImpl: () => assert.fail('no HTTP call allowed') }));
  }
  for (const preflight of [new Error('network failure'), response({}, false), response({ connected: false })]) {
    const h = harness([preflight]);
    await assert.rejects(runSequence(h.options), /npm run wellness:sequence/);
    assert.deepEqual(h.calls.map(call => call.method), ['GET']);
  }
});

test('a currently active attempt is shown instead of requesting an overlapping measurement', async () => {
  const h = harness([response({ connected: true, sequence: waiting })]);
  assert.equal(await runSequence(h.options), 1);
  assert.equal(h.last().outcome, 'sequence_already_active');
  assert.match(h.last().instruction, /Do not repeat --once/);
  assert.deepEqual(h.calls.map(call => call.method), ['GET']);
});

test('one POST is followed by matching reads through optical and temperature stages', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    response({ connected: true, sequence: waiting }),
    response({ connected: true, sequence: { ...waiting, phase: 'waiting_temperature', outcome: 'temperature_requested' } }),
    response({ connected: true, sequence: complete })]);
  assert.equal(await runSequence(h.options), 0);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'GET', 'GET', 'GET']);
  assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'worn' });
  assert.ok(h.calls.every(call => call.headers['X-Admin-Key'] === config.adminApiKey));
  assert.equal(h.last().outcome, 'temperature_upload_observed');
  assert.equal(h.last().wearingConfirmed, false);
  assert.equal(h.last().readingConfirmed, false);
});

test('removed control uses the same fixed sequence with an explicit operator annotation', async () => {
  const h = harness([response({ connected: true }), response(handedOff), response({ connected: true,
    sequence: { ...complete, phase: 'skipped', outcome: 'temperature_skipped', reason: 'optical_unusable' } })]);
  assert.equal(await runSequence({ ...h.options, args: ['--once', '--removed'] }), 1);
  assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'removed' });
  assert.ok(h.printed.some(value => value.includes('sensor facing upward and uncovered')));
  assert.equal(h.last().sequence.reason, 'optical_unusable');
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
});

test('old attempts and outcome strings without terminal confirmation cannot finish this attempt', async () => {
  const h = harness([response({ connected: true, sequence: { ...complete, attemptId: 'attempt-old' } }), response(handedOff),
    response({ connected: true, sequence: { ...complete, attemptId: 'attempt-old' } }),
    response({ connected: true, sequence: { ...complete, terminal: false } }),
    response({ connected: true, sequence: complete })]);
  assert.equal(await runSequence(h.options), 0);
  assert.equal(h.calls.length, 5);
  assert.equal(h.last().sequence.attemptId, attemptId);
});

test('values are opt-in on GET and cannot be added to the mutation body or leaked in ordinary output', async () => {
  for (const includeValues of [false, true]) {
    const h = harness([response({ connected: true }), response(handedOff), response({ connected: true,
      sequence: { ...complete, optical: { heartBloodPressure: { usable: true, values: { heartRate: 72 } } } },
      temperatureTrial: { packets: [{ args: ['1', '36.4'] }] } })]);
    assert.equal(await runSequence({ ...h.options, args: ['--once', '--worn', ...(includeValues ? ['--include-values'] : [])] }), 0);
    assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'worn' });
    assert.equal(h.calls.filter(call => call.method === 'GET').every(call =>
      call.url === endpoint + (includeValues ? '?includeValues=1' : '')), true);
    assert.equal(h.printed.join('').includes('"heartRate"'), includeValues);
    assert.equal(h.printed.join('').includes('36.4'), includeValues);
  }
});

test('lost or malformed POST response is an unknown handoff with no retry', async () => {
  for (const failure of [new Error(`lost ${config.adminApiKey}`),
    { ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } }]) {
    const h = harness([response({ connected: true }), failure]);
    assert.equal(await runSequence(h.options), 1);
    assert.equal(h.last().outcome, 'optical_handoff_unknown');
    assert.match(h.last().instruction, /Do not repeat --once/);
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
    assert.equal(h.printed.join('').includes(config.adminApiKey), false);
  }
});

test('server errors are bounded and redacted while retaining handoff uncertainty', async () => {
  for (const outcome of ['optical_not_sent', 'optical_handoff_unknown', 'unexpected']) {
    const h = harness([response({ connected: true }), response({ outcome,
      error: `${config.adminApiKey}\n${config.wifiHomePilotImei}\u0000 ${'detail '.repeat(100)}` }, false, 409)]);
    assert.equal(await runSequence(h.options), 1);
    assert.equal(h.last().outcome, outcome === 'unexpected' ? 'sequence_not_confirmed' : outcome);
    assert.ok(h.last().error.length <= 500);
    assert.equal(/[\u0000-\u001f\u007f]/.test(h.last().error), false);
    assert.equal(h.printed.join('').includes(config.adminApiKey), false);
    assert.equal(h.printed.join('').includes(config.wifiHomePilotImei), false);
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
  }
});

test('an absent attempt identifier does not lead to polling or another request', async () => {
  const h = harness([response({ connected: true }), response({ ...handedOff, attemptId: null })]);
  assert.equal(await runSequence(h.options), 1);
  assert.equal(h.last().outcome, 'sequence_unavailable');
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
});

test('a failed read after handoff retains the latest matching status and gives read-only recovery', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    response({ connected: true, sequence: waiting }), new Error('read lost')]);
  assert.equal(await runSequence(h.options), 1);
  assert.equal(h.last().outcome, 'sequence_unavailable');
  assert.equal(h.last().sequence.attemptId, attemptId);
  assert.match(h.last().instruction, /npm run wellness:sequence/);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
});

test('client wait is bounded and never restarts the sequence when no terminal result arrives', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    ...Array.from({ length: 124 }, () => response({ connected: true, sequence: waiting }))]);
  assert.equal(await runSequence(h.options), 1);
  assert.equal(h.last().outcome, 'sequence_wait_ended');
  assert.equal(h.sleeps.reduce((sum, value) => sum + value, 0), 250_000);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
  assert.match(h.last().instruction, /does not cancel/);
});
