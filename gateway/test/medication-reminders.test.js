const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalMedicationReminder,
  deviceCommandParams,
  normalizeReminderFrequency,
  reminderDue,
} = require('../src/medication-reminders');

test('frequency vocabulary maps deterministically to the V52 protocol schema', () => {
  assert.deepEqual(normalizeReminderFrequency('daily'), { code: 2, week: null, label: 'daily' });
  assert.deepEqual(normalizeReminderFrequency('weekdays'), { code: 3, week: '0111110', label: 'weekdays' });
  assert.deepEqual(normalizeReminderFrequency('sunday'), { code: 3, week: '1000000', label: 'sunday' });
  assert.throws(() => normalizeReminderFrequency('weekly'), /week mask/);
});

test('canonical reminder and device command use one compatible contract', () => {
  const reminder = canonicalMedicationReminder({
    imei: '861397000000001', time: '8:05', frequency: 'weekdays',
    text: 'Metformin', createdBy: 'u1', now: new Date('2026-08-15T10:00:00Z'),
  });
  assert.equal(reminder.time, '08:05');
  assert.equal(reminder.frequency, 3);
  assert.equal(reminder.week, '0111110');
  assert.equal(reminder.acknowledgementStatus, 'not_supported');
  assert.deepEqual(deviceCommandParams(reminder), {
    time: '08:05', frequency: 3, week: '0111110', text: 'Metformin', enabled: true,
  });
});

test('reminderDue respects daily, weekly and already-sent boundaries', () => {
  const monday = new Date('2026-08-17T08:05:00');
  assert.equal(reminderDue({ time: '08:05', frequency: 2, enabled: true }, monday), true);
  assert.equal(reminderDue({ time: '08:05', frequency: 3, week: '0100000', enabled: true }, monday), true);
  assert.equal(reminderDue({ time: '08:05', frequency: 3, week: '1000000', enabled: true }, monday), false);
  assert.equal(reminderDue({
    time: '08:05', frequency: 2, enabled: true,
    lastSentAt: new Date('2026-08-17T07:00:00'),
  }, monday), false);
});
