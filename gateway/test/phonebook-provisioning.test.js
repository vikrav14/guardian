const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDeviceIdentifier,
  provisionPhonebookContact,
} = require('../src/phonebook-provisioning');

const SYNTHETIC_PHONE = '+99912345678';

test('phonebook provisioning sends PHBX through the dedicated admin path', () => {
  const calls = [];
  const result = provisionPhonebookContact(
    {
      imei: '999999999999999',
      slot: 1,
      name: 'Primary guardian',
      phone: SYNTHETIC_PHONE,
    },
    {
      sendDownlinkCommandImpl: (imei, command) => {
        calls.push({ imei, command });
        return { ok: true, protocolId: '9999999999', sessions: 1 };
      },
    }
  );

  assert.deepEqual(calls, [{
    imei: '999999999999999',
    command: `PHBX,1,005000720069006D00610072007900200067007500610072006400690061006E,${SYNTHETIC_PHONE},`,
  }]);
  assert.deepEqual(result, {
    ok: true,
    protocolId: '9999999999',
    slot: 1,
    sessions: 1,
    evidence: 'socket_handoff_only',
    physicalVerificationRequired: true,
  });
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_PHONE), false);
  assert.equal(JSON.stringify(result).includes('Primary guardian'), false);
  assert.equal(Object.hasOwn(result, 'command'), false);
  assert.equal(Object.hasOwn(result, 'frame'), false);
});

test('phonebook provisioning fails safely when the watch has no live session', () => {
  const result = provisionPhonebookContact(
    {
      imei: '9999999999',
      slot: 1,
      name: 'Test',
      phone: SYNTHETIC_PHONE,
    },
    {
      sendDownlinkCommandImpl: () => ({ ok: false, error: 'no_active_session' }),
    }
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'no_active_session',
    slot: 1,
    sessions: 0,
    evidence: 'not_sent',
    physicalVerificationRequired: true,
  });
});

test('phonebook provisioning validates the exact device identifier', () => {
  assert.equal(normalizeDeviceIdentifier('9999999999'), '9999999999');
  assert.equal(normalizeDeviceIdentifier('999999999999999'), '999999999999999');
  assert.throws(() => normalizeDeviceIdentifier('999'), /10-digit protocol ID/);
});
