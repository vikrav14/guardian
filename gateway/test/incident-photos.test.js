'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jpeg = require('jpeg-js');
const { setup, frame, receive, until, imei } = require('./helpers/photo-harness');
const { createIncidentPhotos } = require('../src/incident-photos');
const { createSnapshotController } = require('../src/safety-snapshot-live');
const { createSnapshotHttpHandler } = require('../src/safety-snapshot-http');
const { CONSENT_VERSION } = require('../src/incident-photo-policy');
const { randomUUID } = require('node:crypto');
const result = { status: 'ready', visibleDetails: ['A chair is visible.'], uncertainDetails: ['A shape may be a table.'], limitations: ['The image is blurred.'] };
function scene(n) {
  return jpeg.encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, n * 30) }, 50).data;
}
// Model a passive watch packet, not an outgoing wake/location command.
function advanceWithPacket(s, ms = 60_000) {
  s.advance(ms); s.session.lastPacketAt = s.args.now().getTime();
}
function trial(options = {}) {
  const s = setup();
  s.db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: true, consentVersion: CONSENT_VERSION });
  const args = { db: s.db, snapshots: s.api, now: s.args.now, enabled: true, trialOnly: false,
    analyze: async () => result, ...options };
  const api = createIncidentPhotos(args);
  const alarm = (id = 'alertOne', type = 'sos', extra = {}) => {
    s.db.rows.set(`alerts/${id}`, { imei, type, eventAt: s.args.now(), incidentPhotoEligible: true,
      incidentPhotoPending: true, notifyStatus: 'accepted', ...extra });
    // Existing sequence tests start with a subsequent watch packet received.
    s.advance(1); s.session.lastPacketAt = s.args.now().getTime();
  };
  const incident = (id = 'alertOne') => s.db.rows.get(`incidentPhotos/${id}`);
  const manual = () => api.requestByGuardian('owner', 'alertOne', { requestKey: randomUUID() });
  return { ...s, incidents: api, incidentArgs: args, alarm, incident, manual };
}

