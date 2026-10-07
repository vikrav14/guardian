'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, receive, imei } = require('./helpers/photo-harness');
const { createIncidentPhotos } = require('../src/incident-photos');
const { createPhotoAnalyzer, PhotoAnalysisError, PROMPT_VERSION } = require('./helpers/photo-provider');
const { CONSENT_VERSION } = require('../src/incident-photo-policy');
const { inspectIncidentPhoto, probeOriginal, parseInspectionArgs } = require('../scripts/inspect-incident-photo');
const original = require('./fixtures/photo-synthetic');
const result = { status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The photo is too dark.'] };

async function savedPhoto() {
  const s = setup();
  s.db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: true, consentVersion: CONSENT_VERSION });
  s.db.rows.set('alerts/trialOne', { imei, type: 'sos', eventAt: s.args.now(),
    incidentPhotoEligible: true, incidentPhotoPending: true, notifyStatus: 'accepted' });
  s.advance(1); s.session.lastPacketAt = s.args.now().getTime();
  const incidents = createIncidentPhotos({ db: s.db, snapshots: s.api, now: s.args.now, enabled: true, trialOnly: false });
  await incidents.enqueue('trialOne');
  await incidents.tick('trialOne');
  const photoId = s.db.rows.get('incidentPhotos/trialOne').requestIds[0];
  await receive(s, photoId);
  s.auth(photoId).analysis = { status: 'unavailable', reason: 'analysis_failed', privateText: 'secret description' };
  return { ...s, photoId, probe: { db: s.db, snapshots: s.api, photoId, now: s.args.now } };
}

test('inspection selects safe fields and refuses a mismatched incident', async () => {
  const s = await savedPhoto();
  const rowsBefore = structuredClone([...s.db.rows]);
  const report = await inspectIncidentPhoto(s.probe);
  assert.equal(report.incidentId, 'trialOne');
  assert.equal(report.photos[0].aiReason, 'analysis_failed');
  for (const hidden of ['secret', 'sha256', 'privateSafetySnapshots', 'serviceOwnerUid']) {
    assert.equal(JSON.stringify(report).includes(hidden), false);
  }
  assert.deepEqual([...s.db.rows], rowsBefore);
  s.db.rows.get('incidentPhotos/trialOne').ownerUid = 'outsider';
  await assert.rejects(inspectIncidentPhoto(s.probe), /invalid_incident/);
});

test('inspection revalidates stored storage diagnostics and omits raw provider fields', async () => {
  const s = await savedPhoto();
  s.auth(s.photoId).receiveDiagnostics = { failureStage: 'storage', storageError: {
    statusCode: 503, code: 'secret object path', reason: 'backendError', name: 'ApiError',
    message: 'secret provider response', headers: { authorization: 'secret token' },
  } };
  const before = structuredClone([...s.db.rows]);
  const report = await inspectIncidentPhoto(s.probe);
  assert.equal(report.photos[0].failureStage, 'storage');
  assert.deepEqual(report.photos[0].storageError, {
    statusCode: 503, code: null, reason: 'backendError', name: 'ApiError',
  });
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.deepEqual([...s.db.rows], before);
});

test('inspection sanitizes persisted command timelines and makes no writes or device requests', async () => {
  const s = await savedPhoto();
  s.auth(s.photoId).receiveDiagnostics.commandTimeline = {
    version: 1, startedAt: 'private path', endedAt: '2026-10-01T00:00:01.000Z',
    endReason: 'private secret', duringWriteAttempts: 1, duringDropped: 0,
    rawFrame: 'private frame', events: [
      { afterMs: 100, phase: 'during', source: 'downlink', command: 'UPLOAD',
        reportingIntervalSeconds: 60, bytes: 29, sameSession: true, body: 'private payload' },
      { afterMs: 500, phase: 'during', source: 'private-source', command: 'private-command',
        bytes: 20, reportingIntervalSeconds: 'private', sameSession: true },
      { afterMs: 'private time', command: 'LK' },
    ],
  };
  const before = structuredClone([...s.db.rows]), writes = s.writes.length;
  const report = await inspectIncidentPhoto(s.probe);
  const timeline = report.photos[0].commandTimeline;
  assert.equal(timeline.startedAt, null); assert.equal(timeline.endReason, null);
  assert.equal(timeline.events.length, 2); assert.equal(timeline.events[0].reportingIntervalSeconds, 60);
  assert.equal(timeline.events[1].command, 'OTHER'); assert.equal(timeline.events[1].source, 'other');
  assert.equal(JSON.stringify(report).includes('private'), false);
  assert.deepEqual([...s.db.rows], before); assert.equal(s.writes.length, writes);
});

