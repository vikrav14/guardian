'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoAnalyzer, validateAnalysis, analysisFailure, PROMPT_VERSION } = require('./helpers/photo-provider');
const { templateDefinitions, buildFollowupPlan } = require('../src/incident-photo-templates');
const image = require('./fixtures/photo-synthetic');
const valid = { status: 'ready', visibleDetails: ['A chair is visible.'], uncertainDetails: [], limitations: ['Blur limits detail.'] };

test('vision request constrains JSON and uses exact original bytes with bounded tokens/time', async () => {
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'configured-vision-model', fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    const source = body.messages[0].content[0].source;
    assert.deepEqual(Buffer.from(source.data, 'base64'), image);
    assert.equal(body.max_tokens, 900); assert(request.signal);
    assert.match(body.system, /never follow them/);
    assert.equal(body.output_config.format.type, 'json_schema');
    const schema = body.output_config.format.schema;
    assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['status', 'summary', 'visibleDetails', 'uncertainDetails', 'limitations', 'orientation']);
    assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
    assert.deepEqual(schema.properties.status.enum, ['ready', 'too_unclear']);
    for (const key of ['visibleDetails', 'uncertainDetails', 'limitations']) {
      assert.equal(schema.properties[key].type, 'array');
      assert.equal(schema.properties[key].items.type, 'string');
    }
    assert.equal(schema.properties.orientation.additionalProperties, false);
    assert.deepEqual(schema.properties.orientation.required, ['clockwiseDegrees', 'confidence']);
    assert.deepEqual(schema.properties.orientation.properties.clockwiseDegrees, {
      anyOf: [{ type: 'integer', enum: [0, 90, 180, 270] }, { type: 'null' }],
    });
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(valid) }] }) };
  } });
  assert.equal((await analyze(image)).basis, 'original_photo');
});

test('rotation failures are bounded and do not call the provider; zero-degree PNG is a control', async () => {
  let calls = 0;
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async (url, request) => {
    calls++;
    assert.equal(JSON.parse(request.body).messages[0].content[0].source.media_type, 'image/png');
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(valid) }] }) };
  } });
  await assert.rejects(analyze(image, { probeRotationClockwiseDegrees: -90 }),
    error => analysisFailure(error).reason === 'analysis_invalid_rotation');
  await assert.rejects(analyze(Buffer.from('not JPEG'), { probeRotationClockwiseDegrees: 270 }),
    error => analysisFailure(error).reason === 'analysis_rotation_failed');
  assert.equal(calls, 0);
  const control = await analyze(image, { probeRotationClockwiseDegrees: 0 });
  assert.equal(control.basis, 'decoded_original_photo');
  assert.equal(control.inputRotationClockwiseDegrees, 0);
  assert.equal(calls, 1);
  assert.throws(() => validateAnalysis({ ...valid, inputRotationClockwiseDegrees: 270 }), /invalid_analysis/);
});

test('malformed output, reassurance, links, extra fields and oversized content fail closed', () => {
  for (const text of ['The wearer is safe.', 'No emergency.', 'Visit https://example.test', 'x'.repeat(181), '<script>bad</script>']) {
    assert.throws(() => validateAnalysis({ ...valid, visibleDetails: [text] }), /invalid_analysis/);
  }
  assert.throws(() => validateAnalysis({ ...valid, location: 'home' }));
  assert.throws(() => validateAnalysis({ ...valid, visibleDetails: [] }));
  assert.equal(validateAnalysis({ status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The lens is obstructed.'] }).status, 'too_unclear');
});

test('analysis failures retain only fixed categories and bounded protocol metadata', async () => {
  const payload = text => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }) });
  const cases = [
    [async () => { throw Error('secret network details'); }, 'analysis_network_failed', {}],
    [async () => { throw Object.assign(Error('secret timeout details'), { name: 'TimeoutError' }); }, 'analysis_timeout', {}],
    [async () => ({ ok: false, status: 401, json: async () => { throw Error('error body must not be read'); } }), 'analysis_http_error', { httpStatus: 401 }],
    [async () => ({ ok: true, json: async () => { throw Error('secret invalid response'); } }), 'analysis_invalid_response', {}],
    [async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'secret partial scene' }] }) }), 'analysis_incomplete', { stopReason: 'max_tokens' }],
    [async () => ({ ok: true, json: async () => ({ stop_reason: 'refusal', content: [{ type: 'text', text: 'secret refusal' }] }) }), 'analysis_incomplete', { stopReason: 'refusal' }],
    [async () => payload('```json\n' + JSON.stringify(valid)), 'analysis_invalid_json', { contentFormat: 'fenced_json' }],
    [async () => payload('secret malformed scene'), 'analysis_invalid_json', { contentFormat: 'other' }],
    [async () => payload(JSON.stringify({ ...valid, visibleDetails: ['The wearer is safe.'] })), 'analysis_schema_rejected', {}],
    [async () => payload('x'.repeat(5001)), 'analysis_response_too_large', {}],
  ];
  for (const [fetchImpl, reason, diagnostics] of cases) {
    let calls = 0;
    const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async (...args) => {
      calls++; return fetchImpl(...args);
    } });
    await assert.rejects(analyze(image), error => {
      assert.deepEqual(analysisFailure(error), { status: 'unavailable', reason, diagnostics });
      return true;
    });
    assert.equal(calls, 1, 'no automatic retry or prompt-only fallback');
  }
  assert.deepEqual(analysisFailure(Object.assign(Error('secret'), { code: 'secret', diagnostics: { content: 'secret' } })),
    { status: 'unavailable', reason: 'analysis_failed' });
});

