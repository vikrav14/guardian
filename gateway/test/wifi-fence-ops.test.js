'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const config = require('../src/config');
const { fingerprintRouter } = require('../src/wifi-home-observer');
const { handleOpsHttpRequest } = require('../src/http');
const { getWifiFenceValidation, observeWifiFencePacket, noteWifiFenceDownlink } = require('../src/wifi-fence-runtime');

function response() {
  return { statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test('capture endpoint requires strict admin, explicit pilot and a current capture ID; no provisioning path', async t => {
  const keys = ['adminApiKey', 'wifiHomeObserveEnabled', 'wifiHomePilotImei', 'wifiHomeRouterHash', 'wifiHomeHashKey'];
  const saved = Object.fromEntries(keys.map(key => [key, config[key]]));
  const env = { ADMIN_API_KEY: process.env.ADMIN_API_KEY, NODE_ENV: process.env.NODE_ENV };
  t.after(() => {
    Object.assign(config, saved);
    for (const [key, value] of Object.entries(env)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  });
  delete process.env.ADMIN_API_KEY; delete process.env.NODE_ENV;
  const imei = '359633100123456';
  const hashKey = 'ab'.repeat(32);
  Object.assign(config, { adminApiKey: '', wifiHomeObserveEnabled: true,
    wifiHomePilotImei: imei, wifiHomeHashKey: hashKey,
    wifiHomeRouterHash: fingerprintRouter({ imei, hashKey, routerId: '02:00:00:00:00:01' }) });
  const base = `http://localhost/ops/wifi-fence-validation?imei=${imei}`;
  async function call(method, query = '', key = config.adminApiKey) {
    const res = response();
    assert.equal(await handleOpsHttpRequest({ method, headers: key ? { 'x-admin-key': key } : {} },
      res, new URL(base + query)), true);
    return res;
  }
  assert.equal((await call('POST', '&action=start')).statusCode, 503);
  config.adminApiKey = 'synthetic-admin';
  assert.equal((await call('POST', '&action=start', '')).statusCode, 401);
  assert.equal((await call('GET', '', 'wrong')).statusCode, 401);
  const mismatch = response();
  await handleOpsHttpRequest({ method: 'POST', headers: { 'x-admin-key': config.adminApiKey } }, mismatch,
    new URL('http://localhost/ops/wifi-fence-validation?imei=359633100123457&action=start'));
  assert.equal(mismatch.statusCode, 409);
  assert.equal((await call('POST', '&action=apply')).statusCode, 400);
  assert.equal((await call('GET', '&action=start')).statusCode, 400);
  assert.equal((await call('POST', '&action=start&command=WIFIFENCE')).statusCode, 400);
  assert.equal((await call('GET')).body.capture, null);
  const began = await call('POST', '&action=start');
  assert.equal(began.statusCode, 200);
  assert.equal(began.headers['Cache-Control'], 'no-store');
  const id = began.body.capture.captureId;
  assert.equal((await call('POST', '&action=start')).statusCode, 409);
  assert.equal((await call('POST', '&action=stop&capture=old')).statusCode, 409);
  assert.equal((await call('POST', `&action=mark&capture=${id}&marker=at_home`)).statusCode, 200);
  const events = [{ type: 'heartbeat', imei }];
  observeWifiFencePacket({ command: 'LK', args: [] }, events);
  noteWifiFenceDownlink('CR', [{ session: { imei: '359633100123457' } }]);
  noteWifiFenceDownlink('CR', [{ session: { imei } }]);
  const report = await call('GET', '&timeline=1');
  assert.equal(report.body.capture.counts.heartbeats, 1);
  assert.equal(report.body.capture.counts.crHandoffs, 1);
  assert.equal(report.body.capture.timeline[0].kind, 'operator_marker');
  assert.equal(report.body.capture.homeClaim, false);
  assert.equal(report.body.liveProvisioningAvailable, false);
  for (const secret of [imei, hashKey, config.wifiHomeRouterHash, config.adminApiKey]) {
    assert.ok(!JSON.stringify(report.body).includes(secret));
  }
  assert.equal((await call('POST', `&action=stop&capture=${id}`)).body.capture.phase, 'stopped');
  assert.equal(getWifiFenceValidation().capture.phase, 'stopped');
});

test('packet and downlink diagnostics isolate failures instead of interrupting safety work', () => {
  const settings = { wifiHomeObserveEnabled: true, wifiHomePilotImei: '359633100123456',
    wifiHomeHashKey: 'ab'.repeat(32), wifiHomeRouterHash: 'cd'.repeat(32) };
  const sandbox = { module: { exports: {} }, require(name) {
    if (name === './config') return settings;
    if (name === './sessions') return { findSocketsForDevice: () => [] };
    if (name === './wifi-fence-validation') return { createWifiFenceCapture: () => ({
      snapshot: () => ({ captureId: 'synthetic', phase: 'recording' }),
      recordPacket: () => { throw new Error('diagnostic failure'); },
      recordCommand: () => { throw new Error('diagnostic failure'); },
    }) };
    throw new Error('Unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/wifi-fence-runtime.js'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  api.controlWifiFenceValidation({ action: 'start' });
  assert.doesNotThrow(() => api.observeWifiFencePacket({ command: 'AL_LTE' },
    [{ type: 'alarm', imei: settings.wifiHomePilotImei, alarmType: 'sos' }]));
  assert.doesNotThrow(() => api.noteWifiFenceDownlink('CR', [{ session: { imei: settings.wifiHomePilotImei } }]));
});
