'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { registerSession, unregisterSession, getSession } = require('../src/sessions');
const { sendDownlinkCommand } = require('../src/downlink');
const { runTrial, parseArguments } = require('../scripts/trial-answer-mode');

const imei = '861397000000000';
const protocolId = '9700000000';
const config = { httpPort: 9001, adminApiKey: 'synthetic-secret' };
const args = ['--imei', imei, '--mode', 'auto', '--framing', 'supplier'];

test('real TCP handoff matches the supplier bytes and leaves default framing unchanged', async t => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connection = once(server, 'connection');
  const client = net.connect(server.address().port, '127.0.0.1');
  const [socket] = await connection;
  registerSession(socket, { imei, protocolId });
  t.after(() => { unregisterSession(socket); socket.destroy(); client.destroy(); server.close(); });
  for (const [command, options, expected] of [
    ['APPLOCK,JT-0', {}, '[SG*9700000000*000C*APPLOCK,JT-0]'],
    ['APPLOCK,JT-0', { frameFormat: 'applock-example' }, '[SG*9700000000*000c*APPLOCK,JT-0]'],
    ['APPLOCK,JT-1', { frameFormat: 'applock-example' }, '[SG*9700000000*000c*APPLOCK,JT-1]'],
    ['profile,3', {}, '[SG*9700000000*0009*profile,3]'],
  ]) {
    const received = new Promise((resolve, reject) => {
      const chunks = [];
      const onData = chunk => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length >= Buffer.byteLength(expected)) {
          client.off('data', onData); clearTimeout(timer); resolve(Buffer.concat(chunks));
        }
      };
      const timer = setTimeout(() => { client.off('data', onData); reject(new Error('No wire frame')); }, 2000);
      client.on('data', onData);
    });
    const result = sendDownlinkCommand(imei, command, options);
    assert.equal(result.ok, true);
    assert.deepEqual(await received, Buffer.from(expected, 'ascii'));
    assert.equal(result.frame, expected);
    assert.equal(result.sessions, 1);
  }
  const before = socket.bytesWritten;
  for (const command of ['APPLOCK,JT-2', 'APPLOCK,JT-0\n', 'APPLOCK,JT-0,', 'appLock,JT-0', 'FIND', 'DEVREFUSEPHONESWITCH,0']) {
    assert.equal(sendDownlinkCommand(imei, command, { frameFormat: 'applock-example' }).ok, false);
  }
  assert.equal(sendDownlinkCommand(imei, 'APPLOCK,JT-0', { frameFormat: 'raw' }).ok, false);
  getSession(socket).protocolId = 'bad-id';
  assert.equal(sendDownlinkCommand(imei, 'APPLOCK,JT-0', { frameFormat: 'applock-example' }).error, 'invalid_protocol_id');
  assert.equal(socket.bytesWritten, before, 'invalid overrides must write zero bytes');
});

test('answer-mode trial requires explicit choices and previews without network access', async () => {
  for (const invalid of [[], [...args, '--send', '--send'], [...args, '--mode', 'manual'], [...args, '--raw'], args.slice(0, -1)]) {
    assert.throws(() => parseArguments(invalid));
  }
  const output = [];
  assert.equal(await runTrial({ args, config: {}, fetchImpl: () => { throw new Error('network forbidden'); },
    print: value => output.push(JSON.parse(value)) }), 0);
  assert.equal(output[0].outcome, 'preview');
  assert.equal(output[0].commandSent, false);
});

test('answer-mode script requests the restricted format and verifies the server-reported bytes', async () => {
  const output = [], calls = [];
  const code = await runTrial({ args: [...args, '--send'], config, print: value => output.push(JSON.parse(value)),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, command: 'APPLOCK,JT-0', protocolId, sessions: 1,
        frame: '[SG*9700000000*000c*APPLOCK,JT-0]' }) };
    } });
  assert.equal(code, 0); assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'http://127.0.0.1:9001');
  assert.equal(url.searchParams.get('frameFormat'), 'applock-example');
  assert.equal(url.searchParams.get('command'), 'APPLOCK,JT-0');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['X-Admin-Key'], config.adminApiKey);
  assert.equal(output[0].outcome, 'socket_handoff');
  assert.equal(output[0].appliedStateVerified, false);
  assert.ok(!JSON.stringify(output).includes(config.adminApiKey));
});

test('an old gateway ignoring the framing option cannot yield a false supplier-format pass', async () => {
  const output = [];
  assert.equal(await runTrial({ args: [...args, '--send'], config, print: value => output.push(JSON.parse(value)),
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, command: 'APPLOCK,JT-0', protocolId,
      sessions: 1, frame: '[SG*9700000000*000C*APPLOCK,JT-0]' }) }) }), 1);
  assert.equal(output[0].outcome, 'frame_mismatch_after_handoff');
  assert.equal(output[0].appliedStateVerified, false);
});

test('ambiguous transport failure is not retried or reported as not sent', async () => {
  const output = []; let calls = 0;
  assert.equal(await runTrial({ args: [...args, '--send'], config, print: value => output.push(JSON.parse(value)),
    fetchImpl: async () => { calls++; throw new Error(config.adminApiKey); } }), 1);
  assert.equal(calls, 1); assert.equal(output[0].outcome, 'handoff_unknown');
  assert.ok(!JSON.stringify(output).includes(config.adminApiKey));
});

test('manual mode uses JT-1 and an offline response is kept separate from handoff', async () => {
  const output = [];
  assert.equal(await runTrial({ args: ['--imei', imei, '--mode', 'manual', '--framing', 'supplier', '--send'],
    config, print: value => output.push(JSON.parse(value)), fetchImpl: async url => {
      assert.equal(new URL(url).searchParams.get('command'), 'APPLOCK,JT-1');
      return { ok: false, status: 404, json: async () => ({ error: 'no_active_session' }) };
    } }), 1);
  assert.equal(output[0].outcome, 'handoff_not_confirmed');
  assert.equal(output[0].reason, 'no_active_session');
});
