'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrientedPhotoAnalyzer, ORIENTATION_PROMPT } = require('../src/incident-photo-orientation');
const { configuredPhotoAnalyzer } = require('../src/incident-photos-live');
const { PROMPT, analysisFailure, analysisRecord, validateAnalysis } = require('../src/incident-photo-analysis');
const { rotatedPhotoPng } = require('../src/incident-photo-rotation');
const original = require('./fixtures/photo-synthetic');
const description = { status: 'ready', summary: 'A chair is visible.', visibleDetails: [],
  uncertainDetails: [], limitations: [], orientation: { clockwiseDegrees: 0, confidence: 'high' } };
const response = (value, model = 'provider-model') => ({ ok: true, json: async () => ({ model,
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] }) });

test('each selected view is described alone with explicit input-relative orientation and exact decoded pixels, in two calls', async () => {
  for (const [index, view] of ['A', 'B', 'C', 'D'].entries()) {
    let calls = 0; let checks = 0;
    const before = Buffer.from(original);
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'configured-model', fetchImpl: async (url, request) => {
      calls++;
      assert.equal(request.redirect, 'error'); assert(request.signal);
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'configured-model');
      const images = body.messages[0].content.filter(part => part.type === 'image');
      if (calls === 1) {
        assert.equal(body.system, ORIENTATION_PROMPT); assert.equal(body.max_tokens, 160);
        assert.equal(images.length, 4);
        for (let i = 0; i < 4; i++) {
          assert.equal(images[i].source.media_type, 'image/png');
          assert.deepEqual(Buffer.from(images[i].source.data, 'base64'), rotatedPhotoPng(original, i * 90));
        }
        return response({ view, confidence: 'high' }, 'orientation-provider');
      }
      assert.equal(calls, 2); assert.equal(body.system, PROMPT); assert.equal(body.max_tokens, 900);
      assert.equal(images.length, 1);
      assert.deepEqual(Buffer.from(images[0].source.data, 'base64'), rotatedPhotoPng(original, index * 90));
      assert.match(body.system, /AS DISPLAYED IN THIS REQUEST/);
      assert.match(body.messages[0].content.at(-1).text, /relative to this supplied image/);
      return response(description, 'description-provider');
    } });
    const result = await analyze(original, { reauthorize: async () => { checks++; } });
    assert.equal(calls, 2); assert.equal(checks, 4);
    assert.equal(result.inputRotationClockwiseDegrees, index * 90);
    assert.equal(result.orientation.clockwiseDegrees, 0);
    assert.equal(result.orientationReference, 'analysis_input');
    assert.equal(result.orientationSelection.clockwiseDegrees, index * 90);
    assert.equal(result.orientationSelection.verification, 'confirmed');
    assert.equal(result.orientationSelection.responseModel, 'orientation-provider');
    assert.equal(result.responseModel, 'description-provider');
    assert.deepEqual(analysisRecord(result), result);
    assert.deepEqual(original, before);
  }
});

test('malformed orientation cannot produce a description or retry', async () => {
  for (const selection of [{ view: 'E', confidence: 'high' }, { view: 'D', confidence: 'high', summary: 'secret' }, [], null]) {
    let calls = 0;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only',
      fetchImpl: async () => { calls++; return response(selection); } });
    await assert.rejects(analyze(original, { reauthorize: async () => {} }), error => {
      assert.equal(analysisFailure(error).reason, 'analysis_orientation_invalid');
      assert.equal(JSON.stringify(analysisFailure(error)).includes('secret'), false); return true;
    });
    assert.equal(calls, 1);
  }
});

test('uncertain selection still describes unturned pixels and never authorizes automatic rotation', async () => {
  for (const selection of [{ view: null, confidence: 'low' }, { view: 'A', confidence: 'low' }, { view: null, confidence: 'high' }]) {
    let calls = 0;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async (url, request) => {
      if (++calls === 1) return response(selection);
      const image = JSON.parse(request.body).messages[0].content[0].source;
      assert.deepEqual(Buffer.from(image.data, 'base64'), rotatedPhotoPng(original, 0));
      return response(description);
    } });
    const result = await analyze(original, { reauthorize: async () => {} });
    assert.equal(calls, 2);
    assert.equal(result.summary, description.summary);
    assert.equal(result.basis, 'decoded_original_photo');
    assert.equal(result.orientationSelection.clockwiseDegrees, null);
    assert.equal(result.orientationSelection.confidence, 'low');
    assert.equal(result.orientationSelection.verification, 'not_selected');
    assert.deepEqual(analysisRecord(result), result);
  }
});