test('inspection exposes only a bounded HTTP status for failed analysis and stays read-only', async () => {
  const s = await savedPhoto();
  for (const httpStatus of [400, 401, 404, 429, 503, 99, 600, 401.5, '401', null, { secret: 'token' }]) {
    s.auth(s.photoId).analysis = { status: 'unavailable', reason: 'analysis_http_error', diagnostics: {
      httpStatus, body: 'secret provider body', headers: { authorization: 'secret token' },
    } };
    const before = structuredClone([...s.db.rows]);
    const report = await inspectIncidentPhoto(s.probe);
    const expected = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    assert.equal(report.photos[0].aiHttpStatus, expected);
    assert.equal(JSON.stringify(report).includes('secret'), false);
    assert.deepEqual([...s.db.rows], before);
  }
  s.auth(s.photoId).analysis = { status: 'unavailable', reason: 'analysis_failed', diagnostics: { httpStatus: 401 } };
  assert.equal((await inspectIncidentPhoto(s.probe)).photos[0].aiHttpStatus, null);
  delete s.auth(s.photoId).analysis;
  assert.equal((await inspectIncidentPhoto(s.probe)).photos[0].aiHttpStatus, null);
});

test('explicit probe accepts fenced AI output on one saved original and leaves saved analysis intact', async () => {
  const s = await savedPhoto();
  const photoBefore = structuredClone(s.auth(s.photoId));
  const incidentBefore = structuredClone(s.db.rows.get('incidentPhotos/trialOne'));
  const keysBefore = new Set(s.db.rows.keys());
  let calls = 0;
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async (url, request) => {
    calls++;
    assert.deepEqual(Buffer.from(JSON.parse(request.body).messages[0].content[0].source.data, 'base64'), original);
    return { ok: true, json: async () => ({ stop_reason: 'end_turn',
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(result) + '\n```' }] }) };
  } });
  const report = await probeOriginal({ ...s.probe, analyze });
  assert.equal(calls, 1);
  assert.equal(s.writes.length, 1, 'only the fixture setup sent a camera command');
  assert.deepEqual(report, { outcome: 'probe_succeeded', status: 'too_unclear', basis: 'original_photo',
    model: 'test-only', promptVersion: PROMPT_VERSION,
    visibleDetailCount: 0, uncertaintyCount: 0, limitationCount: 1, savedAnalysisChanged: false });
  assert.deepEqual(s.auth(s.photoId), photoBefore);
  assert.deepEqual(s.db.rows.get('incidentPhotos/trialOne'), incidentBefore);
  const added = [...s.db.rows.keys()].filter(key => !keysBefore.has(key));
  assert.equal(added.length, 1);
  assert.equal(s.db.rows.get(added[0]).type, 'viewed');
});

test('description output is opt-in, validated, reauthorized and never saved by the probe', async () => {
  const s = await savedPhoto();
  const photoBefore = structuredClone(s.auth(s.photoId));
  const description = { ...result, summary: 'The view is mostly dark.', model: 'configured-model',
    responseModel: 'provider-model', promptVersion: 3, privateExtra: 'secret raw content' };
  const hidden = await probeOriginal({ ...s.probe, analyze: async () => description });
  assert.equal(hidden.analysis, undefined);
  assert.equal(JSON.stringify(hidden).includes(description.summary), false);
  const report = await probeOriginal({ ...s.probe, analyze: async () => description, showAnalysis: true });
  assert.equal(report.analysis.summary, description.summary);
  assert.equal(report.analysis.responseModel, 'provider-model');
  assert.equal(report.analysis.privateExtra, undefined);
  assert.deepEqual(s.auth(s.photoId), photoBefore);
  assert.equal(s.writes.length, 1);
  const invalid = await probeOriginal({ ...s.probe, showAnalysis: true,
    analyze: async () => ({ ...description, summary: 'The wearer is safe.' }) });
  assert.equal(invalid.outcome, 'probe_failed');
  assert.equal(invalid.analysis, undefined);
  const revoked = await probeOriginal({ ...s.probe, showAnalysis: true, analyze: async () => {
    s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
    return description;
  } });
  assert.equal(revoked.outcome, 'probe_blocked');
  assert.equal(revoked.analysis, undefined);
});