test('first automatic image and four explicit guardian images, no CR or overlapping workers', async () => {
  const s = trial(); s.alarm(); s.alarm('duplicateFall', 'fall');
  const other = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  await Promise.all([s.incidents.enqueue('alertOne'), other.enqueue('alertOne')]);
  await other.enqueue('duplicateFall');
  assert.equal(s.db.rows.get('alerts/duplicateFall').photoIncidentId, 'alertOne');
  for (let n = 1; n <= 5; n++) {
    if (n > 1) await s.manual();
    await s.incidents.tick('alertOne');
    await other.tick('alertOne');
    assert.equal(s.writes.length, n);
    const id = s.incident().requestIds.at(-1);
    await receive(s, id, frame({ image: scene(n) }));
    await s.incidents.analyzePhoto(id);
    await s.incidents.tick('alertOne');
    assert.equal(s.writes.length, n, 'next capture waits for the spacing boundary');
    advanceWithPacket(s);
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

test('first capture is prompt; the saved image starts a full minute gap across restart and competing workers', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
  const deadline = s.incident().deadlineAt;
  await s.incidents.tick('alertOne');
  assert.equal(s.writes.length, 1, 'first capture does not wait a minute');
  s.advance(20_000);
  await receive(s, s.incident().requestIds[0], frame({ image: scene(1) }));
  const savedAt = s.auth(s.incident().requestIds[0]).receivedAt;
  assert.equal(s.args.coordinator.busyUntil(imei), null, 'no camera guard during the spacing gap');
  advanceWithPacket(s, 10_000);
  await assert.rejects(s.manual(), /incident_photo_settling/);
  advanceWithPacket(s, 49_999);
  const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  await Promise.all([s.incidents.tick('alertOne'), restarted.tick('alertOne')]);
  await assert.rejects(s.manual(), /incident_photo_settling/);
  assert.equal(s.writes.length, 1, '59.999 seconds after save remains too early');
  advanceWithPacket(s, 1);
  const competing = await Promise.allSettled([s.manual(), restarted.requestByGuardian('member', 'alertOne', { requestKey: randomUUID() })]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(s.writes.length, 2, 'exactly one follow-up at the boundary');
  assert.equal(+s.auth(s.incident().requestIds[1]).createdAt - +savedAt, 60_000);
  assert.deepEqual(s.incident().deadlineAt, deadline);
  assert.deepEqual(restarted.getStatus().policy,
    { automaticPhotos: 1, guardianWindowSeconds: 3600, followupGapSeconds: 60, sequenceDeadlineSeconds: 720 });
});

test('a silent watch cannot consume a follow-up attempt after the minute gap', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[0]);
  const deadline = s.incident().deadlineAt;
  s.advance(60_000);
  await s.incidents.tick('alertOne');
  await assert.rejects(s.manual(), /incident_waiting_for_connection/);
  assert.equal(s.writes.length, 1);
  assert.equal(s.incident().requestIds.length, 1);
  advanceWithPacket(s, 5000);
  await s.manual();
  assert.equal(s.writes.length, 2);
  assert.deepEqual(s.incident().deadlineAt, deadline);
});

test('consent, access, expiry and disconnect are rechecked after spacing without another capture', async () => {
  for (const change of ['consent', 'owner_link', 'subscription', 'deadline', 'disconnect']) {
    const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
    await receive(s, s.incident().requestIds[0]);
    advanceWithPacket(s);
    if (change === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
    if (change === 'owner_link') s.db.rows.get('users/owner').linkedImeis = [];
    if (change === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
    if (change === 'deadline') s.advance(60 * 60_000);
    if (change === 'disconnect') s.matches([]);
    const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
    await restarted.tick('alertOne');
    await assert.rejects(s.manual());
    assert.equal(s.writes.length, 1, change);
    assert.equal(s.incident().requestIds.length, 1, change);
  }
});

test('a timeout stops the sequence, preserves earlier photo, and restart never replays a capture', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
  await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[0], frame({ image: scene(1) }));
  advanceWithPacket(s); await s.incidents.tick('alertOne'); await s.manual();
  const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  await restarted.tick('alertOne'); assert.equal(s.writes.length, 2);
  s.advance(240_001); await s.api.sweep(); await restarted.tick('alertOne');
  assert.equal(s.incident().state, 'complete');
  assert.equal(s.auth(s.incident().requestIds[1]).reason, 'image_timeout');
  await restarted.tick('alertOne'); assert.equal(s.writes.length, 2);
  const gallery = await restarted.gallery('owner', 'alertOne');
  assert.deepEqual(gallery.photos.map(p => p.state), ['available', 'failed']);
});

test('delayed incident image can arrive after existing recovery without another capture or a renewed deadline', async () => {
  const s = trial(); s.alarm('alertOne', 'fall'); await s.incidents.enqueue('alertOne');
  await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0];
  const expires = +s.auth(id).authorizationExpiresAt;
  assert.equal(expires - +s.auth(id).createdAt, 240_000);
  assert.equal(+s.db.rows.get(`safetySnapshotDeviceLocks/${imei}`).activeUntil, expires);
  s.advance(180_000);
  await s.api.sweep(); await s.incidents.tick('alertOne');
  assert.equal(s.auth(id).state, 'waiting_for_image');
  assert.equal(s.writes.length, 1, 'waiting neither retries capture nor sends CR');
  for (const [command, options] of [
    ['CR', {}], ['UPLOAD,60', { emergency: true }], ['LK', { protocolReply: true }],
    ['CALL,private', {}], ['HRTSTART,0', {}],
  ]) assert.equal(s.args.coordinator.decide(imei, command, options).ok, true, command);
  assert.equal(s.args.coordinator.decide(imei, 'HRTSTART,1').error, 'camera_busy');
  assert.equal(s.args.coordinator.decide(imei, 'UPLOAD,600', { expiresAt: s.args.now() }).error, 'command_expired');
  // Simulate only the already-authorized recovery write observed in the trace.
  // The photo controller itself still makes exactly one camera write.
  require('../src/photo-command-timeline').noteDeviceWrite(s.socket, s.session,
    Buffer.from('[SG*9705254749*0002*CR]'), 'downlink', s.args.now());
  s.advance(7553); await receive(s, id);
  assert.equal(s.auth(id).state, 'available'); assert.equal(s.objects.size, 1);
  assert.equal(+s.auth(id).authorizationExpiresAt, expires);
  const timeline = s.auth(id).receiveDiagnostics.commandTimeline;
  assert(timeline.events.some(e => e.command === 'CR' && e.afterMs === 180_000));
  assert.equal(+new Date(timeline.endedAt) - +new Date(timeline.startedAt), 187_553);
  assert.equal(s.args.coordinator.busyUntil(imei), null);
  await s.incidents.analyzePhoto(id);
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).summary.length, 1);
  await s.incidents.tick('alertOne'); assert.equal(s.writes.length, 1);
  advanceWithPacket(s, 60_000); await s.incidents.tick('alertOne');
  assert.equal(s.writes.length, 1, 'no automatic follow-up');
  await s.manual();
  assert.equal(s.writes.length, 2, 'explicit guardian request respects spacing from actual save');
});

