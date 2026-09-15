'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runTrial, parseArguments } = require('../scripts/trial-temperature');

const config = { adminApiKey: 'secret-admin-test-key', httpPort: 9001, wifiHomePilotImei: '861000000000001' };
const endpoint = 'http://127.0.0.1:9001/admin/temperature-trial';
const requestedAt = '2026-09-15T20:00:00.000Z';
const handedOff = { outcome: 'command_handed_off', trialId: 'trial-new', requestedAt };
const replyOnly = { trialId: 'trial-new', phase: 'observing', outcome: 'reply_received_awaiting_upload', counts: { replies: 1, uploads: 0 } };
const uploaded = { trialId: 'trial-new', phase: 'observing', outcome: 'upload_observed_after_request', counts: { replies: 1, uploads: 1 } };
const response = (body, ok = true, status = ok ? 200 : 409) => ({ ok, status, json: async () => body });

function harness(replies) {
  let time = 0;
  const calls = [], printed = [], sleeps = [];
  return {
    calls, printed, sleeps,
    options: {
      config, args: ['--once', '--worn'], print: value => printed.push(value), now: () => time,
      sleep: async ms => { time += ms; sleeps.push(ms); },
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        const next = replies.shift();
        if (next instanceof Error) throw next;
        assert.ok(next, 'unexpected extra HTTP request');
        return next;
      },
    },
    last: () => JSON.parse(printed.at(-1)),
  };
}

test('temperature trial accepts read-only defaults and requires paired one-shot/operator flags', () => {
  assert.deepEqual(parseArguments([]), { once: false, includeValues: false });
  assert.deepEqual(parseArguments(['--include-values']), { once: false, includeValues: true });
  assert.deepEqual(parseArguments(['--include-values', '--worn', '--once']), { once: true, includeValues: true });
  assert.deepEqual(parseArguments(['--once', '--worn', '--uppercase']),
    { once: true, includeValues: false, commandCase: 'uppercase' });
  for (const args of [['--once'], ['--worn'], ['--once', '--once', '--worn'],
    ['--include-values', '--include-values'], ['--once', '--worn', '--imei=123'],
    ['--command=BODYTEMP2'], ['--once', '--worn', '--removed'], ['--help'],
    ['--uppercase'], ['--uppercase', '--include-values'], ['--uppercase', '--once'],
    ['--once', '--worn', '--uppercase', '--uppercase']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('read-only metadata and explicit values use only one authenticated GET', async () => {
  for (const includeValues of [false, true]) {
    const h = harness([response({ connected: true, trial: null })]);
    const code = await runTrial({ ...h.options, args: includeValues ? ['--include-values'] : [] });
    assert.equal(code, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, 'GET');
    assert.equal(h.calls[0].url, endpoint + (includeValues ? '?includeValues=1' : ''));
    assert.equal(h.calls[0].headers['X-Admin-Key'], config.adminApiKey);
    assert.equal(h.last().outcome, 'read_only');
    assert.equal(h.printed.join('').includes(config.adminApiKey), false);
    assert.equal(h.printed.join('').includes(config.wifiHomePilotImei), false);
  }
});

test('missing admin configuration and disconnected or failed preflight never dispatch a command', async () => {
  await assert.rejects(runTrial({ args: ['--once', '--worn'], config: { ...config, adminApiKey: '' },
    fetchImpl: () => assert.fail('no request allowed') }), /ADMIN_API_KEY/);
  for (const before of [response({ connected: false }), response({}), response({ connected: true }, false), new Error('network failure')]) {
    const h = harness([before]);
    await assert.rejects(runTrial(h.options));
    assert.deepEqual(h.calls.map(call => call.method), ['GET']);
  }
});

test('one-shot sends exactly one POST and continues past reply-only evidence until matching upload', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    response({ connected: true, trial: replyOnly }), response({ connected: true, trial: uploaded })]);
  const code = await runTrial(h.options);
  assert.equal(code, 0);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'GET', 'GET']);
  assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'worn' });
  assert.equal(h.calls[1].url, endpoint);
  assert.equal(h.calls.every(call => call.headers['X-Admin-Key'] === config.adminApiKey), true);
  assert.deepEqual(h.sleeps, [2000, 2000]);
  assert.equal(h.last().outcome, 'upload_observed_after_request');
  assert.equal(h.last().readingConfirmed, false);
  assert.equal(h.last().wearingConfirmed, false);
  assert.equal(h.printed.join('').includes(config.adminApiKey), false);
  assert.equal(h.printed.join('').includes(config.wifiHomePilotImei), false);
});

test('stale capture completion is ignored even when its upload or terminal state looks successful', async () => {
  const h = harness([response({ connected: true, trial: { ...uploaded, trialId: 'trial-old' } }), response(handedOff),
    response({ connected: true, trial: { ...uploaded, trialId: 'trial-old' } }),
    response({ connected: true, trial: uploaded })]);
  assert.equal(await runTrial(h.options), 0);
  assert.equal(h.calls.length, 4);
  assert.equal(h.last().trial.trialId, 'trial-new');
});

