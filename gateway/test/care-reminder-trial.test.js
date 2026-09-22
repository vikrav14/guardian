'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clockAlarmCommand, buildCareReminderTrial, runCareReminderTrial } = require('../src/care-reminder-trial');
const { parseArgs } = require('../scripts/trial-care-reminders');
const { buildAckFrame } = require('../src/protocol/gt06');

const imei = '123456789012345';
const once = { time: '07:00', enabled: true, frequency: 1 };
const daily = { time: '08:10', enabled: true, frequency: 2 };
const weekly = { time: '05:30', enabled: false, frequency: 3, weekMask: '1111111' };

test('REMIND reproduces the supplier example with a computed frame length', () => {
  const command = clockAlarmCommand([once, daily, weekly]);
  assert.equal(command, 'REMIND,07:00-1-1,08:10-1-2,05:30-0-3-1111111');
  const frame = buildAckFrame('9705000296', command).toString('ascii');
  assert.equal(frame, '[SG*9705000296*002C*REMIND,07:00-1-1,08:10-1-2,05:30-0-3-1111111]');
});

test('REMIND requires explicit valid slots and rejects delimiter injection and ambiguous values', () => {
  for (const slots of [[], [once], [once, daily], [once, daily, weekly, once]]) {
    assert.throws(() => clockAlarmCommand(slots));
  }
  for (const patch of [
    { time: '24:00' }, { time: '07:00,HSW,0' }, { time: '7:00' },
    { enabled: 1 }, { frequency: '1' }, { frequency: 4 },
    { weekMask: '1111111' }, { label: 'not a protocol field' },
  ]) assert.throws(() => clockAlarmCommand([{ ...once, ...patch }, daily, weekly]));
  for (const weekMask of ['111111', '11111111', '0000000', 1111111, '111x111']) {
    assert.throws(() => clockAlarmCommand([once, daily, { ...weekly, enabled: true, weekMask }]));
  }
});

test('every command previews without contacting a watch or claiming acceptance', async () => {
  const send = () => assert.fail('preview dispatched');
  for (const action of ['remind-once', 'remind-off', 'hsw-zero', 'sedentary-example',
    'hsw-on', 'hsw-off', 'sedentary-on', 'sedentary-off']) {
    const result = await runCareReminderTrial({ imei, action, ...(action === 'remind-once' ? { time: '12:34' } : {}) }, send);
    assert.equal(result.status, 'preview');
    assert.equal(result.commandSent, false);
    assert.equal(result.hardwareAccepted, false);
    assert.equal(result.appliedStateVerified, false);
  }
  assert.equal(buildCareReminderTrial({ imei, action: 'hsw-zero' }).command, 'HSW,0');
  assert.equal(buildCareReminderTrial({ imei, action: 'sedentary-example' }).command, 'SEDENTARY,1,26');
});

test('legacy example actions remain preview-only even with send and replacement confirmation', async () => {
  for (const action of ['hsw-zero', 'sedentary-example']) {
    await assert.rejects(runCareReminderTrial({ imei, action, send: true, confirmReplaceClocks: true }, () => assert.fail('blocked command dispatched')));
  }
});

test('supplier switches send only their defined payload and computed frame without replacing clocks', async () => {
  const cases = [
    ['hsw-on', 'HSW,1', '0005'], ['hsw-off', 'HSW,0', '0005'],
    ['sedentary-on', 'SEDENTARY,1,26', '000E'], ['sedentary-off', 'SEDENTARY,0,26', '000E'],
  ];
  for (const [action, expected, length] of cases) {
    const calls = [];
    const result = await runCareReminderTrial({ imei, action, send: true }, async (target, command) => {
      calls.push([target, buildAckFrame('9705000296', command).toString('ascii')]);
      return { ok: true, protocolId: '9705000296', sessions: 1 };
    });
    assert.deepEqual(calls, [[imei, `[SG*9705000296*${length}*${expected}]`]]);
    assert.equal(result.command, expected);
    assert.equal(result.replacesAllClockSlots, false);
    assert.equal(result.requestedEnabled, action.endsWith('-on'));
    assert.equal(result.settingMayPersist, true);
    assert.equal(result.hardwareAccepted, false);
    assert.equal(result.appliedStateVerified, false);
    assert.equal(result.wearerAcknowledgement, 'unavailable');
    assert.equal(result.disableCommand, action.startsWith('hsw-') ? 'HSW,0' : 'SEDENTARY,0,26');
    assert.equal(Number.isNaN(Date.parse(result.requestedAt)), false);
    if (action.startsWith('sedentary-')) assert.equal(result.intervalMinutes, 26);
  }
});

