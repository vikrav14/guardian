'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FULL_DAY_WINDOWS,
  normalizeDeviceIdentifier,
  provisionActivitySteps,
} = require('../src/activity-steps-provisioning');

test('activity provisioning applies the full-day sheet before enabling PEDO', () => {
  const calls = [];
  const result = provisionActivitySteps(
    { imei: '999999999999999', enabled: true },
    {
      sendDownlinkCommandImpl: (imei, command) => {
        calls.push({ imei, command });
        return { ok: true, protocolId: '9999999999', sessions: 1 };
      },
    }
  );

  assert.deepEqual(FULL_DAY_WINDOWS, [
    '00:00-23:59',
    '00:00-00:00',
    '00:00-00:00',
  ]);
  assert.deepEqual(calls, [
    {
      imei: '999999999999999',
      command: 'WALKTIME,00:00-23:59,00:00-00:00,00:00-00:00',
    },
    { imei: '999999999999999', command: 'PEDO,1' },
  ]);
  assert.deepEqual(result, {
    ok: true,
    protocolId: '9999999999',
    enabled: true,
    windowMode: 'full_day',
    commandsRequired: 2,
    commandsHandedOff: 2,
    sessions: 1,
    evidence: 'socket_handoff_only',
    partialConfigurationPossible: false,
    physicalVerificationRequired: true,
  });
  assert.equal(Object.hasOwn(result, 'command'), false);
  assert.equal(Object.hasOwn(result, 'frame'), false);
});

test('activity provisioning disables PEDO without changing stored windows', () => {
  const calls = [];
  const result = provisionActivitySteps(
    { imei: '9999999999', enabled: false },
    {
      sendDownlinkCommandImpl: (imei, command) => {
        calls.push({ imei, command });
        return { ok: true, protocolId: imei, sessions: 1 };
      },
    }
  );

  assert.deepEqual(calls, [{ imei: '9999999999', command: 'PEDO,0' }]);
  assert.equal(result.enabled, false);
  assert.equal(result.windowMode, 'unchanged');
  assert.equal(result.commandsRequired, 1);
});

test('activity provisioning reports a partial handoff without retrying', () => {
  let callCount = 0;
  const result = provisionActivitySteps(
    { imei: '999999999999999', enabled: true },
    {
      sendDownlinkCommandImpl: () => {
        callCount += 1;
        return callCount === 1
          ? { ok: true, protocolId: '9999999999', sessions: 1 }
          : { ok: false, error: 'no_active_session' };
      },
    }
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'no_active_session',
    enabled: true,
    windowMode: 'full_day',
    commandsRequired: 2,
    commandsHandedOff: 1,
    sessions: 0,
    evidence: 'partial_socket_handoff',
    partialConfigurationPossible: true,
    physicalVerificationRequired: true,
  });
  assert.equal(callCount, 2);
});

test('activity provisioning validates device identity and explicit state', () => {
  assert.equal(normalizeDeviceIdentifier('9999999999'), '9999999999');
  assert.equal(normalizeDeviceIdentifier('999999999999999'), '999999999999999');
  assert.throws(() => normalizeDeviceIdentifier('999'), /10-digit protocol ID/);
  assert.throws(
    () => provisionActivitySteps({ imei: '9999999999', enabled: 1 }),
    /enabled must be true or false/
  );
});