test('uppercase comparison sends one explicitly selected command and reports the returned spelling', async () => {
  const h = harness([response({ connected: true }), response({ ...handedOff, command: 'BODYTEMP2' }),
    response({ connected: true, trial: { ...uploaded, command: 'BODYTEMP2' } })]);
  assert.equal(await runTrial({ ...h.options, args: ['--once', '--worn', '--uppercase'] }), 0);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'GET']);
  assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'worn', commandCase: 'uppercase' });
  const initialResult = h.printed.filter(value => value.startsWith('{')).map(value => JSON.parse(value))
    .find(value => value.outcome === 'command_handed_off');
  assert.equal(initialResult.command, 'BODYTEMP2');
  assert.equal(h.printed.some(value => value.includes('Selected command: BODYTEMP2')), true);
});

test('uppercase comparison never falls back to lowercase after uncertain or rejected dispatch', async () => {
  for (const failure of [new Error('socket lost'), response({ error: 'Trial blocked.' }, false, 409)]) {
    const h = harness([response({ connected: true }), failure]);
    assert.equal(await runTrial({ ...h.options, args: ['--once', '--worn', '--uppercase'] }), 1);
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
    assert.equal(JSON.parse(h.calls[1].body).commandCase, 'uppercase');
  }
});

test('values are opt-in on reads only, not part of the mutation payload', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    response({ connected: true, trial: { ...uploaded, packets: [{ args: ['1', '36.68'] }] } })]);
  assert.equal(await runTrial({ ...h.options, args: ['--once', '--worn', '--include-values'] }), 0);
  assert.equal(h.calls.filter(call => call.method === 'GET').every(call => call.url === `${endpoint}?includeValues=1`), true);
  assert.deepEqual(JSON.parse(h.calls[1].body), { action: 'single', operatorPosition: 'worn' });
  assert.equal(h.printed.join('').includes('36.68'), true);
});

test('lost POST response reports unknown handoff and never retries or polls another mutation', async () => {
  const h = harness([response({ connected: true }), new Error(`secret ${config.adminApiKey}`)]);
  assert.equal(await runTrial(h.options), 1);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(h.last().outcome, 'handoff_unknown');
  assert.equal(h.printed.join('').includes(config.adminApiKey), false);
});

test('server rejection explains its bounded cause and retains uncertain or not-sent handoff outcomes', async () => {
  for (const status of [400, 409]) {
    const h = harness([response({ connected: true }), response({ error: 'Current wearer consent is required.' }, false, status)]);
    assert.equal(await runTrial(h.options), 1);
    assert.equal(h.last().outcome, 'command_not_confirmed');
    assert.equal(h.last().error, 'Current wearer consent is required.');
    assert.equal(h.last().httpStatus, status);
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
  }
  for (const outcome of ['handoff_unknown', 'not_sent']) {
    const h = harness([response({ connected: true }), response({ outcome,
      error: `${config.adminApiKey}\n${config.wifiHomePilotImei}\u0000 ${'detail '.repeat(100)}` }, false)]);
    assert.equal(await runTrial(h.options), 1);
    assert.equal(h.last().outcome, outcome);
    assert.ok(h.last().error.length <= 240);
    assert.equal(/[\u0000-\u001f\u007f]/.test(h.last().error), false);
    assert.equal(h.printed.join('').includes(config.adminApiKey), false);
    assert.equal(h.printed.join('').includes(config.wifiHomePilotImei), false);
    assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST']);
  }
});

test('status loss after handoff reports capture unavailable without repeating POST', async () => {
  const h = harness([response({ connected: true }), response(handedOff), new Error('lost capture read')]);
  assert.equal(await runTrial(h.options), 1);
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'GET']);
  assert.equal(h.last().outcome, 'capture_unavailable');
  assert.equal(h.last().trialId, 'trial-new');
});

test('session change and server capture timeout stop the wait with no further request', async () => {
  for (const [phase, outcome] of [['session_changed', 'session_changed'], ['capture_timeout', 'reply_without_upload'], ['not_sent', 'not_sent']]) {
    const h = harness([response({ connected: true }), response(handedOff), response({ connected: phase !== 'session_changed',
      trial: { trialId: 'trial-new', phase, outcome } })]);
    assert.equal(await runTrial(h.options), 1);
    assert.equal(h.calls.length, 3);
    assert.equal(h.last().outcome, outcome);
  }
});

test('local capture wait is bounded at two minutes even when only replies arrive', async () => {
  const h = harness([response({ connected: true }), response(handedOff),
    ...Array.from({ length: 59 }, () => response({ connected: true, trial: replyOnly }))]);
  assert.equal(await runTrial(h.options), 1);
  assert.equal(h.last().outcome, 'capture_timeout');
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(h.sleeps.reduce((sum, ms) => sum + ms, 0), 120_000);
});
