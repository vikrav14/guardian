'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsAppMenu, readMenuAnswer, pagesOf, TTL_MS } = require('../src/whatsapp-menu');
const { evaluateSubscription } = require('../src/entitlements');
const { buildMetaInteractivePayload } = require('../src/whatsapp-meta');
const config = require('../src/config');

const flags = { activityStepsCustomerEnabled: true, careWellbeingCustomerEnabled: true };
function context(plan = 'family', devices = [{ imei: 'watch001', nickname: 'Alex' }]) {
  return { uid: 'owner', from: '+15555550101', linkedImeis: devices.map(device => device.imei), devices,
    entitlements: evaluateSubscription({ version: 1, managedBy: 'guardian_admin', plan, status: 'active' }) };
}
const rows = result => result.interactive.action.sections.flatMap(section => section.rows);
function pick(result, title) {
  const entry = result.interactive.type === 'list'
    ? rows(result).find(row => row.title === title)
    : result.interactive.action.buttons.map(button => button.reply).find(button => button.title === title);
  assert.ok(entry, `missing ${title}`);
  return { type: result.interactive.type === 'list' ? 'list_reply' : 'button_reply', id: entry.id };
}

test('Family has nine grouped options; Care adds summary and both fit actual Meta payload limits', async () => {
  for (const [plan, count] of [['family', 9], ['care', 10]]) {
    const menu = new WhatsAppMenu({ flags });
    const result = await menu.handle({ ctx: context(plan), text: 'Hi' });
    assert.equal(rows(result).length, count);
    assert.deepEqual(result.interactive.action.sections.map(section => section.title),
      ['Check now', 'Activity & wellbeing', 'Safety & care']);
    assert.equal(rows(result).some(row => row.title === 'Today’s summary'), plan === 'care');
    assert.match(result.reply, /Alex/);
    assert.equal(buildMetaInteractivePayload('+15555550101', result.interactive).type, 'interactive');
    assert.doesNotMatch(JSON.stringify(result.interactive), /watch001|owner|15555550101/);
  }
});

test('disabled hardware features are omitted and a previously issued option is rechecked', async () => {
  const switches = { ...flags };
  let reads = 0;
  const menu = new WhatsAppMenu({ flags: switches, readAnswer: async () => { reads++; return 'test'; } });
  const ctx = context();
  const initial = await menu.handle({ ctx, text: 'menu' });
  switches.activityStepsCustomerEnabled = false;
  switches.careWellbeingCustomerEnabled = false;
  const result = await menu.handle({ ctx, interaction: pick(initial, 'Steps & activity') });
  assert.match(result.reply, /not currently available/);
  assert.equal(rows(result).length, 7);
  assert.equal(reads, 0);
});

test('duplicate wearer names, pagination and follow-ups keep the exact selected IMEI', async () => {
  const devices = Array.from({ length: 19 }, (_, i) => ({ imei: `watch${String(i).padStart(4, '0')}`, nickname: 'Alex' }));
  const ctx = context('family', devices);
  const seen = [];
  const menu = new WhatsAppMenu({ flags, readAnswer: async input => { seen.push(input); return 'Scoped answer'; } });
  let result = await menu.handle({ ctx, text: 'menu' });
  assert.equal(seen.length, 0);
  for (let i = 0; i < 2; i++) {
    buildMetaInteractivePayload(ctx.from, result.interactive);
    result = await menu.handle({ ctx, interaction: pick(result, 'More wearers') });
  }
  const selected = rows(result)[1];
  assert.match(selected.description, /0017/);
  result = await menu.handle({ ctx, interaction: { type: 'list_reply', id: selected.id } });
  result = await menu.handle({ ctx, interaction: pick(result, 'Location') });
  assert.equal(seen[0].device.imei, 'watch0017');
  assert.ok(pick(result, 'Change wearer'));
  result = await menu.handle({ ctx, interaction: pick(result, 'Watch status') });
  assert.equal(seen[1].device.imei, 'watch0017');
  buildMetaInteractivePayload(ctx.from, result.interactive);
});

test('unknown, cross-sender, changed-account, expired and restarted IDs never execute actions', async () => {
  let time = 0;
  let reads = 0;
  const settings = { flags, now: () => time, readAnswer: async () => { reads++; return 'secret'; } };
  const menu = new WhatsAppMenu(settings);
  const ctx = context();
  const initial = await menu.handle({ ctx, text: 'hello' });
  const interaction = pick(initial, 'Location');
  for (const request of [
    { ctx, interaction: { type: 'list_reply', id: 'ACALL,1' } },
    { ctx: { ...ctx, from: '+15555550102' }, interaction },
    { ctx: { ...ctx, uid: 'other' }, interaction },
    { ctx, interaction: { type: 'fake', id: interaction.id } },
  ]) {
    const result = await menu.handle(request);
    assert.match(result.reply, /expired or is unavailable/);
  }
  time = TTL_MS + 1;
  assert.match((await menu.handle({ ctx, interaction })).reply, /expired/);
  const restarted = new WhatsAppMenu(settings);
  assert.match((await restarted.handle({ ctx, interaction })).reply, /expired/);
  assert.equal(reads, 0);
});