test('new incident wait is capped by sequence deadline and never accepts at or beyond expiry', async () => {
  for (const remaining of [90_000, 240_000]) {
    const s = trial(); s.alarm('alertOne', 'fall'); await s.incidents.enqueue('alertOne');
    s.incident().deadlineAt = new Date(+s.args.now() + remaining);
    await s.incidents.tick('alertOne'); const id = s.incident().requestIds[0];
    const expires = +s.auth(id).authorizationExpiresAt;
    assert.equal(expires, +s.incident().deadlineAt);
    s.advance(remaining); s.api.observe(frame(), s.socket, s.session);
    await s.api.sweep(); await s.incidents.tick('alertOne');
    assert.equal(s.auth(id).state, 'failed'); assert.equal(s.objects.size, 0);
    assert.equal(s.writes.length, 1); assert.equal(s.incident().state, 'stopped');
    assert.equal(+s.auth(id).authorizationExpiresAt, expires);
  }
});

test('longer incident wait still rejects lost access, consent, deletion and another session', async () => {
  for (const reason of ['consent', 'link', 'subscription', 'deletion', 'session', 'disconnect']) {
    const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
    const id = s.incident().requestIds[0]; s.advance(187_553);
    if (reason === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
    if (reason === 'link') s.db.rows.get('users/owner').linkedImeis = [];
    if (reason === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
    if (reason === 'deletion') await s.api.remove('owner', id);
    if (reason === 'disconnect') { s.api.disconnect(s.socket); await until(() => s.auth(id).state === 'failed'); }
    if (reason === 'session') s.api.observe(frame(), {}, { ...s.session });
    else { s.api.observe(frame(), s.socket, s.session); await until(() => !['waiting_for_image', 'receiving'].includes(s.auth(id).state)); }
    assert.equal(s.objects.size, 0, reason); assert.equal(s.writes.length, 1, reason);
    assert.notEqual(s.auth(id).state, 'available', reason);
    s.advance(240_000); await s.api.sweep();
  }
});

test('restart keeps old persisted two-minute grants and cannot replay or adopt their late images', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0];
  const originalExpiry = new Date(+s.auth(id).createdAt + 120_000);
  s.auth(id).authorizationExpiresAt = originalExpiry;
  s.db.rows.get(`safetySnapshotDeviceLocks/${imei}`).activeUntil = originalExpiry;
  const restartedSnapshots = createSnapshotController(s.args);
  const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: restartedSnapshots });
  s.advance(120_001); await restartedSnapshots.sweep(); await restarted.tick('alertOne');
  s.advance(67_552); restartedSnapshots.observe(frame(), s.socket, s.session);
  await restarted.tick('alertOne');
  assert.equal(s.auth(id).reason, 'image_timeout'); assert.equal(s.incident().state, 'stopped');
  assert.equal(+s.auth(id).authorizationExpiresAt, +originalExpiry);
  assert.equal(s.writes.length, 1); assert.equal(s.objects.size, 0);
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

