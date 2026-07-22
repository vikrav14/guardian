const test = require('node:test');
const assert = require('node:assert/strict');

const { deviceLabel } = require('../src/assistant/tools');

test('deviceLabel prefers nickname, then relationship', () => {
  assert.equal(
    deviceLabel({
      nickname: 'Mimi',
      relationship: 'Mum',
      name: "Mum's pendant",
    }),
    'Mimi',
  );
  assert.equal(
    deviceLabel({ relationship: 'Dad', name: "Dad's pendant" }),
    'Dad',
  );
});

test('deviceLabel removes hardware wording from legacy names', () => {
  assert.equal(deviceLabel({ name: "Mum's pendant" }), 'Mum');
  assert.equal(deviceLabel({ name: 'Device 1234' }), 'Loved one');
  assert.equal(deviceLabel({}), 'Loved one');
});
