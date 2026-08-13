const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_STATUS, actionKey, storePendingAction, getPendingAction,
  claimPendingAction, cancelPendingAction,
} = require('../src/pending-actions');

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
      const query = {
        where(f, o, v) { filters.push([f, o, v]); return this; },
        orderBy() { return this; }, limit() { return this; },
        async get() {
          const docs = [...records.entries()].filter(([, data]) => filters.every(([f, o, v]) => {
            if (o === '==') return data[f] === v;
            if (o === '<=') return data[f] <= v;
            return true;
          })).map(([id, data]) => ({ id, ref: makeRef(id), data: () => ({ ...data }) }));
          docs.sort((a, b) => (b.data().createdAt?.getTime?.() || 0) - (a.data().createdAt?.getTime?.() || 0));
          return { empty: docs.length === 0, docs };
        },
      };
      return query;
    },
  };
  return { db: { collection: () => collection }, records };
}

test('action key is stable for the same canonical action', () => {
  const action = { callerUid: 'u1', targetImei: 'A', actionType: 'ring', parameters: {} };
  assert.equal(actionKey(action), actionKey(action));
  assert.notEqual(actionKey(action), actionKey({ ...action, targetImei: 'B' }));
});

test('staging a new action supersedes the previous pending action', async () => {
  const { db, records } = memoryDb();
  const now = new Date('2026-08-14T00:00:00Z');
  const first = await storePendingAction(db, 'u1', {
    targetImei: 'A', wearerName: 'Jesh', actionType: 'ring', parameters: {},
  }, { now });
  const second = await storePendingAction(db, 'u1', {
    targetImei: 'A', wearerName: 'Jesh', actionType: 'vibrate', parameters: {},
  }, { now: new Date(now.getTime() + 1000) });
  assert.equal(records.get(first.id).status, ACTION_STATUS.SUPERSEDED);
  assert.equal(records.get(second.id).status, ACTION_STATUS.AWAITING);
});

test('expired action cannot be retrieved or confirmed', async () => {
  const { db, records } = memoryDb();
  const now = new Date('2026-08-14T00:00:00Z');
  const staged = await storePendingAction(db, 'u1', {
    targetImei: 'A', actionType: 'ring', parameters: {},
  }, { now });
  const pending = await getPendingAction(db, 'u1', new Date(now.getTime() + 601000));
  assert.equal(pending, null);
  assert.equal(records.get(staged.id).status, ACTION_STATUS.EXPIRED);
});

test('claim fails closed for another caller or revoked target', async () => {
  const { db } = memoryDb();
  const pending = {
    id: 'x', callerUid: 'u1', targetImei: 'A', expiresAt: new Date(Date.now() + 60000),
    ref: { async update() {} },
  };
  assert.equal((await claimPendingAction(db, pending, 'u2', ['A'])).reason, 'caller_mismatch');
  assert.equal((await claimPendingAction(db, pending, 'u1', ['B'])).reason, 'target_not_authorised');
});

test('cancel changes durable status instead of deleting the record', async () => {
  const { db, records } = memoryDb();
  const staged = await storePendingAction(db, 'u1', {
    targetImei: 'A', actionType: 'ring', parameters: {},
  });
  await cancelPendingAction(db, 'u1');
  assert.equal(records.get(staged.id).status, ACTION_STATUS.CANCELLED);
});
