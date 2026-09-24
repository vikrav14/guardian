'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { LINK_LIFETIME_MS, phone, issueWatchCallLink, resolveWatchCallLink,
  prepareRecipientCallLink, dynamicCallsEnabled } = require('../src/watch-call-links');
const { handleWatchCallLink } = require('../src/watch-call-link-http');
const { evaluateSubscription } = require('../src/entitlements');
const { notifyEmergencyContacts } = require('../src/notify');
const { prepareSosWhatsApp } = require('../src/sos-whatsapp');
const { prepareFallWhatsApp } = require('../src/fall-whatsapp');
const { buildSosLocationSnapshot } = require('../src/sos-location-snapshot');
const { buildFallLocationSnapshot } = require('../src/fall-location-snapshot');
const config = require('../src/config');

function fixture(type = 'sos', plan = 'family') {
  const now = new Date();
  const imei = '861397000000000';
  const device = { nickname: 'Alex', simNumber: '+23050000001', online: true,
    location: { lat: -20, lng: 57, source: 'gps', recordedAt: now, gpsValid: true } };
  const subscription = { version: 1, managedBy: 'guardian_admin', status: 'active', plan };
  const user = { linkedImeis: [imei], emergencyContacts: [
    { name: 'Primary', phone: '+23050000002', isPrimary: true },
    { name: 'Second', phone: '+23050000003', whatsapp: '+23050000004' },
  ] };
  const contact = { ...user.emergencyContacts[0], guardianUid: 'owner',
    entitlements: evaluateSubscription(subscription, { ownerUid: 'owner', now }) };
  const alert = { imei, type, createdAt: now, eventAt: now,
    ...(type === 'sos' ? { sosLocationSnapshot: buildSosLocationSnapshot(device, { now }) }
      : { payload: { locationSnapshot: buildFallLocationSnapshot(device, { now }) } }),
  };
  const docs = new Map(Object.entries({ [`devices/${imei}`]: device, 'users/owner': user,
    'serviceSubscriptions/owner': subscription, 'alerts/alert1': alert }));
  const reads = [], writes = [], logs = [];
  const db = { collection(name) { return {
    doc(id) { return {
      async get() { reads.push(`${name}/${id}`); return { exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) }; },
      async create(value) { const key = `${name}/${id}`; assert.ok(!docs.has(key)); docs.set(key, value); writes.push(key); },
    }; },
    where() { assert.equal(name, 'users'); return { async get() { return { docs: [{ id: 'owner', data: () => user }] }; } }; },
    async add(value) { assert.equal(name, 'notificationLogs'); logs.push(value); return { id: 'log1' }; },
  }; } };
  return { db, now, imei, alertId: 'alert1', alert, device, user, contact, docs, reads, writes, logs, subscription };
}

const settings = { watchCallPublicOrigin: 'https://guardian.example',
  metaWhatsAppSosDynamicCallEnabled: true, metaWhatsAppFallDynamicCallEnabled: true };
const digest = token => crypto.createHash('sha256').update(token).digest('hex');

test('a link resolves only its original watch, uses an opaque token and stores no raw phone/token', async () => {
  const f = fixture();
  const token = await issueWatchCallLink(f);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await resolveWatchCallLink(f.db, token), { number: f.device.simNumber, name: 'Alex' });
  assert.equal(f.writes.length, 1);
  const record = f.docs.get(`watchCallLinks/${digest(token)}`);
  for (const secret of [token, f.device.simNumber, f.contact.phone]) assert.ok(!JSON.stringify(record).includes(secret));
  assert.equal(record.expiresAt.getTime(), f.alert.createdAt.getTime() + LINK_LIFETIME_MS);
  const other = fixture();
  other.device.simNumber = '+23050000009';
  const otherToken = await issueWatchCallLink(other);
  assert.notEqual(token, otherToken);
  assert.equal(await resolveWatchCallLink(other.db, token), null);
  assert.equal((await resolveWatchCallLink(other.db, otherToken)).number, '+23050000009');
});

for (const [reason, change] of Object.entries({
  'SIM replaced': f => { f.device.simNumber = '+23050000009'; },
  'device removed': f => f.docs.delete(`devices/${f.imei}`),
  'user unlinked': f => { f.user.linkedImeis = []; },
  'contact removed': f => { f.user.emergencyContacts = []; },
  'contact WhatsApp changed': f => { f.user.emergencyContacts[0].whatsapp = '+23050000009'; },
  'service expired': f => { f.subscription.status = 'expired'; },
  'owner changed': f => { f.user.serviceOwnerUid = 'different-owner'; },
  'alert removed': f => f.docs.delete('alerts/alert1'),
  'alert belongs to another watch': f => { f.alert.imei = '861397000000001'; },
  'alert type changed': f => { f.alert.type = 'other'; },
  'explicit revocation': f => { f.docs.get(f.writes[0]).revokedAt = new Date(); },
})) test(`old link becomes unavailable when ${reason}`, async () => {
  const f = fixture(); const token = await issueWatchCallLink(f); change(f);
  assert.equal(await resolveWatchCallLink(f.db, token), null);
});

