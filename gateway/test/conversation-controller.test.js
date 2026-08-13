const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationController } = require('../src/conversation-controller');

const devices = [
  { imei: 'A', nickname: 'Jesh' },
  { imei: 'B', nickname: 'Mum' },
];

test('courtesy reply is deterministic and concise', () => {
  const controller = new ConversationController();
  assert.equal(controller.deterministicReply('+2301', 'thx').reply, "You're welcome.");
});

test('combined courtesy phrases remain deterministic', () => {
  const controller = new ConversationController();
  for (const text of [
    'ok thx',
    'okay thanks',
    'alright, thank you',
    'thanks Guardian',
    'merci Guardian',
    'thx ok',
  ]) {
    const result = controller.deterministicReply('+2301', text);
    assert.equal(result?.reason, 'courtesy_acknowledgement', text);
    assert.equal(result?.reply, "You're welcome.", text);
  }
});

test('courtesy words do not swallow a functional request', () => {
  const controller = new ConversationController();
  assert.equal(controller.deterministicReply('+2301', 'thanks, where is Jesh?'), null);
  assert.equal(controller.deterministicReply('+2301', 'ok battery?'), null);
});

test('reminder help explains the required details without LLM', () => {
  const controller = new ConversationController();
  const result = controller.deterministicReply('+2301', 'What reminders can I set?');
  assert.equal(result.reason, 'reminder_help');
  assert.match(result.reply, /medicine/i);
  assert.match(result.reply, /24-hour/i);
});

test('journey query is not intercepted as help', () => {
  const controller = new ConversationController();
  assert.equal(controller.deterministicReply('+2301', 'journey?'), null);
  assert.equal(controller.deterministicReply('+2301', 'recent journey'), null);
});

test('explicit journey help remains deterministic', () => {
  const controller = new ConversationController();
  assert.equal(controller.deterministicReply('+2301', 'journey help').reason, 'journey_help');
});

test('single linked wearer is attached to a journey query', () => {
  const controller = new ConversationController();
  const result = controller.resolveWearer('+2301', 'recent journey', 'JOURNEY_QUERY', [devices[0]]);
  assert.equal(result.text, "Show Jesh's recent journeys");
  assert.equal(result.wearer.imei, 'A');
});

test('single linked wearer is attached to a daily summary', () => {
  const controller = new ConversationController();
  const result = controller.resolveWearer('+2301', "how was Jesh's day?", 'DAILY_SUMMARY', [devices[0]]);
  assert.equal(result.wearer.imei, 'A');
});

test('standalone wearer gets a focused deterministic question', () => {
  const controller = new ConversationController();
  const result = controller.standaloneWearerReply('+2301', 'Jesh', devices);
  assert.equal(result.reason, 'wearer_without_intent');
  assert.match(result.reply, /location, battery, alerts, journeys, or today’s summary/);
  assert.equal(controller.getState('+2301').lastWearerImei, 'A');
});

test('standalone wearer detection does not swallow a complete request', () => {
  const controller = new ConversationController();
  assert.equal(controller.standaloneWearerReply('+2301', 'Where is Jesh?', devices), null);
});

test('single linked wearer is attached to an underspecified location request', () => {
  const controller = new ConversationController();
  const result = controller.resolveWearer('+2301', 'location?', 'LOCATION_REQUEST', [devices[0]]);
  assert.equal(result.text, 'Where is Jesh?');
});

test('multiple wearers create a pending question', () => {
  const controller = new ConversationController();
  const result = controller.resolveWearer('+2301', 'location?', 'LOCATION_REQUEST', devices);
  assert.equal(result.reason, 'wearer_required');
  assert.match(result.reply, /Jesh or Mum/);
});

test('wearer-only follow-up resolves the pending request', () => {
  const controller = new ConversationController();
  controller.resolveWearer('+2301', 'location?', 'LOCATION_REQUEST', devices);
  const result = controller.resolvePendingWearer('+2301', 'Jesh', devices);
  assert.equal(result.text, 'Where is Jesh?');
  assert.equal(result.wearer.imei, 'A');
});

test('last wearer carries into a later battery request', () => {
  const controller = new ConversationController();
  controller.resolveWearer('+2301', 'Where is Mum?', 'LOCATION_REQUEST', devices);
  const result = controller.resolveWearer('+2301', 'Battery?', 'DEVICE_STATUS', devices);
  assert.equal(result.wearer.imei, 'B');
  assert.match(result.text, /for Mum/);
});

test('state expires and is not silently reused', () => {
  let now = 0;
  const controller = new ConversationController({ ttlMs: 100, now: () => now });
  controller.resolveWearer('+2301', 'Where is Mum?', 'LOCATION_REQUEST', devices);
  now = 101;
  const result = controller.resolveWearer('+2301', 'Battery?', 'DEVICE_STATUS', devices);
  assert.equal(result.reason, 'wearer_required');
});

test('cancel clears pending conversation state', () => {
  const controller = new ConversationController();
  controller.resolveWearer('+2301', 'location?', 'LOCATION_REQUEST', devices);
  assert.equal(controller.deterministicReply('+2301', 'cancel').reply, 'Okay, cancelled.');
  assert.equal(controller.getState('+2301'), null);
});
