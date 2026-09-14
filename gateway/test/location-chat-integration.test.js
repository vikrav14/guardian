'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');

const httpPath = path.join(__dirname, '../src/http.js');
const source = fs.readFileSync(httpPath, 'utf8');
const sourceRequire = createRequire(httpPath);
const realTools = sourceRequire('./assistant/tools');
const from = '+15555550101';
const contactPhone = '+15555550102';

function watch(nickname = 'Test wearer', lat = -20.25) {
  return { nickname,
    lastSatelliteLocation: { lat, lng: 57.5, source: 'gps', gpsValid: true,
      recordedAt: new Date(Date.now() - 7200000), placeLabel: 'GPS test area' },
    location: { lat: -20.26, lng: 57.51, source: 'wifi', accuracyMeters: 600,
      recordedAt: new Date(Date.now() - 60000), placeLabel: 'Network test area' },
    lastHeartbeatAt: new Date(), batteryPercent: 80 };
}

// Execute the real HTTP handler, caller resolution, entitlement checks, wearer
// controller and location tool. Only external I/O and audit sinks are replaced.
function chatHarness({ plan = 'family', status = 'active', devices = { A: watch() },
  linkedImeis = Object.keys(devices), failRead = false, failTool = false } = {}) {
  const calls = { tools: [], reads: [], audit: [], provider: 0, fallback: 0 };
  const tables = {
    users: { guardian: { phone: from, linkedImeis,
      emergencyContacts: [{ phone: contactPhone, name: 'Test contact' }] } },
    devices,
    serviceSubscriptions: { guardian: { version: 1, managedBy: 'guardian_admin', plan, status } },
  };
  const db = { collection(name) {
    assert.ok(tables[name], `unexpected collection ${name}`);
    return {
      async get() {
        if (failRead) throw new Error('Synthetic read failure');
        calls.reads.push(name);
        return { docs: Object.entries(tables[name]).map(([id, data]) => ({ id, data: () => data })) };
      },
      doc(id) { return { async get() {
        calls.reads.push(`${name}/${id}`);
        const data = tables[name][id];
        return { exists: Boolean(data), data: () => data };
      } }; },
    };
  } };
  const realModules = new Set(['http', 'url', 'crypto', 'fs', 'path',
    './meta-webhook', './conversation-controller', './entitlements',
    './intent-classifier', './whatsapp-policy', './safe-actions', './location-reply']);
  const audit = Object.fromEntries(['recordStart', 'recordAuth', 'recordIntent', 'recordResponse', 'recordError']
    .map(method => [method, async value => calls.audit.push({ method, ...value })]));
  const sandbox = {
    module: { exports: {} }, console: { log() {}, error() {}, warn() {} },
    auditSink: audit,
    provider: { async complete() { calls.provider++; throw new Error('Provider must not be used'); } },
    require(name) {
      if (name === './firestore') return { getDb: () => db };
      if (name === './assistant/tools') return { ...realTools, async runTool(...args) {
        calls.tools.push({ name: args[2], input: args[3] });
        if (failTool) throw new Error('Synthetic tool failure');
        return realTools.runTool(...args);
      } };
      if (name === './assistant/claude') return { async answerWithAssistant() {
        calls.fallback++; throw new Error('Fallback must not be used');
      } };
      if (name === './metrics') return { trackFallback() {}, trackIntent() {} };
      return realModules.has(name) ? sourceRequire(name) : {};
    },
  };
  vm.runInNewContext(`${source}\nauditLog = auditSink; llmProvider = provider;
    idempotencyStore = { isSeen: () => false, store() {} };`, sandbox, { filename: httpPath });
  return { calls, chat: text => sandbox.module.exports.handleChat({ from, text }),
    chatFrom: (sender, text) => sandbox.module.exports.handleChat({ from: sender, text }) };
}

