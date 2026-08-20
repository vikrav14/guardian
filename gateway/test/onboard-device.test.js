const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateSmsCommands,
  validateImei,
  validatePhone,
  validateProtocolId,
} = require('../onboard-device');

test('V52 onboarding emits only live-proven provisioning commands', () => {
  const commands = generateSmsCommands(
    '0.tcp.in.ngrok.io',
    '25295',
    '+23058590100'
  );

  assert.deepEqual(
    Object.values(commands).map((value) => value.command),
    [
      'pw,123456,center,+23058590100#',
      'ip,0.tcp.in.ngrok.io,25295#',
      'ts#',
    ]
  );
  assert.equal('apn' in commands, false);
  assert.equal(
    Object.values(commands).some(({ command }) => command.includes('46000')),
    false
  );
});

test('V52 onboarding validates canonical identifiers and Mauritius numbers', () => {
  assert.equal(validateProtocolId('9705254749'), true);
  assert.equal(validateImei('861397052547492'), true);
  assert.equal(validatePhone('+23058590100'), true);
  assert.equal(validateProtocolId('861397052547492'), false);
  assert.equal(validateImei('9705254749'), false);
});