test('expiry is enforced without cleanup; late alerts cannot mint fresh links', async () => {
  const f = fixture(); const token = await issueWatchCallLink(f);
  const now = new Date(f.now.getTime() + LINK_LIFETIME_MS);
  assert.equal(await resolveWatchCallLink(f.db, token, { now }), null);
  assert.equal(await issueWatchCallLink({ ...f, now }), null);
  assert.equal(f.writes.length, 1);
  f.alert.createdAt = new Date(f.now.getTime() + 120000);
  assert.equal(await issueWatchCallLink(f), null);
});

test('inherited access requires backend-verified family membership on every open', async () => {
  const f = fixture();
  f.user.serviceOwnerUid = 'payer';
  f.contact.entitlements = { ...f.contact.entitlements, ownerUid: 'payer' };
  const payer = { memberUids: ['owner'] };
  f.docs.set('users/payer', payer);
  f.docs.set('serviceSubscriptions/payer', f.subscription);
  const token = await issueWatchCallLink(f);
  assert.equal((await resolveWatchCallLink(f.db, token)).number, f.device.simNumber);
  payer.memberUids = [];
  payer.familyMembers = [{ uid: 'owner' }];
  assert.equal(await resolveWatchCallLink(f.db, token), null);
});

test('malformed tokens do not query storage and phone parsing rejects dial-string injection', async () => {
  const f = fixture();
  for (const token of ['unavailable', '', '../owner', 'x'.repeat(500), 'x'.repeat(42) + '/']) {
    assert.equal(await resolveWatchCallLink(f.db, token), null);
  }
  assert.equal(f.reads.length, 0);
  for (const value of ['+23050000001;123', '+23050000001#', '+23050000001,123', 'javascript:1', '<script>']) assert.equal(phone(value), null);
  assert.equal(phone('0023050000001'), '+23050000001');
  assert.equal(phone('50000001'), '+23050000001');
});

test('HTTPS origin and per-family gates are required', () => {
  for (const origin of ['', 'http://guardian.example', 'https://a:b@guardian.example', 'https://guardian.example/path', 'https://guardian.example/?q=x']) {
    assert.equal(dynamicCallsEnabled('sos', { ...settings, watchCallPublicOrigin: origin }), false);
  }
  assert.equal(dynamicCallsEnabled('sos', { ...settings, metaWhatsAppSosDynamicCallEnabled: false }), false);
  assert.equal(dynamicCallsEnabled('fall', { ...settings, metaWhatsAppSosDynamicCallEnabled: false }), true);
});