test('actual location? route retains GPS and renders uncertainty without any model call', async () => {
  const run = chatHarness();
  const result = await run.chat('location?');
  assert.equal(result.deterministic, true);
  assert.match(result.reply, /Last known GPS location for Test wearer/);
  assert.match(result.reply, /Current position unconfirmed/);
  assert.match(result.reply, /Newer approximate Wi-Fi reading/);
  assert.match(result.reply, /\?q=-20.25,57.5/);
  assert.doesNotMatch(result.reply, /Network test area|is at|Last updated/);
  assert.equal(run.calls.tools.length, 1);
  assert.equal(run.calls.tools[0].input.imei, 'A');
  assert.equal(run.calls.provider + run.calls.fallback, 0);
  assert.ok(run.calls.audit.some(event => event.method === 'recordResponse'));
});

test('actual authenticated location route uses fresh Home evidence and falls back on expiry', async () => {
  const device = watch();
  const now = Date.now();
  device.homeWifiPresence = { version: 1, policy: 'enrolled_home_radio_v1', pilot: true,
    state: 'matched', source: 'home_wifi', observedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    anchor: { geofenceId: 'synthetic-home', lat: -20.15, lng: 57.15 } };
  const run = chatHarness({ devices: { A: device } });
  const home = await run.chat('location?');
  assert.equal(home.deterministic, true);
  assert.match(home.reply, /Home Wi-Fi detected for Test wearer/);
  assert.match(home.reply, /at or near your saved Home location/);
  assert.match(home.reply, /Last GPS fix retained separately/);
  assert.match(home.reply, /\?q=-20.15,57.15/);
  assert.equal((home.reply.match(/https:/g) || []).length, 1);
  device.homeWifiPresence.expiresAt = new Date(now - 1).toISOString();
  const expired = await run.chat('location?');
  assert.match(expired.reply, /Last known GPS location for Test wearer/);
  assert.match(expired.reply, /\?q=-20.25,57.5/);
  assert.doesNotMatch(expired.reply, /Home Wi-Fi detected/);
  assert.equal(run.calls.provider + run.calls.fallback, 0);
});

test('multiple wearers require selection and the follow-up reads the selected linked watch', async () => {
  const run = chatHarness({ devices: { A: watch('Alex'), B: watch('Sam', -20.24) } });
  const question = await run.chat('location?');
  assert.match(question.reply, /Who would you like me to check—Alex or Sam/);
  assert.equal(run.calls.tools.length, 0);
  const reply = await run.chat('Sam');
  assert.match(reply.reply, /GPS location for Sam/);
  assert.match(reply.reply, /\?q=-20.24,57.5/);
  assert.equal(run.calls.tools[0].input.imei, 'B');
  assert.equal(run.calls.provider + run.calls.fallback, 0);
});

test('unlinked devices are never read and emergency contacts cannot query a location', async () => {
  const run = chatHarness({ devices: { A: watch(), B: watch('Private wearer', -20.24) }, linkedImeis: ['A'] });
  await run.chat('location?');
  assert.ok(!run.calls.reads.includes('devices/B'));
  const restricted = await run.chatFrom(contactPhone, 'location?');
  assert.equal(restricted.accessRestricted, true);
  assert.match(restricted.reply, /does not grant access to private location/);
  assert.doesNotMatch(restricted.reply, /maps\.google/);
  const unknown = await run.chatFrom('+15555550103', 'location?');
  assert.equal(unknown.accessRestricted, true);
  assert.equal(run.calls.tools.length, 1);
});

test('plan and inactive-service gates still run before the location tool', async () => {
  for (const options of [{ plan: 'essential' }, { status: 'expired' }]) {
    const run = chatHarness(options);
    const result = await run.chat('location?');
    assert.equal(result.planRestricted, true);
    assert.doesNotMatch(result.reply, /maps\.google/);
    assert.equal(run.calls.tools.length, 0);
    assert.equal(run.calls.provider + run.calls.fallback, 0);
  }
});

test('missing watch and read/tool failures return no invented map or model answer', async () => {
  for (const options of [{ devices: {} }, { failRead: true }, { failTool: true }]) {
    const run = chatHarness(options);
    const result = await run.chat('location?');
    assert.match(result.reply, /could not retrieve|encountered an error/);
    assert.doesNotMatch(result.reply, /maps\.google|is at|GPS location/);
    assert.equal(run.calls.provider + run.calls.fallback, 0);
  }
});