test('description flag requires a confirmed probe and malformed CLI options fail before any work', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const base = ['--photo', id];
  assert.throws(() => parseInspectionArgs([...base, '--show-analysis']), /probe_required/);
  assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--show-analysis']), /probe_confirmation_required/);
  assert.throws(() => parseInspectionArgs([...base, '--photo', id]), /invalid_arguments/);
  assert.throws(() => parseInspectionArgs([...base, '--bucket']), /invalid_arguments/);
  assert.throws(() => parseInspectionArgs([...base, '--unknown']), /invalid_arguments/);
  assert.deepEqual(parseInspectionArgs([...base, '--probe-ai', '--confirm', '--show-analysis']),
    { photoId: id, bucket: undefined, probe: true, showAnalysis: true });
});

test('rotation flag is explicit, bounded and requires a confirmed probe', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const base = ['--photo', id];
  assert.throws(() => parseInspectionArgs([...base, '--rotate-clockwise', '270']), /probe_required/);
  assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--rotate-clockwise', '270']), /probe_confirmation_required/);
  for (const angle of ['-90', '45', '360', '90.0', 'NaN', '']) {
    assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--confirm', '--rotate-clockwise', angle]));
  }
  for (const angle of ['0', '90', '180', '270']) {
    assert.equal(parseInspectionArgs([...base, '--probe-ai', '--confirm', '--rotate-clockwise', angle]).rotateClockwise, Number(angle));
  }
});

test('automatic orientation probe requires confirmation and cannot take a manual rotation', () => {
  const base = ['--photo', '00000000-0000-0000-0000-000000000001'];
  assert.throws(() => parseInspectionArgs([...base, '--probe-orientation']), /probe_required/);
  assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--probe-orientation']), /probe_confirmation_required/);
  assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--confirm', '--probe-orientation', '--rotate-clockwise', '270']), /invalid_arguments/);
  assert.equal(parseInspectionArgs([...base, '--probe-ai', '--confirm', '--probe-orientation']).orientationProbe, true);
  assert.throws(() => parseInspectionArgs([...base, '--save-analysis']), /orientation_probe_required/);
  assert.throws(() => parseInspectionArgs([...base, '--probe-ai', '--probe-orientation', '--save-analysis']), /probe_confirmation_required/);
  assert.equal(parseInspectionArgs([...base, '--probe-ai', '--probe-orientation', '--confirm', '--save-analysis']).saveAnalysis, true);
});

const recoveryResult = { status: 'ready', summary: 'A chair is visible.', visibleDetails: [],
  uncertainDetails: [], limitations: [], orientation: { clockwiseDegrees: null, confidence: 'low' },
  inputRotationClockwiseDegrees: 270, model: 'test-model', responseModel: 'test-model', promptVersion: 4,
  orientationSelection: { method: 'four_views_then_description', clockwiseDegrees: 270,
    confidence: 'high', model: 'test-model', responseModel: 'test-model', promptVersion: 1 } };
async function recoverablePhoto(reason = 'analysis_orientation_inconsistent') {
  const s = await savedPhoto();
  s.auth(s.photoId).analysis = { status: 'unavailable', reason,
    ...(reason === 'analysis_http_error' ? { diagnostics: { httpStatus: 400 } } :
      reason === 'analysis_invalid_json' ? { diagnostics: { contentFormat: 'other' } } : {}) };
  return s;
}