test('a real alarm waits without consuming an attempt, then selects a fresh replacement over the silent alarm socket', async () => {
  const s = trial(); s.alarm();
  s.session.lastPacketAt = s.db.rows.get('alerts/alertOne').eventAt.getTime();
  await s.incidents.enqueue('alertOne');
  const deadline = s.incident().deadlineAt;
  await s.incidents.tick('alertOne');
  assert.equal(s.writes.length, 0);
  assert.deepEqual(s.incident().requestIds, []);
  assert.equal(s.incidents.getStatus().lastCaptureOutcome, 'waiting_for_connection');
  assert.equal([...s.db.rows.keys()].some(key => key.startsWith('safetySnapshotAuthorizations/')), false);
  const replacementWrites = [];
  s.advance(24_000);
  const socket = { writable: true, write(bytes, callback) { replacementWrites.push(bytes.toString()); callback?.(); } };
  const session = { ...s.session, lastPacketAt: s.args.now().getTime() };
  s.matches([{ socket: s.socket, session: s.session }, { socket, session }]);
  await s.incidents.tick('alertOne');
  assert.equal(s.writes.length, 0, 'the silent old socket must never receive rcapture');
  assert.deepEqual(replacementWrites, ['[3G*9705254749*0008*rcapture]']);
  assert.deepEqual(s.incident().deadlineAt, deadline, 'waiting must not extend the sequence');
  const id = s.incident().requestIds[0];
  s.api.observe(frame(), s.socket, s.session);
  assert.equal(s.auth(id).state, 'waiting_for_image', 'the old socket cannot supply this request');
  s.api.observe(frame(), socket, session);
  await until(() => s.auth(id).state === 'available');
});

test('unreported, stale, future, mismatched and ambiguous post-alarm sessions cannot capture', async () => {
  for (const kind of ['missing', 'stale', 'future', 'mismatched', 'ambiguous']) {
    const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
    if (kind === 'missing') delete s.session.lastPacketAt;
    if (kind === 'stale') s.advance(30_001);
    if (kind === 'future') s.session.lastPacketAt = s.args.now().getTime() + 1;
    if (kind === 'mismatched') s.session.protocolId = '0000000000';
    if (kind === 'ambiguous') s.matches([{ socket: s.socket, session: s.session },
      { socket: { writable: true }, session: { ...s.session } }]);
    await s.incidents.tick('alertOne');
    assert.equal(s.writes.length, 0, kind);
    assert.deepEqual(s.incident().requestIds, [], kind);
    assert.equal(s.incident().state, 'collecting', kind);
  }
});

test('waiting across restart ends at the original sequence deadline without capture', async () => {
  const s = trial(); s.alarm(); s.matches([]); await s.incidents.enqueue('alertOne');
  await s.incidents.tick('alertOne');
  const restarted = createIncidentPhotos({ ...s.incidentArgs, snapshots: createSnapshotController(s.args) });
  s.advance(12 * 60_000);
  s.matches([{ socket: s.socket, session: { ...s.session, lastPacketAt: s.args.now().getTime() } }]);
  await restarted.tick('alertOne');
  assert.equal(s.writes.length, 0);
  assert.equal(s.incident().reason, 'sequence_deadline');
  assert.deepEqual(s.incident().requestIds, []);
});

test('a handed-off incident capture is never replayed onto a fresh replacement', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const socket = { writable: true, write() { assert.fail('request replayed'); } };
  s.advance(24_000);
  const session = { ...s.session, lastPacketAt: s.args.now().getTime() };
  s.matches([{ socket, session }]);
  await s.incidents.tick('alertOne');
  s.api.observe(frame(), socket, session);
  assert.equal(s.auth(s.incident().requestIds[0]).state, 'waiting_for_image');
  s.advance(240_001); await s.api.sweep(); await s.incidents.tick('alertOne');
  assert.equal(s.incident().reason, 'image_timeout');
  assert.equal(s.writes.length, 1);
});

