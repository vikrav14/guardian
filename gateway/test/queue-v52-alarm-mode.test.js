const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIRMATION,
  readArgument,
  parseAlarmMode,
  buildAlarmModeCommandDocument,
} = require('../scripts/queue-v52-alarm-mode');

test('alarm-mode operator script requires an explicit named confirmation', () => {
  assert.equal(CONFIRMATION, 'CHANGE_SOS_MODE');
  assert.equal(
    readArgument(['--mode', '3', '--confirm', CONFIRMATION], 'confirm'),
    CONFIRMATION
  );
});

test('alarm-mode operator script accepts exactly modes 0 through 3', () => {
  for (const mode of [0, 1, 2, 3]) {
    assert.equal(parseAlarmMode(String(mode)), mode);
  }
  assert.throws(() => parseAlarmMode(), /must be 0, 1, 2, or 3/);
  assert.throws(() => parseAlarmMode(''), /must be 0, 1, 2, or 3/);
  assert.throws(() => parseAlarmMode('4'), /must be 0, 1, 2, or 3/);
});

test('alarm-mode operator script builds an auditable pending command', () => {
  const now = new Date('2026-08-22T10:00:00.000Z');
  assert.deepEqual(
    buildAlarmModeCommandDocument({
      imei: '999999999999999',
      mode: 3,
      now,
    }),
    {
      imei: '999999999999999',
      type: 'set_alarm_mode',
      params: { mode: 3 },
      status: 'pending',
      result: null,
      error: null,
      createdBy: 'operator:queue-v52-alarm-mode',
      createdAt: now,
      completedAt: null,
    }
  );
});
