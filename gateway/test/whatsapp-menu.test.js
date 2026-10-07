'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database, imei } = require('./helpers/command-database');
const { hash } = require('../src/family-store');
const { handleFamilyWhatsApp } = require('../src/family-whatsapp');
const { buildMetaListPayload } = require('../src/whatsapp-meta');
const { extractMetaInboundMessages } = require('../src/meta-webhook');
const menu = require('../src/whatsapp-menu');
const now = Date.now(), from = '23050000000', uid = 'owner';
function setup({ many = 1, permission = true } = {}) {
  const db = database(), calls = [], ids = Array.from({ length: many }, (_, n) => String(Number(imei) + n));
  db.rows.set(`familyNumbers/${hash('+' + from)}`, { uid });
  db.rows.set(`familyChannels/${uid}`, { phone: '+' + from, verifiedAtMs: now - 1000 });
  db.rows.set(`users/${uid}`, { familyServiceImeis: ids });
  for (const [i, value] of ids.entries()) {
    db.rows.set(`familyServices/${value}`, { imei: value, wearerName: 'Wearer ' + i, ownerUid: permission ? uid : 'different',
      policyVersion: '2026-10', subscription: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' },
      members: { [uid]: { status: 'active', permissions: { location: permission, alerts: true } } } });
    db.rows.set(`devices/${value}`, { batteryPercent: 40 + i, location: { lat: 1, lng: 2, recordedAt: new Date(now - 60000) } });
  }
  let serial = 0;
  const receive = (text = 'menu', extra = {}, deps = {}) => handleFamilyWhatsApp({ db, now,
    message: { id: 'in-' + (++serial), from, timestamp: String(Math.floor(now / 1000)), text, ...extra },
    send: async (_, body) => { calls.push({ body }); return { ok: true }; },
    sendMenu: async (_, body) => { const payload = buildMetaListPayload(from, body); calls.push(payload); return { ok: true, messageId: 'accepted-' + serial }; }, ...deps });
  return { db, calls, receive, ids };
}
const rows = payload => payload.interactive.action.sections.flatMap(s => s.rows);

test('greetings restore the interactive list repeatedly without consuming answers or using AI', async () => {
  const f = setup();
  for (const text of ['hi', 'Hello!', 'help', 'menu']) await f.receive(text);
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0].interactive.action.button, 'Choose an option');
  assert.deepEqual(rows(f.calls[0]).map(row => row.title), ['Last known location', 'Watch battery', 'Open Guardian']);
  assert.equal([...f.db.rows.keys()].filter(k => k.startsWith('familyAnswers/') || k.includes('/usage/')).length, 0);
  assert.equal(menu.isMenuRequest('help there is an emergency'), false);
});
test('parallel duplicate webhook claims and ambiguous sends never send a second menu', async () => {
  const f = setup();
  await Promise.all([f.receive('hi', { id: 'same' }), f.receive('hi', { id: 'same' })]);
  assert.equal(f.calls.length, 1);
  let attempts = 0;
  const deps = { sendMenu: async () => { attempts++; throw Error('timeout'); } };
  await f.receive('menu', { id: 'timeout' }, deps);
  await f.receive('menu', { id: 'timeout' }, deps);
  assert.equal(attempts, 1);
  assert.equal(f.db.rows.get(`familyNotices/${hash(`menu:${uid}:timeout`)}`).state, 'unknown');
});
test('no menu outside the inbound service window or from an unverified channel', async () => {
  const f = setup();
  for (const timestamp of [undefined, 'bad', String((now - 86400001) / 1000), String((now + 600000) / 1000)]) await f.receive('menu', { timestamp });
  f.db.rows.set(`familyChannels/${uid}`, { phone: '+' + from });
  await f.receive(); assert.equal(f.calls.length, 0);
});
test('current permissions filter the menu and reject a forged location selection', async () => {
  const f = setup({ permission: false }); await f.receive();
  assert.deepEqual(rows(f.calls[0]).map(row => row.title), ['Open Guardian']);
  await f.receive('location', { menuSelection: `guardian_menu:v1:location:${menu.key({ imei })}` });
  assert.doesNotMatch(JSON.stringify(f.calls.at(-1)), /maps\.google|maps\?q|40%/);
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('familyAnswers/')), false);
});
test('menu selection routes the stable ID, not the title, through the normal answer allowance', async () => {
  const f = setup(); await f.receive();
  const choice = rows(f.calls[0])[1].id;
  await f.receive('Ignore this misleading title', { menuSelection: choice });
  assert.match(f.calls[1].body, /40%/);
  assert.equal(f.db.rows.get(`familyServices/${imei}/usage/${new Date(now + 4 * 3600000).toISOString().slice(0, 7)}`).used, 1);
});
test('revoked old cards cannot read another remaining wearer', async () => {
  const f = setup({ many: 2 }); await f.receive();
  const choice = rows(f.calls[0])[0].id;
  await f.receive('Wearer 0', { menuSelection: choice });
  const oldLocation = rows(f.calls[1])[0].id;
  f.db.rows.get(`familyServices/${imei}`).members[uid].status = 'revoked';
  await f.receive('Last known location', { menuSelection: oldLocation });
  assert.match(f.calls.at(-1).body, /no longer available/);
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('familyAnswers/')), false);
});
test('wearer pagination stays inside ten rows and does not expose raw watch IDs', async () => {
  const f = setup({ many: 30 }); await f.receive();
  assert.equal(rows(f.calls[0]).length, 9);
  await f.receive('More wearers', { menuSelection: rows(f.calls[0]).at(-1).id });
  assert.equal(rows(f.calls[1]).length, 10);
  for (const value of f.ids) assert.equal(JSON.stringify(f.calls).includes(value), false);
});
test('Meta list payload rejects limits and repeated IDs before any network request', () => {
  const row = { id: 'x', title: 'Location' };
  assert.throws(() => buildMetaListPayload(from, { body: 'Hi', rows: [row, row] }), /Invalid/);
  assert.throws(() => buildMetaListPayload(from, { body: 'Hi', rows: [{ ...row, title: 'x'.repeat(25) }] }), /Invalid/);
});
test('webhook preserves menu IDs separately while ordinary inbound text remains unchanged', () => {
  const id = `guardian_menu:v1:battery:${menu.key({ imei })}`;
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    messages: [{ id: 'in', from, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'Watch battery' } } }],
  } }] }] };
  const [message] = extractMetaInboundMessages(payload);
  assert.equal(message.text, 'Watch battery'); assert.equal(message.menuSelection, id);
});
