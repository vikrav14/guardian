const test = require('node:test');
const assert = require('node:assert/strict');
const { actionReplyKind, actionDescription, handleActionReply } = require('../src/safe-actions');
const { storePendingAction, ACTION_STATUS } = require('../src/pending-actions');
const { runTool } = require('../src/assistant/tools');
const { evaluateSubscription } = require('../src/entitlements');

const familyEntitlements = evaluateSubscription({
  version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active',
});
const careEntitlements = evaluateSubscription({
  version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active',
});

function memoryDb() {
  const records = new Map();
  let nextId = 1;
  const makeRef = (id) => ({
    id,
    async set(data) { records.set(id, { ...data }); },
    async update(patch) { records.set(id, { ...(records.get(id) || {}), ...patch }); },
  });
  const collection = {
    doc(id) { return makeRef(id || `action-${nextId++}`); },
    where(field, op, value) {
      const filters = [[field, op, value]];
      return {
        where(f, o, v) { filters.push([f, o, v]); return this; },
        orderBy() { return this; }, limit() { return this; },
        async get() {
          const docs = [...records.entries()].filter(([, data]) =>
            filters.every(([f, o, v]) => o !== '==' || data[f] === v),
          ).map(([id, data]) => ({ id, ref: makeRef(id), data: () => ({ ...data }) }));
          return { empty: docs.length === 0, docs };
        },
      };
    },
  };
  return { db: { collection: () => collection }, records };
}

test('only explicit confirmation language can confirm an action', () => {
  for (const text of ['yes', 'YES!', 'yes confirm', 'confirm', 'oui', 'wi']) {
    assert.equal(actionReplyKind(text), 'confirm', text);
  }
  for (const text of ['ok', 'sure', 'go', 'thanks', 'yes where is Jesh']) {
    assert.equal(actionReplyKind(text), null, text);
  }
});

test('explicit cancellation language cancels', () => {
  for (const text of ['no', 'cancel', 'stop', 'never mind', 'non']) {
    assert.equal(actionReplyKind(text), 'cancel', text);
  }
});

test('action description binds canonical parameters and wearer', () => {
  assert.equal(actionDescription({ actionType: 'ring', wearerName: 'Jesh', parameters: {} }), "ring Jesh's watch");
  assert.equal(actionDescription({
    actionType: 'schedule_reminder', wearerName: 'Mum',
    parameters: { medicineName: 'Metformin', time: '20:00', frequency: 'daily' },
  }), 'set Metformin at 20:00 (daily) for Mum');
});

test('yes without a pending action executes nothing', async () => {
  const { db } = memoryDb();
  let executions = 0;
  const result = await handleActionReply({
    db, ctx: { uid: 'u1', linkedImeis: ['A'] }, text: 'yes',
    execute: async () => { executions += 1; },
  });
  assert.equal(executions, 0);
  assert.match(result.reply, /no pending action/i);
});

test('confirmation executes the exact staged action once and records queued outcome', async () => {
  const { db, records } = memoryDb();
  const staged = await storePendingAction(db, 'u1', {
    targetImei: 'A', wearerName: 'Jesh', actionType: 'ring', parameters: {},
  });
  let executions = 0;
  const execute = async (action) => {
    executions += 1;
    assert.equal(action.targetImei, 'A');
    assert.equal(action.actionType, 'ring');
    return { status: 'queued', commandId: 'cmd-1', channel: 'tcp' };
  };
  const ctx = { uid: 'u1', linkedImeis: ['A'] };
  const first = await handleActionReply({ db, ctx, text: 'YES', execute });
  const replay = await handleActionReply({ db, ctx, text: 'YES', execute });
  assert.equal(first.status, ACTION_STATUS.QUEUED);
  assert.equal(executions, 1);
  assert.match(first.reply, /has not yet received a watch acknowledgement/);
  assert.match(replay.reply, /no pending action/i);
  assert.equal(records.get(staged.id).status, ACTION_STATUS.QUEUED);
});

test('revoked device link prevents execution', async () => {
  const { db } = memoryDb();
  await storePendingAction(db, 'u1', {
    targetImei: 'A', wearerName: 'Jesh', actionType: 'ring', parameters: {},
  });
  let executions = 0;
  const result = await handleActionReply({
    db, ctx: { uid: 'u1', linkedImeis: ['B'] }, text: 'confirm',
    execute: async () => { executions += 1; },
  });
  assert.equal(executions, 0);
  assert.match(result.reply, /could not be confirmed safely/);
});

test('command and reminder tools stage confirmation instead of executing writes', async () => {
  const { db, records } = memoryDb();
  const ctx = {
    uid: 'u1', linkedImeis: ['A'], devices: [{ imei: 'A', nickname: 'Jesh' }],
    entitlements: careEntitlements,
  };
  const command = await runTool(db, ctx, 'send_device_command', {
    command_type: 'ring', imei: 'A',
  });
  assert.equal(command.status, ACTION_STATUS.AWAITING);
  assert.match(command.reply, /Reply YES to continue or CANCEL/);
  assert.equal([...records.values()].filter((record) => record.actionType === 'ring').length, 1);

  const reminder = await runTool(db, ctx, 'schedule_reminder', {
    medicine_name: 'Metformin', time: '20:00', frequency: 'daily', imei: 'A',
  });
  assert.equal(reminder.status, ACTION_STATUS.AWAITING);
  assert.match(reminder.reply, /Metformin at 20:00/);
  assert.equal([...records.values()].some((record) => record.actionType === 'schedule_reminder'), true);
});

test('voice monitoring is disabled before any action is staged', async () => {
  const { db, records } = memoryDb();
  const result = await runTool(
    db,
    { uid: 'u1', linkedImeis: ['A'], devices: [{ imei: 'A', nickname: 'Jesh' }], entitlements: familyEntitlements },
    'send_device_command',
    { command_type: 'listen', imei: 'A' },
  );
  assert.match(result.error, /disabled by Guardian safety policy/);
  assert.equal(records.size, 0);
});

test('Family cannot stage a Care medication reminder', async () => {
  const { db, records } = memoryDb();
  const result = await runTool(
    db,
    {
      uid: 'u1',
      linkedImeis: ['A'],
      devices: [{ imei: 'A', nickname: 'Jesh' }],
      entitlements: familyEntitlements,
    },
    'schedule_reminder',
    { medicine_name: 'Metformin', time: '20:00', imei: 'A' },
  );
  assert.equal(result.code, 'plan_required');
  assert.match(result.error, /Guardian Care/);
  assert.equal(records.size, 0);
});