for (const reason of ['analysis_orientation_inconsistent', 'analysis_http_error', 'analysis_invalid_json']) {
test(`explicit recovery of ${reason} preserves the entire capture lifecycle`, async () => {
  const s = await recoverablePhoto(reason);
  const before = structuredClone(s.auth(s.photoId));
  const incidentBefore = structuredClone(s.db.rows.get('incidentPhotos/trialOne'));
  const alertBefore = structuredClone(s.db.rows.get('alerts/trialOne'));
  const lockBefore = structuredClone(s.db.rows.get(`safetySnapshotDeviceLocks/${imei}`));
  const originalBefore = await s.api.image('owner', s.photoId);
  let calls = 0;
  const analyze = async () => { calls++; return recoveryResult; };
  const report = await probeOriginal({ ...s.probe, analyze, saveAnalysis: true });
  assert.equal(report.outcome, 'analysis_saved');
  assert.equal(report.savedAnalysisChanged, true);
  assert.equal(report.orientationSelection.verification, 'uncertain');
  assert.equal(report.analysis, undefined);
  const after = s.auth(s.photoId);
  assert.equal(after.analysis.summary, recoveryResult.summary);
  assert.equal(after.analysis.generatedAt.toISOString(), s.args.now().toISOString());
  assert.deepEqual({ ...after, analysis: before.analysis }, before);
  assert.deepEqual(s.db.rows.get('incidentPhotos/trialOne'), incidentBefore);
  assert.deepEqual(s.db.rows.get('alerts/trialOne'), alertBefore);
  assert.deepEqual(s.db.rows.get(`safetySnapshotDeviceLocks/${imei}`), lockBefore);
  assert.deepEqual(await s.api.image('owner', s.photoId), originalBefore);
  const again = await probeOriginal({ ...s.probe, analyze, saveAnalysis: true });
  assert.equal(again.reason, 'analysis_not_recoverable');
  assert.equal(calls, 1);
  assert.equal(s.writes.length, 1);
});

test(`recovery of ${reason} rechecks access, original identity and unchanged analysis in the final transaction`, async () => {
  for (const change of ['consent', 'deleted', 'photo_expiry', 'incident_expiry', 'owner', 'subscription', 'path', 'hash', 'concurrent_analysis']) {
    const s = await recoverablePhoto(reason);
    const runTransaction = s.db.runTransaction;
    s.db.runTransaction = async fn => {
      if (change === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
      if (change === 'deleted') s.auth(s.photoId).state = 'deleted';
      if (change === 'photo_expiry') s.auth(s.photoId).mediaExpiresAt = s.args.now();
      if (change === 'incident_expiry') s.db.rows.get('incidentPhotos/trialOne').expiresAt = s.args.now();
      if (change === 'owner') s.db.rows.get('incidentPhotos/trialOne').ownerUid = 'outsider';
      if (change === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
      if (change === 'path') s.auth(s.photoId).mediaPath = 'changed';
      if (change === 'hash') s.auth(s.photoId).sha256 = 'changed';
      if (change === 'concurrent_analysis') s.auth(s.photoId).analysis = { status: 'ready', summary: 'A newer description.' };
      return runTransaction(fn);
    };
    const report = await probeOriginal({ ...s.probe, analyze: async () => recoveryResult, saveAnalysis: true });
    assert.equal(report.outcome, 'probe_blocked', change);
    assert.equal(report.analysis, undefined, change);
    assert.notEqual(s.auth(s.photoId).analysis.summary, recoveryResult.summary, change);
    assert.equal(s.writes.length, 1, change);
  }
});

test(`competing recovery of ${reason} cannot overwrite a saved result`, async () => {
  const s = await recoverablePhoto(reason);
  const reports = await Promise.all([1, 2].map(() => probeOriginal({ ...s.probe,
    analyze: async () => recoveryResult, saveAnalysis: true })));
  assert.equal(reports.filter(r => r.outcome === 'analysis_saved').length, 1);
  assert.equal(reports.filter(r => r.outcome === 'probe_blocked').length, 1);
  assert.equal(s.auth(s.photoId).analysis.summary, recoveryResult.summary);
  assert.equal(s.writes.length, 1);
});
}

for (const reason of ['analysis_http_error', 'analysis_invalid_json']) {
test(`another provider rejection during ${reason} recovery leaves the saved failure intact`, async () => {
  const s = await recoverablePhoto(reason);
  const before = structuredClone(s.auth(s.photoId));
  const incidentBefore = structuredClone(s.db.rows.get('incidentPhotos/trialOne'));
  let calls = 0;
  const report = await probeOriginal({ ...s.probe, saveAnalysis: true, analyze: async () => {
    calls++;
    throw new PhotoAnalysisError('analysis_http_error', { httpStatus: 400 });
  } });
  assert.deepEqual(report, { outcome: 'probe_failed', status: 'unavailable', reason: 'analysis_http_error',
    diagnostics: { httpStatus: 400 } });
  assert.equal(calls, 1, 'no automatic retry');
  assert.deepEqual(s.auth(s.photoId), before);
  assert.deepEqual(s.db.rows.get('incidentPhotos/trialOne'), incidentBefore);
  assert.equal(s.writes.length, 1, 'no new camera command');
});
}

test('saved invalid-JSON analysis can recover through both structured vision calls', async () => {
  const { createOrientedPhotoAnalyzer } = require('./helpers/photo-provider');
  const s = await recoverablePhoto('analysis_invalid_json');
  const before = structuredClone(s.auth(s.photoId));
  let calls = 0;
  const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'selected-model', fetchImpl: async (url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    assert.equal(body.output_config.format.type, 'json_schema');
    const selection = body.output_config.format.schema.required.includes('view');
    assert.equal(selection, calls === 1);
    const value = selection ? { view: 'D', confidence: 'high' }
      : { status: 'ready', summary: 'A chair is visible.', visibleDetails: [], uncertainDetails: [], limitations: [],
        orientation: { clockwiseDegrees: 0, confidence: 'high' } };
    return { ok: true, json: async () => ({ model: 'selected-model', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(value) }] }) };
  } });
  const report = await probeOriginal({ ...s.probe, saveAnalysis: true, analyze });
  assert.equal(calls, 2);
  assert.equal(report.outcome, 'analysis_saved');
  assert.equal(report.orientationSelection.verification, 'confirmed');
  assert.equal(report.inputRotationClockwiseDegrees, 270);
  assert.equal(s.auth(s.photoId).analysis.summary, 'A chair is visible.');
  assert.deepEqual({ ...s.auth(s.photoId), analysis: before.analysis }, before);
  assert.deepEqual(await s.api.image('owner', s.photoId), original);
  assert.equal(s.writes.length, 1, 'no new camera command');
});

