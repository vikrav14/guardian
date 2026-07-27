const test = require('node:test');
const assert = require('node:assert/strict');

const { deviceLabel, getDeviceIntelligence } = require('../src/assistant/tools');

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

test('getDeviceIntelligence returns topInsight facts only', async () => {
  const ctx = {
    devices: [
      {
        imei: '861397053141170',
        nickname: 'Mimi',
        online: true,
        intelligence: {
          updatedAt: '2026-07-22T12:00:00Z',
          topInsight: {
            id: 'low_battery',
            facts: ['Battery at 18%'],
            inference: 'Battery is low',
            confidence: 85,
            level: 'warning',
          },
          insights: [{ id: 'low_battery' }],
        },
      },
    ],
  };

  const result = await getDeviceIntelligence(ctx, { device_name: 'Mimi' });
  assert.equal(result.name, 'Mimi');
  assert.equal(result.topInsight.id, 'low_battery');
  assert.deepEqual(result.topInsight.facts, ['Battery at 18%']);
  assert.equal(result.insightCount, 1);
});