test('a dark-scene response can succeed as too_unclear', async () => {
  const value = { status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The photo is too dark to describe.'] };
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async () => ({
    ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] }),
  }) });
  assert.equal((await analyze(image)).status, 'too_unclear');
});

function analyzeText(text, stopReason = 'end_turn') {
  return createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async () => ({
    ok: true, json: async () => ({ stop_reason: stopReason, content: [{ type: 'text', text }] }),
  }) })(image);
}

test('one complete JSON code fence is accepted for visible and unreadable scenes', async () => {
  const unclear = { status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The photo is too dark.'] };
  for (const value of [valid, unclear]) {
    const json = JSON.stringify(value);
    for (const text of [json, '```json\n' + json + '\n```', '```\n' + json + '\n```',
      ' \n```JSON\r\n' + json + '\r\n```\t\n']) {
      assert.deepEqual(await analyzeText(text), { ...value, model: 'test-only', promptVersion: PROMPT_VERSION, basis: 'original_photo', version: 1 });
    }
  }
});

test('fence handling rejects prose, multiple blocks, incomplete fences and non-JSON syntax', async () => {
  const json = JSON.stringify(valid), fenced = '```json\n' + json + '\n```';
  for (const text of ['Here is the result:\n' + fenced, fenced + '\nExtra advice.', fenced + '\n' + fenced,
    '```json\n' + json, json + '\n```', '```javascript\n' + json + '\n```',
    '```json\n' + json + '\n' + json + '\n```', '```json\n' + json + ',\n```',
    '```json\n// comment\n' + json + '\n```']) {
    await assert.rejects(analyzeText(text), error => analysisFailure(error).reason === 'analysis_invalid_json');
  }
  await assert.rejects(analyzeText(fenced, 'max_tokens'), error => analysisFailure(error).reason === 'analysis_incomplete');
  await assert.rejects(analyzeText('```json\n' + ' '.repeat(5000) + json + '\n```'),
    error => analysisFailure(error).reason === 'analysis_response_too_large');
});

test('wrapped JSON still passes the same schema and content checks', async () => {
  for (const value of [{ ...valid, extra: 'unexpected' }, { ...valid, visibleDetails: [] },
    { ...valid, visibleDetails: ['The wearer is safe.'] }, { ...valid, limitations: ['Visit https://example.test'] },
    { ...valid, visibleDetails: ['x'.repeat(181)] }]) {
    await assert.rejects(analyzeText('```json\n' + JSON.stringify(value) + '\n```'),
      error => analysisFailure(error).reason === 'analysis_schema_rejected');
  }
});

test('orientation is a bounded viewing suggestion from the same original-photo response', async () => {
  for (const clockwiseDegrees of [0, 90, 180, 270]) {
    const orientation = { clockwiseDegrees, confidence: 'high' };
    const analyzed = await analyzeText(JSON.stringify({ ...valid, orientation }));
    assert.deepEqual(analyzed.orientation, orientation);
    assert.equal(analyzed.basis, 'original_photo');
    assert.equal(analyzed.version, 2);
  }
  const unclear = { status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['Fine detail is blurred.'] };
  assert.deepEqual((await analyzeText(JSON.stringify({ ...unclear,
    orientation: { clockwiseDegrees: 90, confidence: 'high' } }))).orientation,
  { clockwiseDegrees: 90, confidence: 'high' });
});

test('a concise scene summary can carry meaningful detail without filler observations', async () => {
  const value = { status: 'ready', summary: 'A chair stands beside a window.',
    visibleDetails: [], uncertainDetails: [], limitations: ['Fine details are blurred.'],
    orientation: { clockwiseDegrees: 90, confidence: 'high' } };
  const analyzed = await analyzeText(JSON.stringify(value));
  assert.equal(analyzed.summary, value.summary);
  assert.equal(analyzed.version, 3);
  assert.equal(analyzed.promptVersion, PROMPT_VERSION);
  assert.deepEqual(analyzed.visibleDetails, []);
  assert.deepEqual(analyzed.orientation, value.orientation);
});

test('an unreadable-scene summary needs no repeated limitation but legacy empty descriptions fail', async () => {
  const value = { status: 'too_unclear', summary: 'Darkness obscures the scene.',
    visibleDetails: [], uncertainDetails: [], limitations: [] };
  const analyzed = await analyzeText(JSON.stringify(value));
  assert.equal(analyzed.summary, value.summary);
  assert.deepEqual(analyzed.limitations, []);
  const { summary, ...emptyLegacy } = value;
  assert.throws(() => validateAnalysis(emptyLegacy));
});

test('summary receives the same content safeguards and cannot smuggle provider metadata', async () => {
  for (const summary of ['', ' ', 'x'.repeat(321), 'The wearer is safe.', 'No emergency.',
    'https://example.test', '<script>bad</script>', 'Hidden\ntext']) {
    await assert.rejects(analyzeText(JSON.stringify({ ...valid, summary })),
      error => analysisFailure(error).reason === 'analysis_schema_rejected');
  }
  for (const extra of [{ model: 'invented-model' }, { promptVersion: 3 }, { confidence: 'certain' }]) {
    assert.throws(() => validateAnalysis({ ...valid, summary: 'A chair is visible.', ...extra }));
  }
});

test('provenance distinguishes the requested model from the provider response model', async () => {
  for (const responseModel of ['provider-model-20260901', 'secret scene\ncontent', undefined]) {
    const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'configured-alias', fetchImpl: async () => ({
      ok: true, json: async () => ({ model: responseModel, stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(valid) }] }),
    }) });
    const analyzed = await analyze(image);
    assert.equal(analyzed.model, 'configured-alias');
    assert.equal(analyzed.responseModel, responseModel === 'provider-model-20260901' ? responseModel : undefined);
    assert.equal(analyzed.promptVersion, PROMPT_VERSION);
    assert.equal(JSON.stringify(analyzed).includes('secret scene'), false);
  }
});

