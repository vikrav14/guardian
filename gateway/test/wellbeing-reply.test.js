'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatWellbeingReply } = require('../src/wellbeing-reply');

test('formats factual watch estimates with freshness and no clinical judgment', () => {
  const reply = formatWellbeingReply({
    name: 'Alex',
    readings: [
      {
        metricSet: 'spo2',
        values: { spo2Percent: 98 },
        observedAt: '2026-08-23T13:58:00.000Z',
      },
      {
        metricSet: 'heart_rate_blood_pressure',
        values: { heartRateBpm: 72, systolicMmHg: 120, diastolicMmHg: 72 },
        observedAt: '2026-08-23T13:57:00.000Z',
      },
    ],
  }, { now: new Date('2026-08-23T14:00:00.000Z') });

  assert.match(reply, /Oxygen estimate: 98%/);
  assert.match(reply, /Heart rate: 72 bpm/);
  assert.match(reply, /120\/72 mmHg/);
  assert.match(reply, /watch estimates, not medical measurements/);
  assert.doesNotMatch(reply, /normal|abnormal|safe reading/i);
});

test('reports no accepted readings without inventing a value', () => {
  assert.match(
    formatWellbeingReply({ name: 'Alex', readings: [] }),
    /No accepted watch wellbeing readings/,
  );
});