test('recovery refuses other analyses before AI and leaves the old failure intact on invalid output', async () => {
  for (const analysis of [{ status: 'pending' }, { status: 'analysing' }, { status: 'ready' },
    { status: 'unavailable', reason: 'analysis_failed' }]) {
    const s = await recoverablePhoto();
    s.auth(s.photoId).analysis = analysis;
    const report = await probeOriginal({ ...s.probe, saveAnalysis: true, analyze: async () => assert.fail('no AI call') });
    assert.equal(report.reason, 'analysis_not_recoverable');
    assert.deepEqual(s.auth(s.photoId).analysis, analysis);
  }
  const s = await recoverablePhoto();
  const before = structuredClone(s.auth(s.photoId));
  const report = await probeOriginal({ ...s.probe, saveAnalysis: true,
    analyze: async () => ({ ...recoveryResult, summary: 'The person is safe.' }) });
  assert.equal(report.outcome, 'probe_failed');
  assert.deepEqual(s.auth(s.photoId), before);
});

test('orientation probe preserves disagreement evidence without changing stored analysis or taking a photo', async () => {
  const { createOrientedPhotoAnalyzer } = require('./helpers/photo-provider');
  for (const revoked of [false, true]) {
    const s = await savedPhoto();
    const before = structuredClone(s.auth(s.photoId));
    let calls = 0;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'selected-model', fetchImpl: async () => {
      if (++calls === 1 && revoked) s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
      const value = calls === 1 ? { view: 'D', confidence: 'high' } : {
        ...result, orientation: { clockwiseDegrees: 90, confidence: 'high' },
      };
      return { ok: true, json: async () => ({ model: 'response-model', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(value) }] }) };
    } });
    const report = await probeOriginal({ ...s.probe, analyze });
    assert.equal(calls, revoked ? 1 : 2);
    if (revoked) assert.notEqual(report.outcome, 'probe_succeeded');
    else {
      assert.equal(report.outcome, 'probe_succeeded');
      assert.equal(report.orientationSelection.clockwiseDegrees, 270);
      assert.equal(report.orientationSelection.verification, 'conflicting');
      assert.equal(report.orientation.clockwiseDegrees, 90);
      assert.equal(report.model, 'selected-model');
      assert.equal(report.promptVersion, PROMPT_VERSION);
      assert.equal(report.savedAnalysisChanged, false);
      assert.equal(report.analysis, undefined);
      assert.equal(JSON.stringify(report).includes('too dark.'), false);
    }
    assert.deepEqual(s.auth(s.photoId), before);
    assert.equal(s.writes.length, 1);
  }
});

