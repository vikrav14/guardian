'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database } = require('./helpers/command-database');
const { cases, seedCase, grade } = require('../eval/intelligence-cases');
const { createIntelligenceService, directSelection, selection, SELECTION_SCHEMA } = require('../src/intelligence-core/service');
const { collectEvidence } = require('../src/intelligence-core/evidence');
const { parseArgs } = require('../scripts/qualify-intelligence');

test('confirmation questions cannot use fact-keyword shortcuts', () => {
  for (const question of ['Can you prove the wearer is at home right now?', 'Is the wearer injured after the fall?',
    'Has the family member arrived at the incident?', 'Does the photo prove the wearer is unconscious?',
    'Did the low battery cause the fall?', 'Does no recent alert mean everything is fine?', 'Is the person safe in this photo?']) {
    assert.equal(directSelection(question, { facts: [] }), null, question);
  }
});
test('plural photo requests reuse saved observations without a new model or image request', () => {
  const packet = { facts: [{ id: 'count', kind: 'photos' }, { id: 'description', kind: 'photo_observation' }] };
  assert.deepEqual(directSelection('What do the saved photos show?', packet).evidenceIds, ['count', 'description']);
});
test('qualification defaults to offline and rejects accidental or ambiguous CLI activation', () => {
  assert.equal(parseArgs(['--out', 'run']).live, false);
  assert.equal(parseArgs(['--live', '--out', 'run']).live, true);
  assert.throws(() => parseArgs(['--live']), /Use/);
  assert.throws(() => parseArgs(['--out', 'run', '--extra']), /Use/);
});

test('an unavailable provider cannot pass an insufficient-evidence qualification case', () => {
  const scenario = cases.find(row => row.id === 'safety-not-established');
  assert.equal(grade(scenario, { answerable: false, facts: [], reason: 'ai_unavailable' }).length, 1);
  assert.equal(grade(scenario, { answerable: false, facts: [], reason: null }).length, 0);
});

test('Anthropic selection schema is included in token preflight and the metered generation', async () => {
  const AnthropicProvider = require('../src/providers/anthropic-provider');
  const { runAiScope } = require('../src/intelligence-core/runtime');
  const db = database(), bodies = [];
  const provider = new AnthropicProvider({ anthropicApiKey: 'synthetic', fetchImpl: async (url, request) => {
    const body = JSON.parse(request.body); bodies.push(body);
    return { ok: true, json: async () => url.endsWith('/count_tokens') ? { input_tokens: 500 } :
      { content: [{ type: 'text', text: '{"answerable":false,"evidenceIds":[]}' }], stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 12 } } };
  } });
  const result = await runAiScope({ db, serviceKey: 'synthetic-schema', plan: 'family', jobId: 'schema-test',
    feature: 'question', authorize: async () => {} }, () => provider.complete({ systemPrompt: 'Select evidence.',
    messages: [{ role: 'user', content: 'synthetic question' }], outputSchema: SELECTION_SCHEMA, maxTokens: 250 }));
  assert.equal(bodies.length, 2);
  for (const body of bodies) assert.deepEqual(body.output_config, { format: { type: 'json_schema', schema: SELECTION_SCHEMA } });
  assert.deepEqual(selection(result, { facts: [] }), { answerable: false, evidenceIds: [] });
  assert.equal([...db.rows].filter(([key]) => key.startsWith('aiAttempts/')).length, 1);
});
test('one JSON code fence is harmless but prose, unknown IDs and extra blocks remain rejected', () => {
  const packet = { facts: [{ id: 'known' }] };
  const json = '{"evidenceIds":["known"],"answerable":true}';
  const response = text => ({ stopReason: 'end_turn', content: [{ type: 'text', text }] });
  assert.deepEqual(selection(response('```json\n' + json + '\n```'), packet), { evidenceIds: ['known'], answerable: true });
  for (const text of ['Here is the answer: ' + json, '```json\n' + json + '\n```\n```\n{}\n```',
    '```json\n{"evidenceIds":["invented"],"answerable":true}\n```',
    '```json\n{"evidenceIds":["known"],"answerable":true,"diagnosis":"safe"}\n```']) {
    assert.throws(() => selection(response(text), packet), /ai_invalid_selection/);
  }
});
for (const [index, scenario] of cases.entries()) test(`synthetic acceptance: ${scenario.id}`, async () => {
  const db = database(), clock = Date.now(), fixture = seedCase(db, scenario, index, clock);
  let packet, calls = 0;
  const service = createIntelligenceService({ db, now: () => clock,
    collect: async (store, access, options) => (packet = await collectEvidence(store, access, { ...options, gallery: fixture.gallery })),
    // Contract fixture, NOT an assessment of model quality. Live qualification
    // uses the same cases with the real metered provider and records its misses.
    provider: { complete: async () => {
      calls++;
      const ids = scenario.empty ? [] : packet.facts.filter(f => scenario.required?.includes(f.kind)).map(f => f.id);
      return { stopReason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ evidenceIds: ids, answerable: ids.length > 0 }) }] };
    } } });
  let result, error;
  try { result = await service.answer({ ...fixture, question: scenario.question }); }
  catch (e) { error = e.code; }
  assert.deepEqual(grade(scenario, result, error), []);
  const before = calls;
  if (!error) await service.answer({ ...fixture, question: scenario.question });
  assert.equal(calls, before, 'repeat must not regenerate');
  if (scenario.mode === 'recorded' || scenario.error) assert.equal(calls, 0);
});
