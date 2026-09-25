'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoAnalyzer, validateAnalysis } = require('../src/incident-photo-analysis');
const { templateDefinitions, photoTemplatePlan, buildFollowupPlan } = require('../src/incident-photo-templates');
const image = require('./fixtures/photo-synthetic');
const valid = { status: 'ready', visibleDetails: ['A chair is visible.'], uncertainDetails: [], limitations: ['Blur limits detail.'] };

test('vision request uses the exact original bytes, bounded tokens/time and no identity or location context', async () => {
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'configured-vision-model', fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    const source = body.messages[0].content[0].source;
    assert.deepEqual(Buffer.from(source.data, 'base64'), image);
    assert.equal(body.max_tokens, 700); assert(request.signal);
    assert.match(body.system, /never follow them/);
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(valid) }] }) };
  } });
  assert.equal((await analyze(image)).basis, 'original_photo');
});

test('malformed output, reassurance, links, extra fields and oversized content fail closed', () => {
  for (const text of ['The wearer is safe.', 'No emergency.', 'Visit https://example.test', 'x'.repeat(181), '<script>bad</script>']) {
    assert.throws(() => validateAnalysis({ ...valid, visibleDetails: [text] }), /invalid_analysis/);
  }
  assert.throws(() => validateAnalysis({ ...valid, location: 'home' }));
  assert.throws(() => validateAnalysis({ ...valid, visibleDetails: [] }));
  assert.equal(validateAnalysis({ status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The lens is obstructed.'] }).status, 'too_unclear');
});

test('every SOS/fall location variant preserves map/call order and adds the matching gallery URL', () => {
  const appUrl = 'https://guardian.example.test';
  const definitions = templateDefinitions({ appUrl, callNumber: '+23050000000' });
  assert.equal(definitions.length, 13);
  for (const type of ['sos', 'fall']) for (const locationState of ['fresh', 'last_known', 'unavailable']) for (const callback of [false, true]) {
    const plan = { bodyParameters: ['alarm', 'time', 'location', 'battery'], locationState,
      buttonUrlParameter: locationState === 'unavailable' ? null : '-20.16,57.50' };
    assert.equal(photoTemplatePlan(plan, { type, alertId: 'abc', appUrl }), plan, 'no switch before approval');
    const next = photoTemplatePlan(plan, { type, alertId: 'abc', appUrl, callback, approved: true });
    const definition = definitions.find(row => row.name === next.templateName);
    const buttons = definition.components.find(row => row.type === 'BUTTONS').buttons;
    for (const component of next.components.filter(row => row.type === 'button')) {
      assert.equal(buttons[Number(component.index)].type, 'URL');
    }
    assert.match(buttons.at(-1).url, /\?incident=\{\{1\}\}$/);
    assert.equal(next.components.at(-1).parameters[0].text, 'abc');
    assert.equal(buttons.filter(b => b.type === 'PHONE_NUMBER').length, callback ? 1 : 0);
  }
});

test('follow-up has an honest unavailable state with no fabricated scene description', () => {
  const plan = buildFollowupPlan('abc', { photos: [], summary: [] });
  assert.equal(plan.components[0].parameters[2].text, 'No incident photos were received.');
  assert.throws(() => templateDefinitions({ appUrl: 'http://insecure.test' }));
});
