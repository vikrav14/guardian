'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runTrial } = require('../scripts/trial-wifi-fence-single-router');
const { fingerprintRouter } = require('../src/wifi-home-observer');

const imei = '359633100123456';
const routerId = '02:00:00:00:00:01';
const hashKey = 'ab'.repeat(32);
const config = { wifiHomePilotImei: imei, wifiHomeHashKey: hashKey,
  wifiHomeRouterHash: fingerprintRouter({ imei, routerId, hashKey }) };
const ready = () => ({ version: 1, configured: true, sessionConnected: true,
  singleRouterTrial: { supported: true, attempted: false }, capture: null });

test('default and preview never read configuration/input or contact the gateway', async () => {
  for (const args of [[], ['--preview']]) {
    const value = await runTrial({ args, request: () => assert.fail('network'), readRouter: () => assert.fail('input') });
    assert.equal(value.hardwareCommandsSent, 0);
    assert.equal(value.singleRouterSyntaxConfirmed, false);
  }
  for (const args of [['--send', '--send'], ['--apply'], ['--command=CR']]) {
    await assert.rejects(runTrial({ args }), /invalid_arguments/);
  }
});

test('bad enrollment, old gateway, disconnected pilot and prior attempts cannot post a setting', async () => {
  for (const change of [s => { s.singleRouterTrial = undefined; }, s => { s.configured = false; },
    s => { s.sessionConnected = false; }, s => { s.singleRouterTrial.attempted = true; },
    s => { s.capture = { phase: 'recording' }; }]) {
    const state = ready(); change(state); const calls = [];
    await assert.rejects(runTrial({ args: ['--send'], config, readRouter: async () => routerId,
      request: async input => { calls.push(input); return state; } }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  }
  let posts = 0;
  await assert.rejects(runTrial({ args: ['--send'], config, readRouter: async () => '02:00:00:00:00:02',
    request: async ({ method }) => { if (method === 'POST') posts++; return ready(); } }), /enrollment/);
  assert.equal(posts, 0);
});

test('capture and hardware writes are not retried after a lost response', async () => {
  for (const failedEndpoint of ['validation', 'trial']) {
    const posts = [];
    await assert.rejects(runTrial({ args: ['--send'], config, readRouter: async () => routerId,
      request: async input => {
        if (input.method === 'GET') return ready();
        posts.push(input);
        if (input.endpoint === failedEndpoint) throw new Error('lost response');
        return { capture: { phase: 'recording', captureId: 'synthetic-capture' } };
      } }), /lost response/);
    assert.equal(posts.length, failedEndpoint === 'validation' ? 1 : 2);
    assert.equal(posts.filter(p => p.endpoint === 'trial').length, failedEndpoint === 'trial' ? 1 : 0);
  }
});

test('CLI uses authenticated loopback, hides router input and omits raw responses from output', async t => {
  const key = 'synthetic-private-key'; const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, key: req.headers['x-admin-key'], body });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.method === 'GET' ? ready() : req.url.includes('action=start')
      ? { capture: { phase: 'recording', captureId: 'synthetic-capture' } }
      : { attempted: true, phase: 'queued', captureRecorded: true, frame: 'PRIVATE-FRAME', routerId, key, imei }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, ['gateway/scripts/trial-wifi-fence-single-router.js', '--send'], {
    cwd: path.join(__dirname, '../..'), env: { ...process.env, ADMIN_API_KEY: key,
      WIFI_HOME_OBSERVE_ENABLED: 'true', WIFI_HOME_PILOT_IMEI: imei, WIFI_HOME_HASH_KEY: hashKey,
      WIFI_HOME_ROUTER_HASH: config.wifiHomeRouterHash, HTTP_PORT: String(server.address().port) },
    stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  child.stdin.end(routerId + '\n');
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, output);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.key === key && !c.url.includes(routerId)));
  assert.equal(calls.filter(c => c.url.startsWith('/ops/wifi-fence-single-router-trial')).length, 1);
  assert.deepEqual(JSON.parse(calls[2].body), { experimental: true, captureId: 'synthetic-capture', routerId });
  for (const secret of [imei, routerId, hashKey, key, config.wifiHomeRouterHash, 'PRIVATE-FRAME']) {
    assert.ok(!output.includes(secret), output);
  }
  assert.match(output, /"settingsApplied": null/);
  assert.match(output, /No proven undo/);
});