test('page is escaped, private, preview-safe and never writes or changes watch mode', async () => {
  const f = fixture(); const token = await issueWatchCallLink(f);
  f.device.nickname = '<script>alert(1)</script>';
  const writesBefore = f.writes.length;
  const server = http.createServer((req, res) => handleWatchCallLink(req, res,
    { db: f.db, pathname: new URL(req.url, 'http://localhost').pathname }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/call-watch/${token}`;
  try {
    for (let i = 0; i < 2; i++) {
      const result = await fetch(url + '?imei=another&phone=%2B23050000009');
      const html = await result.text();
      assert.equal(result.status, 200);
      assert.match(html, /href="tel:\+23050000001"/);
      assert.doesNotMatch(html, /<script|50000009|window\.location|http-equiv="refresh"/);
      assert.match(html, /&lt;script&gt;/);
      assert.match(result.headers.get('cache-control'), /no-store/);
      assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
      assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    }
    const before = f.reads.length;
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal(f.reads.length, before);
    assert.equal((await fetch(url.replace(token, 'unavailable'))).status, 410);
    f.user.emergencyContacts = [];
    const revoked = await fetch(url);
    assert.equal(revoked.status, 410);
    assert.doesNotMatch(await revoked.text(), /50000001|Alex/);
    assert.equal(f.writes.length, writesBefore);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

for (const type of ['sos', 'fall']) for (const state of ['fresh', 'last_known', 'unavailable']) {
  test(`${type}/${state} preserves all body facts and map while adding per-recipient call at index 0`, async () => {
    const f = fixture(type);
    const snapshot = type === 'sos' ? f.alert.sosLocationSnapshot : f.alert.payload.locationSnapshot;
    snapshot.state = state;
    if (state === 'unavailable') snapshot.location = null;
    if (state === 'last_known') {
      snapshot.location.recordedAt = new Date(f.now.getTime() - 20 * 60000);
      snapshot.ageSeconds = 20 * 60;
    }
    const prepare = type === 'sos' ? prepareSosWhatsApp : prepareFallWhatsApp;
    const original = await prepare({ device: f.device, alert: f.alert, now: f.now });
    const one = await prepareRecipientCallLink(original, f, { settings });
    const two = await prepareRecipientCallLink(original, { ...f, contact: { ...f.contact,
      ...f.user.emergencyContacts[1] } }, { settings });
    assert.deepEqual(one.plan.bodyParameters, original.plan.bodyParameters);
    assert.match(one.plan.templateName, /_v2$/);
    assert.equal(one.plan.components[1].index, '0');
    assert.notEqual(one.plan.components[1].parameters[0].text, two.plan.components[1].parameters[0].text);
    assert.equal(original.plan.components.length, state === 'unavailable' ? 1 : 2);
    assert.equal(one.plan.components.length, state === 'unavailable' ? 2 : 3);
    if (state !== 'unavailable') {
      assert.equal(one.plan.components[2].index, '1');
      assert.deepEqual(one.plan.components[2].parameters, original.plan.components[1].parameters);
    }
  });
}

test('missing SIM, denied issuance, database failure and timeout retain the alert with unavailable link', async () => {
  const original = await prepareSosWhatsApp({});
  for (const patch of [
    { device: { simNumber: '' } }, { alertId: null },
    { db: { collection() { throw new Error('database secret'); } } },
    { db: { collection() { return { doc() { return { get() { return new Promise(() => {}); } }; } }; } } },
  ]) {
    const result = await prepareRecipientCallLink(original, { ...fixture(), ...patch }, { settings, timeoutMs: 10 });
    assert.equal(result.plan.components[1].parameters[0].text, 'unavailable');
    assert.deepEqual(result.plan.bodyParameters, original.plan.bodyParameters);
  }
});

for (const [type, plan, recipients] of [['sos', 'essential', 1], ['sos', 'family', 2], ['fall', 'family', 2]]) {
  test(`notification integration ${type}/${plan}: correct fanout, unique links, provider reflection redacted`, async () => {
    const f = fixture(type, plan);
    const previous = { ...config }; const previousFetch = global.fetch;
    const requests = [];
    Object.assign(config, settings, { notifySms: false, notifyWhatsApp: true,
      metaWhatsAppAccessToken: 'test-token', metaWhatsAppPhoneNumberId: '123456' });
    global.fetch = async (url, options) => {
      const payload = JSON.parse(options.body); requests.push(payload);
      const token = payload.template.components[1].parameters[0].text;
      return { ok: false, status: 400, async json() { return { error: { code: 100, message: `Invalid parameter ${token}` } }; } };
    };
    try {
      await notifyEmergencyContacts(f.db, f.imei, f.alert, { alertId: f.alertId });
      assert.equal(requests.length, recipients);
      assert.equal(f.writes.length, recipients);
      const tokens = requests.map(r => r.template.components[1].parameters[0].text);
      assert.equal(new Set(tokens).size, recipients);
      assert.equal(requests[0].to, '23050000002');
      if (recipients === 2) assert.equal(requests[1].to, '23050000004');
      for (const token of tokens) {
        assert.notEqual(token, 'unavailable');
        assert.ok(!JSON.stringify(f.logs).includes(token));
        assert.equal((await resolveWatchCallLink(f.db, token)).number, f.device.simNumber);
      }
    } finally { Object.assign(config, previous); global.fetch = previousFetch; }
  });
}

test('a missing SIM still delivers the dynamic alert and frozen map without a dangling token', async () => {
  const f = fixture('fall'); f.device.simNumber = '';
  const previous = { ...config }; const previousFetch = global.fetch;
  const requests = [];
  Object.assign(config, settings, { notifySms: false, notifyWhatsApp: true,
    metaWhatsAppAccessToken: 'test-token', metaWhatsAppPhoneNumberId: '123456' });
  global.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, async json() { return { messages: [{ id: 'wamid.test' }] }; } };
  };
  try {
    const result = await notifyEmergencyContacts(f.db, f.imei, f.alert, { alertId: f.alertId });
    assert.equal(requests.length, 2);
    assert.ok(result.results.every(entry => entry.channels.whatsapp.ok));
    assert.equal(f.writes.length, 0);
    for (const request of requests) {
      assert.equal(request.template.components[1].parameters[0].text, 'unavailable');
      assert.equal(request.template.components[2].parameters[0].text, '-20,57');
    }
  } finally { Object.assign(config, previous); global.fetch = previousFetch; }
});
