'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runTrial, parseArguments } = require('../scripts/trial-wear-removal');
const config = { adminApiKey: 'private-test-key', wifiHomePilotImei: '861000000000001', httpPort: 9001 };

test('removal trial defaults to a read, accepts no arbitrary command or target, and requires admin configuration', async () => {
  const requests = [], printed = [];
  await runTrial({ args: [], config, print: s => printed.push(s), fetchImpl: async (url, options) => {
    requests.push([url, options.method]); return { ok: true, json: async () => ({ connected: true }) };
  } });
  assert.deepEqual(requests, [['http://127.0.0.1:9001/admin/wellness-routine', 'GET']]);
  assert.equal(JSON.parse(printed[0]).outcome, 'read_only');
  for (const args of [['--command=REMOVESMS,1'], ['--enable', '--disable'], ['--enable', '--imei=other']]) assert.throws(() => parseArguments(args));
  for (const invalid of [{ ...config, adminApiKey: '' }]) {
    await assert.rejects(runTrial({ args: ['--enable'], config: invalid, fetchImpl: () => assert.fail('must not request') }));
  }
});

test('only an authenticated connected snapshot permits a write', async () => {
  for (const snapshot of [{ ok: false, connected: true }, { ok: true, connected: false }, { ok: true }]) {
    let calls = 0;
    await assert.rejects(runTrial({ args: ['--enable'], config, fetchImpl: async (_, options) => {
      calls++; assert.equal(options.method, 'GET');
      return { ok: snapshot.ok, status: 403, json: async () => snapshot };
    } }));
    assert.equal(calls, 1);
  }
});

test('enable and cleanup each issue exactly one REMOVE command, never expose secrets or claim settings confirmed', async () => {
  for (const [flag, command] of [['--enable', 'REMOVE,1'], ['--disable', 'REMOVE,0']]) {
    const calls = [], printed = [];
    const code = await runTrial({ args: [flag], config, print: s => printed.push(s), fetchImpl: async (url, options) => {
      calls.push(options.method); assert.equal(options.headers['X-Admin-Key'], config.adminApiKey);
      if (options.method === 'GET') return { ok: true, json: async () => ({ connected: true }) };
      assert.equal(url, 'http://127.0.0.1:9001/admin/wellness-routine');
      assert.deepEqual(JSON.parse(options.body), { action: flag === '--enable' ? 'removal_test_enable' : 'removal_test_disable' });
      return { ok: true, json: async () => ({ outcome: 'command_handed_off', command }) };
    } });
    assert.equal(code, 0); assert.deepEqual(calls, ['GET', 'POST']);
    const result = JSON.parse(printed.at(-1));
    assert.equal(result.outcome, 'command_handed_off'); assert.equal(result.settingsConfirmed, false);
    assert.equal(result.wearingConfirmed, false); assert.equal(result.command, command);
    assert.equal(printed.join('').includes(config.adminApiKey), false);
    assert.equal(printed.join('').includes(config.wifiHomePilotImei), false);
  }
});

test('lost reply produces an uncertain outcome and never retries the mutation', async () => {
  let posts = 0; const printed = [];
  const code = await runTrial({ args: ['--enable'], config, print: s => printed.push(s), fetchImpl: async (_, options) => {
    if (options.method === 'GET') return { ok: true, json: async () => ({ connected: true }) };
    posts++; throw new Error('connection lost');
  } });
  assert.equal(code, 1); assert.equal(posts, 1);
  assert.equal(JSON.parse(printed.at(-1)).outcome, 'handoff_unknown');
});
