const test = require('node:test');
const assert = require('node:assert/strict');

const { runReminderCheck } = require('../src/reminder-scheduler');
const { evaluateSubscription } = require('../src/entitlements');

function fakeDb() {
  const reminder = {
    imei: 'A', time: '08:05', frequency: 2, text: 'Metformin', enabled: true,
    createdBy: 'u1', lastSentAt: null,
  };
  const updates = [];
  const reminderDoc = {
    id: 'r1', data: () => ({ ...reminder }),
    ref: { async update(value) { updates.push(value); Object.assign(reminder, value); } },
  };
  return {
    updates,
    db: {
      collection(name) {
        if (name === 'medicationReminders') {
          return { where() { return this; }, async get() { return { docs: [reminderDoc] }; } };
        }
        if (name === 'users') {
          return { doc() { return { async get() { return { exists: true, data: () => ({ linkedImeis: ['A'], whatsapp: '+23050000000' }) }; } }; } };
        }
        if (name === 'devices') {
          return { doc() { return { async get() { return { exists: true, data: () => ({ nickname: 'Mum' }) }; } }; } };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    },
  };
}

test('scheduler reads the canonical reminder store and records actual delivery outcome', async () => {
  const { db, updates } = fakeDb();
  const sends = [];
  await runReminderCheck(db, {
    now: new Date('2026-08-17T08:05:00'),
    sendWhatsApp: async (to, message) => {
      sends.push({ to, message });
      return { ok: true, provider: 'meta' };
    },
    loadEntitlementsForUser: async () => evaluateSubscription({
      version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active',
    }),
  });
  assert.equal(sends.length, 1);
  assert.match(sends[0].message, /Metformin/);
  assert.equal(updates[0].deliveryStatus, 'sent');
  assert.equal(updates[0].lastDelivery.provider, 'meta');
  assert(updates[0].lastSentAt instanceof Date);
});