test('rotated probe sends one PNG, reports its basis and leaves stored original and analysis intact', async () => {
  const s = await savedPhoto();
  const photoBefore = structuredClone(s.auth(s.photoId));
  const incidentBefore = structuredClone(s.db.rows.get('incidentPhotos/trialOne'));
  let calls = 0;
  const analyze = createPhotoAnalyzer({ apiKey: 'test-only', model: 'test-only', fetchImpl: async (url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    assert.equal(body.messages[0].content[0].source.media_type, 'image/png');
    assert.deepEqual(Buffer.from(body.messages[0].content[0].source.data, 'base64'),
      require('../src/incident-photo-rotation').rotatedPhotoPng(original, 270));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      ...result, orientation: { clockwiseDegrees: 0, confidence: 'high' },
    }) }] }) };
  } });
  const report = await probeOriginal({ ...s.probe, analyze, rotateClockwise: 270, showAnalysis: true });
  assert.equal(report.outcome, 'probe_succeeded');
  assert.equal(report.basis, 'rotated_original_photo');
  assert.equal(report.inputRotationClockwiseDegrees, 270);
  assert.equal(report.inputEncoding, 'png');
  assert.equal(report.orientationReference, 'analysis_input');
  assert.equal(report.analysis.basis, report.basis);
  assert.equal(report.analysis.orientation.clockwiseDegrees, 0, 'relative to supplied input, not stored original');
  assert.equal(report.savedAnalysisChanged, false);
  assert.equal(calls, 1);
  assert.deepEqual(s.auth(s.photoId), photoBefore);
  assert.deepEqual(s.db.rows.get('incidentPhotos/trialOne'), incidentBefore);
  assert.deepEqual(await s.api.image('owner', s.photoId), original);
  assert.equal(s.writes.length, 1, 'only fixture setup sent a camera command');
});

test('probe blocks revoked consent, expiry, deletion, changed ownership and revoked subscription before AI', async () => {
  for (const change of ['consent', 'expiry', 'incident_expiry', 'deleted', 'owner', 'subscription']) {
    const s = await savedPhoto();
    if (change === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
    if (change === 'expiry') s.advance(24 * 60 * 60_000 + 1);
    if (change === 'incident_expiry') s.db.rows.get('incidentPhotos/trialOne').expiresAt = s.args.now();
    if (change === 'deleted') await s.api.remove('owner', s.photoId);
    if (change === 'owner') s.db.rows.get('incidentPhotos/trialOne').ownerUid = 'outsider';
    if (change === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
    let calls = 0;
    const report = await probeOriginal({ ...s.probe, rotateClockwise: 270, analyze: async () => { calls++; return result; } });
    assert.equal(report.outcome, 'probe_blocked', change);
    assert.equal(calls, 0, change);
  }
});

test('probe does not retry a provider failure and does not release a result after deletion', async () => {
  const s = await savedPhoto();
  let calls = 0;
  const failed = await probeOriginal({ ...s.probe, analyze: async () => { calls++; throw Error('secret provider failure'); } });
  assert.deepEqual(failed, { outcome: 'probe_failed', status: 'unavailable', reason: 'analysis_failed' });
  assert.equal(calls, 1);
  const deleted = await probeOriginal({ ...s.probe, rotateClockwise: 270, analyze: async () => {
    await s.api.remove('owner', s.photoId); return result;
  } });
  assert.deepEqual(deleted, { outcome: 'probe_blocked', reason: 'access_changed_during_probe' });
  assert.equal(s.auth(s.photoId).analysis, null);
});