test('removal of a linked watch and plan downgrade block already-issued selections', async () => {
  let reads = 0;
  const menu = new WhatsAppMenu({ flags, readAnswer: async () => { reads++; return 'secret'; } });
  const ctx = context('care');
  const initial = await menu.handle({ ctx, text: 'menu' });
  const summary = pick(initial, 'Today’s summary');
  assert.match((await menu.handle({ ctx: context('family'), interaction: summary })).reply, /not currently available/);
  assert.equal((await menu.handle({ ctx: context('essential'), interaction: summary })).planRestricted, true);
  assert.equal((await menu.handle({ ctx: { ...ctx, uid: null, callerRole: 'emergency_contact' }, interaction: summary })).accessRestricted, true);
  assert.match((await menu.handle({ ctx: { ...ctx, linkedImeis: [] }, interaction: summary })).reply, /No linked watches/);
  assert.equal(reads, 0);
});

test('long answers retain all content and More rechecks access before fresh reads', async () => {
  const long = 'Saved information with evidence and uncertainty.\n'.repeat(70);
  assert.equal(pagesOf(long).join(''), long);
  let reads = 0;
  const menu = new WhatsAppMenu({ flags, readAnswer: async () => { reads++; return long; } });
  const ctx = context();
  const initial = await menu.handle({ ctx, text: 'menu' });
  let result = await menu.handle({ ctx, interaction: pick(initial, 'Recent alerts') });
  const more = pick(result, 'More');
  buildMetaInteractivePayload(ctx.from, result.interactive);
  result = await menu.handle({ ctx, interaction: more });
  assert.match(result.reply, /Part 2 of/);
  assert.equal(reads, 2);
  buildMetaInteractivePayload(ctx.from, result.interactive);
  await menu.handle({ ctx: context('essential'), interaction: more });
  assert.equal(reads, 2);
});

test('wellbeing entry respects actual consent reader and never queries readings without consent', async () => {
  const previous = config.careWellbeingCustomerEnabled;
  config.careWellbeingCustomerEnabled = true;
  let reads = 0;
  try {
    const db = { collection(name) {
      assert.equal(name, 'wellbeingConsents');
      return { doc(imei) {
        assert.equal(imei, 'watch001');
        return { async get() { reads++; return { exists: false }; } };
      } };
    } };
    const ctx = context();
    const reply = await readMenuAnswer({ ctx, db, device: ctx.devices[0], action: 'wellbeing' });
    assert.match(reply, /Current wearer consent/);
    assert.equal(reads, 1);
  } finally { config.careWellbeingCustomerEnabled = previous; }
});

test('safe zones and reminders read only the exact wearer and give no delivery or presence guarantee', async () => {
  const queries = [];
  const db = { collection(name) {
    const query = { where(field, op, value) { queries.push([name, field, op, value]); return query; },
      limit(value) { assert.equal(value, 51); return query; },
      async get() { return { docs: [
        { data: () => ({ imei: 'watch001', active: true, name: 'Home', radiusMeters: 150,
          text: 'Medicine', time: '20:00', frequency: 3, deliveryStatus: 'pending' }) },
        { data: () => ({ imei: 'other', active: true, name: 'Secret', text: 'Private' }) },
      ] }; },
    }; return query;
  } };
  const ctx = context();
  for (const action of ['zones', 'reminders']) {
    const result = await readMenuAnswer({ db, ctx, device: ctx.devices[0], action });
    assert.doesNotMatch(result, /Secret|Private/);
    assert.match(result, action === 'zones' ? /do not confirm.*inside/ : /delivery not confirmed/);
  }
  assert.deepEqual(queries.map(query => query.slice(1)), Array(2).fill(['imei', '==', 'watch001']));
});

test('typed questions and confirmation replies keep their existing route; menu taps do not execute commands', async () => {
  const menu = new WhatsAppMenu({ flags });
  const ctx = context();
  for (const text of ['Where is Alex?', 'YES', 'CANCEL', 'SOS', 'Remind Alex at 20:00']) {
    assert.equal(await menu.handle({ ctx, text }), null);
  }
  const initial = await menu.handle({ ctx, text: 'menu' });
  const result = await menu.handle({ ctx, text: 'YES', interaction: { type: 'button_reply', id: 'forged' } });
  assert.match(result.reply, /expired/);
  assert.ok(rows(initial).every(row => !/SOS|ring|call/i.test(row.title)));
});
