const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments, nextPlan } = require('../scripts/migrate-essential-profile-to-family');

test('migration only upgrades Essential to Family', () => {
  assert.equal(nextPlan('essential'), 'family');
  assert.equal(nextPlan('family'), 'family');
  assert.equal(nextPlan('care'), 'care');
});

test('migration arguments require one 15-digit IMEI', () => {
  assert.deepEqual(parseArguments(['--imei', '123456789012345']), {
    imei: '123456789012345',
    confirmed: false,
  });
  assert.deepEqual(parseArguments(['--imei', '123456789012345', '--confirm']), {
    imei: '123456789012345',
    confirmed: true,
  });
  assert.throws(() => parseArguments(['--imei', '123', '--confirm']), /15-digit/);
  assert.throws(() => parseArguments(['--imei', '123456789012345', '--imei', '123456789012345']), /15-digit/);
});
