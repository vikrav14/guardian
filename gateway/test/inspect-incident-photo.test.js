'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, receive, imei } = require('./helpers/photo-harness');
const { createIncidentPhotos } = require('../src/incident-photos');
const { createPhotoAnalyzer } = require('../src/incident-photo-analysis');
const { CONSENT_VERSION } = require('../src/incident-photo-policy');
const { inspectIncidentPhoto, probeOriginal } = require('../scripts/inspect-incident-photo');
const original = require('./fixtures/photo-synthetic');
const result = { status: 'too_unclear', visibleDetails: [], uncertainDetails: [], limitations: ['The photo is too dark.'] };

async function savedPhoto() {
  const s = setup();
  s.db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: true, consentVersion: CONSENT_VERSION });
  s.db.rows.set('alerts/trialOne', { imei, type: 'sos', eventAt: s.args.now(),
    incidentPhotoEligible: true, incidentPhotoPending: true, notifyStatus: 'accepted' });
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
    visibleDetailCount: 0, uncertaintyCount: 0, limitationCount: 1, savedAnalysisChanged: false });
  assert.deepEqual(s.auth(s.photoId), photoBefore);
  assert.deepEqual(s.db.rows.get('incidentPhotos/trialOne'), incidentBefore);
  const added = [...s.db.rows.keys()].filter(key => !keysBefore.has(key));
  assert.equal(added.length, 1);
  assert.equal(s.db.rows.get(added[0]).type, 'viewed');
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
    const report = await probeOriginal({ ...s.probe, analyze: async () => { calls++; return result; } });
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
  const deleted = await probeOriginal({ ...s.probe, analyze: async () => {
    await s.api.remove('owner', s.photoId); return result;
  } });
  assert.deepEqual(deleted, { outcome: 'probe_blocked', reason: 'access_changed_during_probe' });
  assert.equal(s.auth(s.photoId).analysis, null);
});
