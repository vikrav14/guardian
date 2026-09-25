'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jpeg = require('jpeg-js');
const { setup, frame, receive, until, imei } = require('./helpers/photo-harness');
const { createIncidentPhotos } = require('../src/incident-photos');
const { createSnapshotController } = require('../src/safety-snapshot-live');
const { createSnapshotHttpHandler } = require('../src/safety-snapshot-http');
const { CONSENT_VERSION, GAP_MS } = require('../src/incident-photo-policy');
const result = { status: 'ready', visibleDetails: ['A chair is visible.'], uncertainDetails: ['A shape may be a table.'], limitations: ['The image is blurred.'] };
function scene(n) {
  return jpeg.encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, n * 30) }, 50).data;
}
function trial(options = {}) {
  const s = setup();
  s.db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: true, consentVersion: CONSENT_VERSION });
  const args = { db: s.db, snapshots: s.api, now: s.args.now, enabled: true, trialOnly: false,
    analyze: async () => result, ...options };
  const api = createIncidentPhotos(args);
  const alarm = (id = 'alertOne', type = 'sos', extra = {}) => s.db.rows.set(`alerts/${id}`, {
    imei, type, eventAt: s.args.now(), incidentPhotoEligible: true, incidentPhotoPending: true, notifyStatus: 'accepted', ...extra });
  const incident = (id = 'alertOne') => s.db.rows.get(`incidentPhotos/${id}`);
  return { ...s, incidents: api, incidentArgs: args, alarm, incident };
}

test('five sequential distinct images, no CR, exact gaps, one batch across duplicate SOS/fall and workers', async () => {
  const s = trial(); s.alarm(); s.alarm('duplicateFall', 'fall');
  const other = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  await Promise.all([s.incidents.enqueue('alertOne'), other.enqueue('alertOne')]);
  await other.enqueue('duplicateFall');
  assert.equal(s.db.rows.get('alerts/duplicateFall').photoIncidentId, 'alertOne');
  for (let n = 1; n <= 5; n++) {
    await s.incidents.tick('alertOne');
    await other.tick('alertOne');
    assert.equal(s.writes.length, n);
    const id = s.incident().requestIds.at(-1);
    await receive(s, id, frame({ image: scene(n) }));
    await s.incidents.analyzePhoto(id);
    await s.incidents.tick('alertOne');
    assert.equal(s.writes.length, n, 'next capture waits for the spacing boundary');
    s.advance(GAP_MS);
  }
  await s.incidents.tick('alertOne');
  assert.equal(s.writes.length, 5);
  assert(s.writes.every(bytes => bytes.toString() === '[3G*9705254749*0008*rcapture]'));
  assert.equal(s.incident().state, 'complete');
  const gallery = await s.incidents.gallery('member', 'duplicateFall');
  assert.equal(gallery.photos.length, 5);
  assert.equal(gallery.summary[2].photo, 3);
  assert.equal(gallery.photos[0].analysis.basis, 'original_photo');
  assert.equal(JSON.stringify(gallery).includes('privateSafetySnapshots'), false);
  await assert.rejects(s.incidents.gallery('outsider', 'alertOne'), /incident_not_found/);
});

test('a timeout stops the sequence, preserves earlier photo, and restart never replays a capture', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
  await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[0], frame({ image: scene(1) }));
  s.advance(GAP_MS); await s.incidents.tick('alertOne');
  const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  await restarted.tick('alertOne'); assert.equal(s.writes.length, 2);
  s.advance(120_001); await s.api.sweep(); await restarted.tick('alertOne');
  assert.equal(s.incident().state, 'stopped');
  assert.equal(s.incident().reason, 'image_timeout');
  await restarted.tick('alertOne'); assert.equal(s.writes.length, 2);
  const gallery = await restarted.gallery('owner', 'alertOne');
  assert.deepEqual(gallery.photos.map(p => p.state), ['available', 'failed']);
});

test('emergency spacing cannot be selected through a manual input or a fabricated incident', async () => {
  const s = trial();
  const input = { imei, purpose: 'Manual test capture', consentConfirmed: true, safetyPurposeConfirmed: true };
  await assert.rejects(s.api.requestIncident('owner', imei, 'fabricated'), /incident_not_active/);
  await s.api.request('owner', input);
  await assert.rejects(s.api.request('owner', { ...input, incidentId: 'fabricated' }), /camera_busy/);
  const disabled = createSnapshotController({ ...s.args, runtime: { ...s.args.runtime, manualTestEnabled: false } });
  await assert.rejects(disabled.request('owner', input), /manual_photos_disabled/);
  assert.equal(s.writes.length, 1);
});

