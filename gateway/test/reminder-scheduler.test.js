const test = require('node:test');
const assert = require('node:assert/strict');

const { runReminderCheck, startReminderScheduler } = require('../src/reminder-scheduler');
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
    metaTemplateName: 'guardian_medication_reminder_v1',
    sendMetaTemplate: async (to, templateName, options) => {
      sends.push({ to, templateName, options });
      return {
        ok: true,
        accepted: true,
        provider: 'meta',
        messageId: 'wamid.reminder',
        deliveryStatus: 'accepted',
      };
    },
    loadEntitlementsForUser: async () => evaluateSubscription({
      version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active',
    }),
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].templateName, 'guardian_medication_reminder_v1');
  assert.equal(sends[0].options.components[0].parameters[1].text, 'Metformin');
  assert.equal(updates[0].deliveryStatus, 'accepted');
  assert.equal(updates[0].lastDelivery.provider, 'meta');
  assert.equal(updates[0].lastDelivery.messageId, 'wamid.reminder');
  assert(updates[0].lastSentAt instanceof Date);
});

test('Care request watcher stays off by default and starts only with its explicit gate', () => {
  const { db } = fakeDb();
  let starts = 0;
  let stops = 0;

  const disabled = startReminderScheduler(db, {
    checkIntervalMs: 60_000,
    careReminderRuntime: { requestsEnabled: false },
    startCareReminderRequestWatcher: () => { starts += 1; },
    stopCareReminderRequestWatcher: () => { stops += 1; },
  });
  disabled.stop();
  assert.equal(starts, 0);
  assert.equal(stops, 0);

  const enabled = startReminderScheduler(db, {
    checkIntervalMs: 60_000,
    careReminderRuntime: { requestsEnabled: true },
    startCareReminderRequestWatcher: () => { starts += 1; },
    stopCareReminderRequestWatcher: () => { stops += 1; },
  });
  enabled.stop();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});