test('no-ACK capture on a subsequently silent connection stops despite a reporting replacement', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
  // Reproduce the observed order: a post-alarm packet, first capture, then a
  // replacement. This does not assign a firmware/call cause to that ordering.
  s.advance(856); s.session.lastPacketAt = +s.args.now();
  s.advance(4500); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0];
  const replacement = { writable: true, write() { assert.fail('ambiguous request replayed'); } };
  s.advance(18_900);
  const replacementSession = { ...s.session, lastPacketAt: +s.args.now() };
  s.matches([{ socket: s.socket, session: s.session }, { socket: replacement, session: replacementSession }]);
  await s.incidents.tick('alertOne');
  assert.equal(s.auth(id).state, 'waiting_for_image');
  s.advance(156_600); s.api.disconnect(s.socket);
  await until(() => s.auth(id).state === 'failed'); await s.incidents.tick('alertOne');
  assert.equal(s.incident().reason, 'watch_disconnected');
  assert.equal(s.auth(id).receiveDiagnostics.bytes, 0);
  assert.equal(s.auth(id).receiveDiagnostics.rcaptureReplies, 0);
  assert.equal(s.writes.length, 1); assert.equal(s.objects.size, 0);
});

test('late admission and a late camera claim cannot dispatch after their deadlines', async () => {
  const old = trial(); old.alarm();
  const admit = old.db.runTransaction;
  old.db.runTransaction = fn => { old.advance(90_001); return admit(fn); };
  await old.incidents.enqueue('alertOne');
  assert.equal(old.incident(), undefined);
  assert.equal(old.db.rows.get('alerts/alertOne').incidentPhotoStatus, 'unavailable');
  for (const kind of ['authorization', 'sequence', 'replacement']) {
    const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne');
    if (kind === 'sequence') s.db.rows.get('incidentPhotos/alertOne').deadlineAt = new Date(s.args.now().getTime() + 1000);
    const transact = s.db.runTransaction;
    let first = true;
    s.db.runTransaction = async fn => {
      const value = await transact(fn);
      if (first) {
        first = false;
        s.advance(kind === 'sequence' ? 1001 : kind === 'authorization' ? 240_001 : 1);
        s.session.lastPacketAt = s.args.now().getTime();
        if (kind === 'replacement') s.matches([{ socket: { ...s.socket }, session: s.session }]);
      }
      return value;
    };
    await s.incidents.tick('alertOne');
    assert.equal(s.writes.length, 0, kind);
    assert.equal(s.auth(s.incident().requestIds[0]).reason,
      kind === 'replacement' ? 'watch_disconnected' : 'dispatch_expired');
  }
});

test('a slow follow-up query is visible and cannot hold the capture loop', async () => {
  const s = trial();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const collection = s.db.collection;
  s.db.collection = name => {
    const col = collection(name);
    if (name === 'incidentPhotos') {
      const where = col.where;
      col.where = (field, ...args) => field !== 'followupState' ? where(field, ...args) : {
        limit: count => ({ get: async () => { await waiting; return where(field, ...args).limit(count).get(); } }),
      };
    }
    return col;
  };
  await s.incidents.sweep();
  assert.equal(s.incidents.getStatus().analysisFollowup.stage, 'followup_queue_read');
  assert.equal(s.incidents.getStatus().capture.running, false);
  s.advance(60_001); s.alarm();
  await s.incidents.sweep();
  assert.equal(s.writes.length, 1, 'pending analysis/follow-up I/O must not block a fresh alarm');
  assert.equal(s.incidents.getStatus().analysisFollowup.operationSlow, true);
  release(); await s.incidents.drain();
  assert.equal(s.incidents.getStatus().analysisFollowup.running, false);
});

test('trial-only mode accepts a labelled supervised trial without sending emergency messages', async () => {
  let sent = 0;
  const s = trial({ trialOnly: true, onComplete: async () => { sent++; } });
  s.alarm('alertOne', 'sos', { incidentPhotoTrial: true, notifyStatus: 'skipped' });
  await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(s.writes.length, 1);
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).trial, true);
  s.advance(240_001); await s.api.sweep(); await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(sent, 0);
});