test('consent, server-origin, fresh event and explicit runtime enrollment are required', async () => {
  for (const scenario of ['disabled', 'no_consent', 'app_sos', 'old_alarm', 'trial_only']) {
    const s = trial(scenario === 'disabled' ? { enabled: false } : scenario === 'trial_only' ? { trialOnly: true } : {});
    s.alarm('alertOne', 'sos', scenario === 'app_sos' ? { incidentPhotoEligible: false } : {});
    if (scenario === 'old_alarm') s.advance(90_001);
    if (scenario === 'no_consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
    await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
    assert.equal(s.writes.length, 0, scenario);
  }
});

test('trial-only mode accepts a labelled supervised trial without sending emergency messages', async () => {
  let sent = 0;
  const s = trial({ trialOnly: true, onComplete: async () => { sent++; } });
  s.alarm('alertOne', 'sos', { incidentPhotoTrial: true, notifyStatus: 'skipped' });
  await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(s.writes.length, 1);
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).trial, true);
  s.advance(120_001); await s.api.sweep(); await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(sent, 0);
});

test('identical image replay is not counted as a second distinct incident photo', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[0]); s.advance(GAP_MS); await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[1]); await s.incidents.tick('alertOne');
  assert.equal(s.incident().state, 'stopped');
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).photos.filter(p => p.state === 'available').length, 1);
});

test('slow AI never blocks the next capture, and deleting during AI cannot resurrect details', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const s = trial({ analyze: async () => { await waiting; return result; } });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  const analysis = s.incidents.analyzePhoto(id);
  await until(() => s.auth(id).analysis.status === 'analysing');
  s.advance(GAP_MS); await s.incidents.tick('alertOne'); assert.equal(s.writes.length, 2);
  await s.api.remove('owner', id); release(); await analysis;
  assert.equal(s.auth(id).state, 'deleted'); assert.equal(s.auth(id).analysis, null);
});

test('revoked household/AI consent and expiry win over analysis and new capture', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id); await s.incidents.analyzePhoto(id);
  s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).photos[0].analysis.status, 'unavailable');
  s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
  s.advance(GAP_MS); await s.incidents.tick('alertOne'); assert.equal(s.writes.length, 1);
  assert.equal(s.incident().state, 'stopped');
  s.db.rows.get('users/owner').memberUids = [];
  await assert.rejects(s.incidents.gallery('member', 'alertOne'), /family_membership_not_verified/);
  s.advance(24 * 60 * 60_000);
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).state, 'expired');
  await s.api.sweep(); assert.equal(s.auth(id).analysis, null);
});

test('AI failure does not remove a valid photo; follow-up is at most once across workers', async () => {
  let sends = 0;
  const s = trial({ analyze: async () => { throw Error('provider unavailable'); }, onComplete: async () => { sends++; return { ok: true }; } });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  await s.incidents.analyzePhoto(id); assert.equal(s.auth(id).analysis.status, 'unavailable');
  s.incident().state = 'stopped';
  const other = createIncidentPhotos(s.incidentArgs);
  await Promise.all([s.incidents.sweep(), other.sweep()]);
  await Promise.all([s.incidents.drain(), other.drain()]);
  assert.equal(sends, 1);
  assert.equal(s.auth(id).state, 'available');
});

test('incident HTTP reads require authentication, current household access and no-store', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
  const handler = createSnapshotHttpHandler({ controller: () => s.api, incidents: () => s.incidents,
    verifyToken: async token => { if (token === 'revoked') throw Error('revoked'); return { uid: token }; } });
  async function request(uid, method = 'GET') {
    const output = {};
    await handler({ method, headers: uid ? { authorization: `Bearer ${uid}` } : {} }, {
      writeHead: (status, headers) => { Object.assign(output, { status, headers }); },
      end: bytes => { output.body = JSON.parse(bytes); },
    }, new URL('https://gateway.example/api/incident-photos/alertOne'));
    return output;
  }
  assert.equal((await request(null)).status, 401);
  assert.equal((await request('revoked')).status, 401);
  assert.equal((await request('outsider')).status, 404);
  assert.equal((await request('owner', 'POST')).status, 404);
  const response = await request('member');
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(s.writes.length, 0, 'opening a gallery does not trigger capture');
});
