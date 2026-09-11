'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('../src/config');
const { handleOpsHttpRequest } = require('../src/http');
const { createWifiHomeObserver, fingerprintRouter } = require('../src/wifi-home-observer');

function response() {
  return { statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.statusCode = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test('live Home diagnostics reject dev-open, missing/wrong keys and a mismatched pilot', async t => {
  const originals = { key: config.adminApiKey, pilot: config.wifiHomePilotImei,
    envKey: process.env.ADMIN_API_KEY, nodeEnv: process.env.NODE_ENV };
  t.after(() => {
    config.adminApiKey = originals.key; config.wifiHomePilotImei = originals.pilot;
    for (const [key, value] of [['ADMIN_API_KEY', originals.envKey], ['NODE_ENV', originals.nodeEnv]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  });
  delete process.env.ADMIN_API_KEY; delete process.env.NODE_ENV;
  config.adminApiKey = '';
  config.wifiHomePilotImei = '359633100123456';
  const url = new URL('http://localhost/ops/wifi-home');
  const open = response();
  assert.equal(await handleOpsHttpRequest({ method: 'GET', headers: {} }, open, url), true);
  assert.equal(open.statusCode, 503);
  config.adminApiKey = 'synthetic-key';
  for (const headers of [{}, { 'x-admin-key': 'wrong' }]) {
    const denied = response();
    await handleOpsHttpRequest({ method: 'GET', headers }, denied, url);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.body.publisher, undefined);
  }
  const mismatch = response();
  await handleOpsHttpRequest({ method: 'GET', headers: { 'x-admin-key': config.adminApiKey } },
    mismatch, new URL('http://localhost/ops/wifi-home?imei=359633100123457'));
  assert.equal(mismatch.statusCode, 409);
  const allowed = response();
  await handleOpsHttpRequest({ method: 'GET', headers: { 'x-admin-key': config.adminApiKey } }, allowed, url);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['Cache-Control'], 'no-store');
  assert.equal(allowed.body.version, 1);
  const text = JSON.stringify(allowed.body);
  assert.ok(!text.includes(config.wifiHomePilotImei));
  assert.ok(!text.includes(config.adminApiKey));
  const post = response();
  assert.equal(await handleOpsHttpRequest({ method: 'POST', headers: {} }, post, url), false);
  assert.equal(post.statusCode, null, 'diagnostic GET must not grow a command path');
});

test('runtime reports the actual observer and publisher while excluding watch/router identifiers', () => {
  const imei = '359633100123456'; const routerId = '02:00:00:00:00:01'; const hashKey = 'ab'.repeat(32);
  const hash = fingerprintRouter({ imei, routerId, hashKey });
  const settings = { wifiHomeObserveEnabled: true, wifiHomeDisplayPilotEnabled: true,
    wifiHomePilotImei: imei, wifiHomeHashKey: hashKey, wifiHomeRouterHash: hash };
  let readObservation; let starts = 0;
  const sandbox = { module: { exports: {} }, console: { log() {} }, require(name) {
    if (name === './config') return settings;
    if (name === './wifi-home-observer') return { createWifiHomeObserver };
    if (name === './sessions') return { findSocketsForDevice(target) {
      assert.equal(target, imei); return [{ socket: { destroyed: false } }];
    } };
    if (name === './wifi-home-display') return { startHomeWifiPublisher(options) {
      starts++; readObservation = options.readObservation;
      const stop = () => {};
      stop.getStatus = () => ({ active: true, homeBindingReady: true, publishedHomeFresh: false });
      return stop;
    } };
    throw new Error('Unexpected runtime dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/wifi-home-runtime.js'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  api.startWifiHomeDisplayPilot({});
  const start = Date.parse('2026-09-01T12:00:00Z');
  for (const offset of [0, 10_000, 20_000]) {
    api.observeWifiHomeEvent({ imei, type: 'location', gpsValid: false, accuracySource: 'wifi',
      location: { recordedAt: new Date(start + offset), gpsValid: false, source: 'wifi' },
      wifiAccessPoints: [{ macAddress: routerId, signalStrength: -68 }],
    }, new Date(start + offset));
  }
  const value = api.getWifiHomeRuntimeStatus(start + 20_000);
  assert.equal(starts, 1);
  assert.equal(value.sessionConnected, true);
  assert.equal(value.observer.matchState, 'matched');
  assert.equal(value.observer.observedAt, readObservation(start + 20_000).observedAt);
  assert.equal(value.publisher.publishedHomeFresh, false, 'a radio match is not a published Home');
  for (const secret of [imei, routerId, hash, hashKey]) assert.ok(!JSON.stringify(value).includes(secret));
});