test('switch actions reject clock-time input, unsupported interval flags and injected action values', async () => {
  for (const action of ['hsw-on', 'hsw-off', 'sedentary-on', 'sedentary-off']) {
    await assert.rejects(runCareReminderTrial({ imei, action, time: '12:00', send: true },
      () => assert.fail('invalid options sent')), /time is only valid/);
  }
  for (const action of ['HSW,1', 'hsw-on,RESET', 'sedentary-on,10', 'toString', '__proto__']) {
    assert.throws(() => buildCareReminderTrial({ imei, action }));
  }
  assert.throws(() => parseArgs(['--action', 'sedentary-on', '--interval', '10']), /Unknown/);
  assert.throws(() => parseArgs(['--action', 'hsw-on', '--command', 'RESET']), /Unknown/);
});

test('switch handoff needs a live-session result and never retries an uncertain send', async () => {
  for (const action of ['hsw-on', 'hsw-off', 'sedentary-on', 'sedentary-off']) {
    for (const result of [null, { ok: false }, { ok: true },
      { ok: true, protocolId: '9705000296', sessions: 0 },
      { ok: true, protocolId: '9705000296', sessions: '1' },
      { ok: true, protocolId: 'invalid', sessions: 1 }, 'timeout']) {
      let calls = 0;
      await assert.rejects(runCareReminderTrial({ imei, action, send: true }, async () => {
        calls++;
        if (result === 'timeout') throw new Error('timeout');
        return result;
      }));
      assert.equal(calls, 1);
    }
  }
});

test('clock trial requires explicit replacement confirmation and never claims physical success', async () => {
  const options = { imei, action: 'remind-once', time: '12:34', send: true };
  await assert.rejects(runCareReminderTrial(options, () => assert.fail('unconfirmed replacement')), /replaces all three/);
  const calls = [];
  const result = await runCareReminderTrial({ ...options, confirmReplaceClocks: true }, async (...args) => {
    calls.push(args);
    return { ok: true, protocolId: '4567890123', sessions: 1 };
  });
  assert.deepEqual(calls, [[imei, 'REMIND,12:34-1-1,00:00-0-1,00:00-0-1']]);
  assert.equal(result.status, 'socket_handoff');
  assert.equal(result.hardwareAccepted, false);
  assert.equal(result.wearerAcknowledgement, 'unavailable');
  assert.equal(buildCareReminderTrial({ imei, action: 'remind-off' }).command, 'REMIND,00:00-0-1,00:00-0-1,00:00-0-1');
});

test('offline or uncertain sends fail without automatic retry', async () => {
  const options = { imei, action: 'remind-off', send: true, confirmReplaceClocks: true };
  for (const outcome of ['offline', 'timeout']) {
    let calls = 0;
    await assert.rejects(runCareReminderTrial(options, async () => {
      calls++;
      if (outcome === 'timeout') throw new Error('timeout');
      return { ok: false, error: 'no_active_session' };
    }));
    assert.equal(calls, 1);
  }
});

test('CLI rejects misspelled, duplicate or missing flags instead of silently changing a trial', () => {
  for (const args of [['--sned'], ['--time'], ['--time', '--send'], ['--send', '--send']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.deepEqual(parseArgs(['--imei', imei, '--action', 'remind-off']), { imei, action: 'remind-off' });
  assert.throws(() => buildCareReminderTrial({ imei: 'bad', action: 'remind-off' }));
  assert.throws(() => buildCareReminderTrial({ imei, action: 'hsw-one' }));
  assert.throws(() => buildCareReminderTrial({ imei, action: 'remind-off', time: '12:00' }));
});
