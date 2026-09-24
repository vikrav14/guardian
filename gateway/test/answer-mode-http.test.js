'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const config = require('../src/config');
const { startHttpServer } = require('../src/http');
const { stopContextRuntimeForTests } = require('../src/context/contextRuntime');
const { registerSession, unregisterSession } = require('../src/sessions');
const { runTrial } = require('../scripts/trial-answer-mode');
const { runReset } = require('../scripts/send-reset');

test('supplier-frame trial crosses authenticated HTTP and reaches the socket; invalid requests write nothing', async t => {
  const saved = Object.fromEntries(['host', 'httpPort', 'adminApiKey', 'contextIntelligenceEnabled',
    'contextCapEnabled', 'contextDefiMediaEnabled'].map(key => [key, config[key]]));
  Object.assign(config, { host: '127.0.0.1', httpPort: 0, adminApiKey: 'synthetic-trial-key',
    contextIntelligenceEnabled: false, contextCapEnabled: false, contextDefiMediaEnabled: false });
  const writes = [];
  const socket = { write: buffer => { writes.push(Buffer.from(buffer)); return true; } };
  const imei = '861397000000000';
  registerSession(socket, { imei, protocolId: '9700000000' });
  const server = startHttpServer();
  t.after(() => {
    server.closeAllConnections(); server.close(); unregisterSession(socket);
    stopContextRuntimeForTests(); Object.assign(config, saved);
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = new URL(`${base}/dev/downlink`);
  url.searchParams.set('imei', imei);
  url.searchParams.set('command', 'APPLOCK,JT-0');
  url.searchParams.set('frameFormat', 'applock-example');
  const noAuth = await fetch(url, { method: 'POST' });
  assert.equal(noAuth.status, 401); await noAuth.text();
  const headers = { 'X-Admin-Key': config.adminApiKey };
  const get = await fetch(url, { headers });
  assert.equal(get.status, 400); await get.text();
  for (const [command, format] of [['APPLOCK,JT-2', 'applock-example'], ['FIND', 'applock-example'],
    ['DEVREFUSEPHONESWITCH,0', 'applock-example'], ['APPLOCK,JT-0', 'raw']]) {
    url.searchParams.set('command', command); url.searchParams.set('frameFormat', format);
    const response = await fetch(url, { method: 'POST', headers });
    assert.equal(response.status, 400); await response.text();
  }
  assert.equal(writes.length, 0);
  const output = [];
  assert.equal(await runTrial({ args: ['--imei', imei, '--mode', 'auto', '--framing', 'supplier', '--send'],
    config: { ...config, httpPort: server.address().port }, print: value => output.push(JSON.parse(value)) }), 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], Buffer.from('[SG*9700000000*000c*APPLOCK,JT-0]', 'ascii'));
  assert.equal(output[0].outcome, 'socket_handoff');
  assert.equal(output[0].appliedStateVerified, false);

  // The restart helper used by this trial must authenticate and send only RESET.
  const restartOutput = [];
  const resetConfig = { ...config, httpPort: server.address().port };
  assert.equal(await runReset({ args: ['--imei', imei, '--send'],
    config: { ...resetConfig, adminApiKey: 'incorrect-key' },
    print: value => restartOutput.push(JSON.parse(value)) }), 1);
  assert.equal(restartOutput[0].httpStatus, 401);
  assert.equal(writes.length, 1);
  assert.equal(await runReset({ args: ['--imei', imei, '--send'], config: resetConfig,
    print: value => restartOutput.push(JSON.parse(value)) }), 0);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], Buffer.from('[SG*9700000000*0005*RESET]', 'ascii'));
  assert.equal(restartOutput[1].outcome, 'socket_handoff');
  assert.equal(restartOutput[1].watchRestartVerified, false);
});
