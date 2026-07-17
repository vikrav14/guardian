const test = require('node:test');
const assert = require('node:assert/strict');
const { centerNumberCommand, sosNumberCommand, statusCommand, sendDeviceCommand } = require('../src/commands');

test('centerNumberCommand matches the vendor SMS syntax exactly', () => {
  assert.equal(centerNumberCommand('+23057123456'), 'pw,123456,center,+23057123456#');
});

test('sosNumberCommand builds sos1/sos2/sos3 commands', () => {
  assert.equal(sosNumberCommand(1, '+23057123456'), 'sos1,+23057123456#');
  assert.equal(sosNumberCommand(2, '+23057123456'), 'sos2,+23057123456#');
  assert.equal(sosNumberCommand(3, '+23057123456'), 'sos3,+23057123456#');
});

test('sosNumberCommand rejects an out-of-range slot', () => {
  assert.throws(() => sosNumberCommand(4, '+23057123456'), /slot must be 1, 2, or 3/);
});

test('statusCommand is the documented ts# check', () => {
  assert.equal(statusCommand(), 'ts#');
});

test('sendDeviceCommand rejects an unknown command type', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }) };
  await assert.rejects(
    () => sendDeviceCommand(db, '359633100123456', 'reboot_now', {}),
    /Unknown device command type/
  );
});

test('sendDeviceCommand rejects a device with no simNumber on file', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }) };
  await assert.rejects(
    () => sendDeviceCommand(db, '359633100123456', 'check_status', {}),
    /no simNumber on file/
  );
});
