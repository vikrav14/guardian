'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setup, frame, until, imei } = require('./helpers/photo-harness');
const { createSnapshotController } = require('../src/safety-snapshot-live');
const { createIncidentPhotos } = require('../src/incident-photos');
const { CONSENT_VERSION, CAPTURE_POLICY } = require('../src/incident-photo-policy');
const { readIncidentPhotoRollout } = require('../src/incident-photo-rollout');
const { noteIncidentPhotoTelemetry } = require('../src/incident-photo-readiness');
const { buildFollowupPlan } = require('../src/incident-photo-templates');

const env = { INCIDENT_PHOTO_GUARDIAN_WINDOW_ENABLED: 'true', INCIDENT_PHOTO_SOS_SETTLE_ENABLED: 'true' };
async function incident(type = 'sos') {
  const s = setup();
  const rollout = readIncidentPhotoRollout(env);
  s.api = createSnapshotController({ ...s.args, initialSosSettleEnabled: rollout.initialSosSettleEnabled });
  s.db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: true, consentVersion: CONSENT_VERSION });
  s.db.rows.set('alerts/alarm', { imei, type, eventAt: s.args.now(), incidentPhotoEligible: true,
    incidentPhotoPending: true, notifyStatus: 'accepted' });
  const options = { db: s.db, snapshots: s.api, now: s.args.now, enabled: true, trialOnly: false, ...rollout };
  s.incidents = createIncidentPhotos(options);
  await s.incidents.enqueue('alarm');
  const packet = (ms, type = 'heartbeat', session = s.session) => {
    s.advance(ms); session.lastPacketAt = +s.args.now();
    noteIncidentPhotoTelemetry(session, [{ type }], session.lastPacketAt);
  };
  return { ...s, options, packet, row: () => s.db.rows.get('incidentPhotos/alarm'),
    request: () => s.incidents.requestByGuardian('owner', 'alarm', { requestKey: randomUUID() }) };
}

test('app rollout does not approve new Meta templates; old environments stay compatible', () => {
  assert.deepEqual(readIncidentPhotoRollout({}), { guardianWindowEnabled: false,
    compactTemplatesApproved: false, initialSosSettleEnabled: false });
  assert.equal(readIncidentPhotoRollout(env).guardianWindowEnabled, true);
  assert.equal(readIncidentPhotoRollout(env).compactTemplatesApproved, false);
  assert.equal(readIncidentPhotoRollout({ INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED: 'true' }).guardianWindowEnabled, true);
  assert.equal(readIncidentPhotoRollout({ INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED: 'true',
    INCIDENT_PHOTO_GUARDIAN_WINDOW_ENABLED: 'false' }).guardianWindowEnabled, false);
});

test('one-photo window uses approved legacy follow-up until compact copy is explicitly approved', () => {
  const gallery = { capturePolicy: CAPTURE_POLICY, eventAt: new Date(),
    photos: [{ captureSource: 'automatic', state: 'failed' }], summary: [] };
  for (const context of [{}, { compactTemplatesApproved: false }]) {
    const plan = buildFollowupPlan('alarm', gallery, context);
    assert.equal(plan.templateName, 'guardian_incident_photo_update_v1');
    assert.deepEqual(plan.components[0].parameters.map(p => p.text),
      ['0', '0', 'No incident photos were received.']);
    assert.equal(plan.components[1].parameters[0].text, 'alarm');
  }
  assert.equal(buildFollowupPlan('alarm', gallery, { compactTemplatesApproved: true }).templateName,
    'guardian_incident_photo_update_v3');
});

test('23:15 SOS trace waits through early heartbeat/UPLOAD echo and chooses only later replacement telemetry', async () => {
  const s = await incident();
  s.packet(170); // Early heartbeat during the same alarm/call transition.
  s.packet(630, 'command_echo');
  s.advance(5000); await s.incidents.tick('alarm');
  assert.equal(s.writes.length, 0); assert.deepEqual(s.row().requestIds, []);
  assert.equal(s.args.coordinator.busyUntil(imei), null);
  const end = +s.row().deadlineAt;
  const replacementWrites = [];
  const socket = { writable: true, write(bytes, cb) { replacementWrites.push(bytes.toString()); cb?.(); return true; } };
  const session = { imei, protocolId: s.session.protocolId };
  s.packet(18600, 'heartbeat', session);
  s.matches([{ socket: s.socket, session: s.session }, { socket, session }]);
  await s.incidents.tick('alarm'); assert.equal(replacementWrites.length, 0);
  // Merely passing 30 seconds is insufficient: require new passive telemetry.
  s.packet(6000, 'command_echo', session);
  await s.incidents.tick('alarm'); assert.equal(replacementWrites.length, 0);
  s.packet(1000, 'heartbeat', session);
  await s.incidents.tick('alarm');
  assert.equal(s.writes.length, 0);
  assert.deepEqual(replacementWrites, ['[3G*9705254749*0008*rcapture]']);
  assert.equal(+s.row().deadlineAt, end);
  const id = s.row().requestIds[0];
  s.api.observe(frame(), socket, session);
  await until(() => s.auth(id).state === 'available');
  await s.incidents.tick('alarm');
  assert.equal(s.row().state, 'complete');
  assert.equal(replacementWrites.length, 1);
});