test('identical image replay is not counted as a second distinct incident photo', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  await receive(s, s.incident().requestIds[0]); advanceWithPacket(s); await s.incidents.tick('alertOne');
  await s.manual();
  await receive(s, s.incident().requestIds[1]); await s.incidents.tick('alertOne');
  assert.equal(s.incident().state, 'complete');
  assert.equal(s.auth(s.incident().requestIds[1]).reason, 'duplicate_incident_image');
  assert.equal(s.auth(s.incident().requestIds[1]).receiveDiagnostics.rejectionReason, 'duplicate_incident_image');
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).photos.filter(p => p.state === 'available').length, 1);
});

test('slow AI never blocks the next capture, and deleting during AI cannot resurrect details', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const s = trial({ analyze: async () => { await waiting; return result; } });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  const analysis = s.incidents.analyzePhoto(id);
  await until(() => s.auth(id).analysis.status === 'analysing');
  advanceWithPacket(s); await s.incidents.tick('alertOne'); await s.manual(); assert.equal(s.writes.length, 2);
  await s.api.remove('owner', id); release(); await analysis;
  assert.equal(s.auth(id).state, 'deleted'); assert.equal(s.auth(id).analysis, null);
});

test('revoked household/AI consent and expiry win over analysis and new capture', async () => {
  const s = trial(); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id); await s.incidents.analyzePhoto(id);
  s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).photos[0].analysis.status, 'unavailable');
  s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
  advanceWithPacket(s); await s.incidents.tick('alertOne'); assert.equal(s.writes.length, 1);
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

test('viewing orientation is saved with AI, preserves original bytes and follows consent and deletion', async () => {
  const orientation = { clockwiseDegrees: 270, confidence: 'high' };
  let calls = 0;
  const s = trial({ analyze: async () => { calls++; return { ...result, orientation }; } });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  const original = await s.api.image('owner', id);
  await s.incidents.analyzePhoto(id); await s.incidents.analyzePhoto(id);
  assert.equal(calls, 1);
  assert.equal(s.auth(id).analysis.version, 2);
  assert.deepEqual((await s.incidents.gallery('member', 'alertOne')).photos[0].analysis.orientation, orientation);
  assert.deepEqual(await s.api.image('owner', id), original);
  s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
  assert.equal((await s.incidents.gallery('owner', 'alertOne')).photos[0].analysis.orientation, undefined);
  await s.api.remove('owner', id);
  assert.equal(s.auth(id).analysis, null);
});

