'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatActivityReply } = require('../src/activity-reply');

test('today activity reply is deterministic and freshness-qualified', () => {
  const reply = formatActivityReply({
    name: 'Jesh',
    requestedDays: 1,
    days: [{
      localDate: '2026-08-23',
      steps: 4321,
      lastObservedAt: '2026-08-23T10:00:00.000Z',
    }],
  });
  assert.match(reply, /Jesh: 4,321 steps on 2026-08-23/);
  assert.match(reply, /Last update/);
  assert.doesNotMatch(reply, /calorie|distance|healthy/i);
});

test('weekly activity reply lists only supplied accepted records', () => {
  const reply = formatActivityReply({
    name: 'Jesh',
    requestedDays: 7,
    days: [
      { localDate: '2026-08-23', steps: 4321 },
      { localDate: '2026-08-22', steps: 3000 },
    ],
  });
  assert.match(reply, /2026-08-23: 4,321/);
  assert.match(reply, /not medical measurements/);
});

test('missing activity data never fabricates a total', () => {
  assert.equal(
    formatActivityReply({ name: 'Jesh', days: [] }),
    'No accepted step reading is available for Jesh yet.',
  );
});

test('partial observed totals cannot be described as complete daily activity', () => {
  const day = { localDate: '2026-09-15', steps: 98, partialCoverage: true };
  assert.match(formatActivityReply({ days: [day] }), /Partial day.*missing periods are unknown/);
  assert.match(formatActivityReply({ days: [day], requestedDays: 7 }), /98 \(partial day\)/);
});