test('initial wait rejects stale/future/ambiguous telemetry and alarm-location frames', async () => {
  for (const kind of ['stale', 'future', 'ambiguous', 'alarm_location', 'echo_only']) {
    const s = await incident(); s.advance(31000);
    s.session.lastPacketAt = +s.args.now();
    const events = kind === 'alarm_location' ? [{ type: 'alarm' }, { type: 'location' }]
      : [{ type: kind === 'echo_only' ? 'command_echo' : 'heartbeat' }];
    noteIncidentPhotoTelemetry(s.session, events, +s.args.now());
    if (kind === 'stale') { s.advance(30001); s.session.lastPacketAt = +s.args.now(); }
    if (kind === 'future') s.session.incidentPhotoTelemetryAt++;
    if (kind === 'ambiguous') s.matches([{ socket: s.socket, session: s.session },
      { socket: { writable: true }, session: { ...s.session } }]);
    await s.incidents.tick('alarm');
    assert.equal(s.writes.length, 0, kind); assert.deepEqual(s.row().requestIds, [], kind);
  }
});

test('passive wait never extends its deadline; restart rechecks consent before first dispatch', async () => {
  for (const failure of ['deadline', 'consent', 'subscription']) {
    const s = await incident();
    const restarted = createIncidentPhotos({ ...s.options, snapshots: createSnapshotController({
      ...s.args, initialSosSettleEnabled: true }) });
    s.packet(failure === 'deadline' ? 720001 : 31000);
    if (failure === 'consent') s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
    if (failure === 'subscription') s.db.rows.get('serviceSubscriptions/owner').status = 'cancelled';
    await restarted.tick('alarm');
    assert.equal(s.writes.length, 0, failure); assert.deepEqual(s.row().requestIds, [], failure);
  }
});

test('fall first photo stays prompt; a failed automatic attempt retains app access, late guard and explicit recovery', async () => {
  const s = await incident('fall'); s.packet(1);
  await s.incidents.tick('alarm'); const id = s.row().requestIds[0];
  assert.equal(s.writes.length, 1);
  const ends = +(await s.incidents.current('member', imei)).requestWindowEndsAt;
  const before = await s.incidents.current('member', imei);
  assert.equal(before.incidentId, 'alarm'); assert.equal(before.reason, 'camera_busy');
  s.api.disconnect(s.socket); await until(() => s.auth(id).state === 'failed');
  await s.incidents.tick('alarm');
  assert.equal((await s.incidents.current('member', imei)).reason, 'incident_photo_settling');
  await assert.rejects(s.request(), /incident_photo_settling/);
  s.packet(360001);
  const access = await s.incidents.current('member', imei);
  assert.equal(access.canRequest, true); assert.equal(+access.requestWindowEndsAt, ends);
  const restarted = createIncidentPhotos({ ...s.options, snapshots: createSnapshotController({
    ...s.args, initialSosSettleEnabled: true }) });
  await restarted.tick('alarm'); assert.equal(s.writes.length, 1, 'no automatic replay');
  const extra = await s.request(); assert.notEqual(extra, id); assert.equal(s.writes.length, 2);
});

test('disabled rollout and legacy alerts have honest reasons; enabling does not reopen old authorizations', async () => {
  const s = await incident();
  const disabled = createIncidentPhotos({ ...s.options, guardianWindowEnabled: false });
  assert.equal((await disabled.current('member', imei)).reason, 'photo_feature_unavailable');
  delete s.row().capturePolicy;
  assert.equal((await s.incidents.current('member', imei)).reason, 'photo_window_not_enabled_for_incident');
  await assert.rejects(s.request(), /incident_not_active/);
  assert.equal(s.writes.length, 0);
});