test('concise summaries and bounded provenance persist under the same private analysis lifecycle', async () => {
  const description = { ...result, summary: 'A chair stands beside a window.', visibleDetails: [],
    model: 'configured-alias', responseModel: 'provider-model-20260901', promptVersion: 3,
    privateExtra: 'secret provider details' };
  const s = trial({ analyze: async () => description });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  await s.incidents.analyzePhoto(id);
  const gallery = await s.incidents.gallery('member', 'alertOne');
  assert.equal(gallery.photos[0].analysis.summary, description.summary);
  assert.equal(gallery.photos[0].analysis.model, 'configured-alias');
  assert.equal(gallery.photos[0].analysis.responseModel, 'provider-model-20260901');
  assert.equal(gallery.photos[0].analysis.promptVersion, 3);
  assert.equal(gallery.photos[0].analysis.version, 3);
  assert.equal(gallery.summary[0].text, description.summary);
  assert.equal(JSON.stringify(gallery).includes('secret provider details'), false);
  s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
  assert.deepEqual((await s.incidents.gallery('owner', 'alertOne')).photos[0].analysis, { status: 'unavailable' });
  await s.api.remove('owner', id);
  assert.equal(s.auth(id).analysis, null);
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

test('photo follow-up waits for the original alert and accepts its delivered webhook state', async () => {
  let sent = 0;
  const s = trial({ onComplete: async () => { sent++; return { ok: true }; } });
  s.alarm('alertOne', 'fall', { notifyStatus: 'sending' });
  await s.incidents.enqueue('alertOne');
  s.incident().state = 'stopped';
  await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(sent, 0); assert.equal(s.incident().followupState, 'pending');
  s.db.rows.get('alerts/alertOne').notifyStatus = 'delivered';
  await s.incidents.sweep(); await s.incidents.drain();
  assert.equal(sent, 1); assert.equal(s.incident().followupState, 'accepted');
});

test('live orientation selection persists with the summary and original, and rechecks access between provider calls', async () => {
  const { createOrientedPhotoAnalyzer } = require('./helpers/photo-provider');
  for (const change of ['none', 'consent', 'deleted', 'expiry', 'incident_expiry', 'owner', 'subscription']) {
    let s; let calls = 0; let id;
    const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'test-model', fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        if (change === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
        if (change === 'deleted') await s.api.remove('owner', id);
        if (change === 'expiry') s.advance(24 * 60 * 60_000 + 1);
        if (change === 'incident_expiry') s.incident().expiresAt = s.args.now();
        if (change === 'owner') s.incident().ownerUid = 'outsider';
        if (change === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
      }
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', model: 'test-model', content: [{ type: 'text',
        text: JSON.stringify(calls === 1 ? { view: 'D', confidence: 'high' } : {
          ...result, summary: 'A chair is visible.', orientation: { clockwiseDegrees: 0, confidence: 'high' },
        }) }] }) };
    } });
    s = trial({ analyze }); s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
    id = s.incident().requestIds[0]; await receive(s, id);
    const before = await s.api.image('owner', id);
    await s.incidents.analyzePhoto(id);
    assert.equal(calls, change === 'none' ? 2 : 1, change);
    if (change === 'none') {
      const gallery = await s.incidents.gallery('member', 'alertOne');
      assert.equal(gallery.photos[0].analysis.inputRotationClockwiseDegrees, 270);
      assert.equal(gallery.photos[0].analysis.orientationSelection.clockwiseDegrees, 270);
      assert.equal(gallery.photos[0].analysis.orientation.clockwiseDegrees, 0);
      assert.equal(gallery.summary[0].text, 'A chair is visible.');
      assert.deepEqual(await s.api.image('owner', id), before);
      await s.api.remove('owner', id);
      assert.equal(s.auth(id).analysis, null);
    } else assert.notEqual(s.auth(id).analysis?.status, 'ready');
    assert.equal(s.writes.length, 1);
  }
});

test('orientation disagreement keeps the description and provenance in the gallery under normal privacy controls', async () => {
  const { createOrientedPhotoAnalyzer } = require('./helpers/photo-provider');
  let calls = 0;
  const analyze = createOrientedPhotoAnalyzer({ apiKey: 'test-only', model: 'configured-model', fetchImpl: async () => ({
    ok: true, json: async () => ({ stop_reason: 'end_turn', model: 'provider-model', content: [{ type: 'text',
      text: JSON.stringify(++calls === 1 ? { view: 'D', confidence: 'high' } : {
        ...result, summary: 'A chair is visible.', orientation: { clockwiseDegrees: 90, confidence: 'high' },
      }) }] }),
  }) });
  const s = trial({ analyze });
  s.alarm(); await s.incidents.enqueue('alertOne'); await s.incidents.tick('alertOne');
  const id = s.incident().requestIds[0]; await receive(s, id);
  const before = await s.api.image('owner', id);
  await s.incidents.analyzePhoto(id); await s.incidents.analyzePhoto(id);
  const gallery = await s.incidents.gallery('member', 'alertOne');
  assert.equal(calls, 2);
  assert.equal(gallery.summary[0].text, 'A chair is visible.');
  assert.equal(gallery.photos[0].analysis.status, 'ready');
  assert.equal(gallery.photos[0].analysis.orientationSelection.verification, 'conflicting');
  assert.equal(gallery.photos[0].analysis.model, 'configured-model');
  assert.deepEqual(await s.api.image('owner', id), before);
  s.db.rows.get(`incidentPhotoSettings/${imei}`).aiConsentConfirmed = false;
  assert.equal((await s.incidents.gallery('member', 'alertOne')).photos[0].analysis.summary, undefined);
  await s.api.remove('owner', id);
  assert.equal(s.auth(id).analysis, null);
  assert.equal(s.writes.length, 1);
});
