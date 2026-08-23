'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectAllowedTools,
  buildSystemPrompt,
} = require('../src/request-context');

test('activity intent exposes only the factual activity read tool', () => {
  assert.deepEqual(
    selectAllowedTools({ type: 'ACTIVITY_QUERY' }),
    ['list_devices', 'get_activity_summary'],
  );
});

test('activity prompt prohibits derived fitness and medical claims', () => {
  const prompt = buildSystemPrompt({ type: 'ACTIVITY_QUERY' });
  assert.match(prompt, /accepted daily step totals/);
  assert.match(prompt, /Never infer calories, distance, fitness, illness, or medical status/);
});