test('disagreement preserves the validated description and both rotation responses without a retry', async () => {
  for (const orientation of [undefined, { clockwiseDegrees: 90, confidence: 'high' }, { clockwiseDegrees: null, confidence: 'low' }]) {
    let calls = 0;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async () => {
      return response(++calls === 1 ? { view: 'D', confidence: 'high' } : { ...description, orientation });
    } });
    const result = await analyze(original, { reauthorize: async () => {} });
    assert.equal(result.summary, description.summary);
    assert.equal(result.status, 'ready');
    assert.equal(result.model, 'test-only');
    assert.equal(result.inputRotationClockwiseDegrees, 270);
    assert.deepEqual(result.orientation, orientation);
    assert.equal(result.orientationSelection.verification, orientation?.confidence === 'high' ? 'conflicting' : 'uncertain');
    assert.deepEqual(analysisRecord(result), result);
    assert.equal(calls, 2);
  }
});

test('access loss between calls prevents the second upload and after analysis prevents result release', async () => {
  for (const failAt of [1, 2, 3, 4]) {
    let calls = 0; let checks = 0;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async () => {
      return response(++calls === 1 ? { view: 'D', confidence: 'high' } : description);
    } });
    await assert.rejects(analyze(original, { reauthorize: async () => {
      if (++checks === failAt) throw Error('revoked');
    } }), /revoked/);
    assert.equal(calls, failAt < 3 ? 0 : failAt === 3 ? 1 : 2);
  }
});

test('runtime orientation is opt-in and uses the explicit model; missing AI configuration disables it', async () => {
  const config = { anthropicApiKey: 'test-only', anthropicModel: 'fallback-model' };
  assert.equal(configuredPhotoAnalyzer({ env: {}, config }), null);
  assert.equal(configuredPhotoAnalyzer({ env: { INCIDENT_PHOTO_AI_ENABLED: 'true' }, config: {} }), null);
  for (const enabled of [undefined, 'false', 'true']) {
    let calls = 0;
    const analyze = configuredPhotoAnalyzer({ env: { INCIDENT_PHOTO_AI_ENABLED: 'true',
      INCIDENT_PHOTO_AI_MODEL: 'selected-model', INCIDENT_PHOTO_AI_ORIENTATION_ENABLED: enabled }, config,
    fetchImpl: async (url, request) => {
      calls++;
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'selected-model');
      if (enabled === 'true' && calls === 1) return response({ view: 'A', confidence: 'high' });
      if (enabled !== 'true') assert.equal(body.messages[0].content[0].source.media_type, 'image/jpeg');
      return response(description);
    } });
    const result = await analyze(original, { reauthorize: async () => {} });
    assert.equal(calls, enabled === 'true' ? 2 : 1);
    assert.equal(Boolean(result.orientationSelection), enabled === 'true');
  }
});

test('model JSON cannot inject trusted orientation selection and contradictory stored metadata is rejected', () => {
  assert.throws(() => validateAnalysis({ ...description, orientationSelection: {} }));
  const record = { ...description, inputRotationClockwiseDegrees: 270, orientationSelection: {
    method: 'four_views_then_description', confidence: 'high', clockwiseDegrees: 270, promptVersion: 1,
  } };
  assert.equal(analysisRecord(record).orientationSelection.clockwiseDegrees, 270);
  assert.equal(analysisRecord({ ...record, orientation: { clockwiseDegrees: 90, confidence: 'high' },
    orientationSelection: { ...record.orientationSelection, verification: 'confirmed' } }).orientationSelection.verification, 'conflicting');
  for (const change of [{ clockwiseDegrees: 90 }, { confidence: 'low' }, { promptVersion: 2 }, { method: 'guess' }]) {
    assert.throws(() => analysisRecord({ ...record, orientationSelection: { ...record.orientationSelection, ...change } }));
  }
});
