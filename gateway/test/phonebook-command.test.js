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

test('generic deviceCommands cannot provision the administrator-only phonebook', async () => {
  const transports = {
    sendDownlinkCommand: () => {
      throw new Error('generic device command transport must not run');
    },
    sendSms: async () => {
      throw new Error('generic device command SMS must not run');
    },
  };

  await assert.rejects(
    sendDeviceCommand(
      {},
      '999999999999999',
      'set_phonebook_contact',
      { slot: 1, name: 'Test', phone: SYNTHETIC_PHONE },
      transports
    ),
    /Unknown device command type/
  );
});
