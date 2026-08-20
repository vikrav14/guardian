const test = require('node:test');
const assert = require('node:assert/strict');

const { executeConfirmedAction } = require('../src/assistant/tools');
const { evaluateSubscription } = require('../src/entitlements');

function writeDb() {
  const records = new Map();
  let next = 1;
  return {
    records,
    db: {
      collection(name) {
        return {
          doc(id = `${name}-${next++}`) {
            return {
              id,
              async set(data) { records.set(`${name}/${id}`, { ...data }); },
            };
          },
        };
      },
    },
  };
}

test('confirmed WhatsApp reminder writes the canonical record and queued V52 command', async () => {
  const { db, records } = writeDb();
  const entitlements = evaluateSubscription({
    version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active',
  });
  const ctx = {
    uid: 'u1',
    linkedImeis: ['A'],
    devices: [{ imei: 'A', nickname: 'Mum' }],
    entitlements,
  };
  const result = await executeConfirmedAction(db, ctx, {
    callerUid: 'u1',
    targetImei: 'A',
    actionType: 'schedule_reminder',
    parameters: { medicineName: 'Metformin', time: '08:05', frequency: 'weekdays' },
  });

  assert.equal(result.status, 'scheduled');
  assert.equal(result.acknowledgementStatus, 'not_supported');
  const reminder = records.get(`medicationReminders/${result.reminderId}`);
  const command = records.get(`deviceCommands/${result.commandId}`);
  assert.equal(reminder.frequency, 3);
  assert.equal(reminder.week, '0111110');
  assert.equal(command.type, 'set_medication_reminder');
  assert.equal(command.status, 'pending');
  assert.deepEqual(command.params, {
    time: '08:05', frequency: 3, week: '0111110', text: 'Metformin', enabled: true,
  });
});