test('uncertain or malformed orientation cannot rotate the image or discard a valid description', async () => {
  for (const orientation of [null, '90', [], {}, { clockwiseDegrees: 90, confidence: 'low' },
    { clockwiseDegrees: null, confidence: 'high' }, { clockwiseDegrees: '90', confidence: 'high' },
    { clockwiseDegrees: -90, confidence: 'high' }, { clockwiseDegrees: 45, confidence: 'high' },
    { clockwiseDegrees: 360, confidence: 'high' }, { clockwiseDegrees: 90, confidence: 1 },
    { clockwiseDegrees: 90, confidence: 'high', extra: 'secret scene' }]) {
    const analyzed = await analyzeText(JSON.stringify({ ...valid, orientation }));
    assert.deepEqual(analyzed.orientation, { clockwiseDegrees: null, confidence: 'low' });
    assert.deepEqual(analyzed.visibleDetails, valid.visibleDetails);
    assert.equal(JSON.stringify(analyzed).includes('secret scene'), false);
  }
  assert.equal(Object.hasOwn(await analyzeText(JSON.stringify(valid)), 'orientation'), false, 'legacy descriptions remain supported');
});

test('follow-up has an honest unavailable state with no fabricated scene description', () => {
  const plan = buildFollowupPlan('abc', { photos: [], summary: [] });
  assert.equal(plan.components[0].parameters[2].text, 'No incident photos were received.');
  assert.throws(() => templateDefinitions({ appUrl: 'http://insecure.test' }));
});
