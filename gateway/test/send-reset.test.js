'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments, runReset } = require('../scripts/send-reset');
const imei = '861397000000000';
const args = ['--imei', imei, '--send'];
const config = { httpPort: 9001, adminApiKey: 'synthetic-private-key' };

test('restart requires one explicit device; rejects extra commands and remote targets', () => {
  for (const input of [[], ['--send'], ['--imei'], ['--imei', '123'],
    ['--imei', imei, '--imei', imei], [...args, '--send'],
    [...args, '--command', 'FACTORY'], [...args, '--host', 'example.com']]) {
    assert.throws(() => parseArguments(input));
  }
  assert.deepEqual(parseArguments([imei]), { imei, send: false });
  assert.deepEqual(parseArguments(['--imei', '9700000000', '--send']), { imei: '9700000000', send: true });
});

test('preview and invalid authentication/port do not contact the gateway', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error('unexpected network request'); };
  const output = [];
  assert.equal(await runReset({ args: ['--imei', imei], config: {}, fetchImpl,
    print: value => output.push(JSON.parse(value)) }), 0);
  assert.equal(output[0].outcome, 'preview');
  assert.equal(output[0].commandSent, false);
  for (const invalid of [{ httpPort: 9001 }, { ...config, httpPort: 0 }]) {
    await assert.rejects(runReset({ args, config: invalid, fetchImpl }));
  }
  assert.equal(calls, 0);
});

test('restart handoff failures are bounded, private and never automatically retried', async () => {
  for (const [response, outcome] of [
    [null, 'handoff_unknown'],
    [{ ok: false, status: 404, body: { error: 'no_active_session' } }, 'handoff_not_confirmed'],
    [{ ok: false, status: 500, body: { error: config.adminApiKey } }, 'handoff_not_confirmed'],
    [{ ok: true, status: 200, body: { ok: true, command: 'FACTORY', protocolId: '9700000000',
      frame: '[SG*9700000000*0007*FACTORY]', sessions: 1 } }, 'frame_mismatch_after_handoff'],
  ]) {
    let calls = 0;
    const output = [];
    const fetchImpl = async (url, options) => {
      calls++;
      assert.equal(new URL(url).origin, 'http://127.0.0.1:9001');
      assert.equal(new URL(url).searchParams.get('command'), 'RESET');
      assert.equal(options.headers['X-Admin-Key'], config.adminApiKey);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      if (!response) throw Error(config.adminApiKey);
      return { ...response, json: async () => response.body };
    };
    assert.equal(await runReset({ args, config, fetchImpl, print: value => output.push(JSON.parse(value)) }), 1);
    assert.equal(calls, 1);
    assert.equal(output[0].outcome, outcome);
    assert.equal(output[0].watchRestartVerified, false);
    assert.equal(JSON.stringify(output).includes(config.adminApiKey), false);
  }
});
