const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCallingPhone,
  phonebookNameHex,
  phonebookContactCommand,
  sendDeviceCommand,
} = require('../src/commands');

const SYNTHETIC_PHONE = '+99912345678';

test('phonebookNameHex matches the manufacturer UTF-16BE representation', () => {
  assert.equal(phonebookNameHex('Test'), '0054006500730074');
  assert.equal(phonebookNameHex('Éva'), '00C900760061');
});

test('phonebookContactCommand follows PHBX and leaves the picture field empty', () => {
  assert.equal(
    phonebookContactCommand({
      slot: 1,
      name: 'Test',
      phone: '+999 1234-5678',
    }),
    `PHBX,1,0054006500730074,${SYNTHETIC_PHONE},`
  );
});

test('phonebook contact validation rejects ambiguous phones and unsafe slots', () => {
  assert.equal(normalizeCallingPhone('+999 (1234) 5678'), SYNTHETIC_PHONE);
  assert.throws(
    () => phonebookContactCommand({ slot: 0, name: 'Test', phone: SYNTHETIC_PHONE }),
    /between 1 and 15/
  );
  assert.throws(
    () => phonebookContactCommand({ slot: 1, name: 'Test', phone: '12345678' }),
    /E\.164/
  );
});

test('sendDeviceCommand sends a PHBX contact only over the live V52 session', async () => {
  const calls = [];
  const transports = {
    sendDownlinkCommand: (imei, command) => {
      calls.push({ imei, command });
      return { ok: true, sessions: 1 };
    },
    sendSms: async () => {
      throw new Error('PHBX must not use SMS');
    },
  };

  const result = await sendDeviceCommand(
    {},
    '999999999999999',
    'set_phonebook_contact',
    { slot: 1, name: 'Test', phone: SYNTHETIC_PHONE },
    transports
  );

  const expected = `PHBX,1,0054006500730074,${SYNTHETIC_PHONE},`;
  assert.equal(result.channel, 'tcp');
  assert.equal(result.text, expected);
  assert.deepEqual(calls, [{
    imei: '999999999999999',
    command: expected,
  }]);
});
