'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { incidentReadingParameters, canSendIncidentReadings } = require('../src/incident-wellbeing-message');
const { buildFollowupPlan, templateDefinitions, checkPhotoTemplates } = require('../src/incident-photo-templates');
const { CAPTURE_POLICY } = require('../src/incident-photo-policy');
const { database, imei } = require('./helpers/command-database');
const { incidentAccess } = require('../src/incident-wellbeing-live');
const at = new Date('2026-10-07T12:00:00Z');

test('new follow-up contains incident readings, receipt times and honest missing fields only after approval', () => {
  const gallery = { capturePolicy: CAPTURE_POLICY, photos: [], summary: [] };
  const readings = { pending: false, state: 'partial', readings: { heartBloodPressure: {
    receivedAt: at, values: { heartRateBpm: 72, systolicMmHg: 120, diastolicMmHg: 80 } } } };
  const context = { incident: { eventAt: at }, device: { nickname: 'Alex' }, compactTemplatesApproved: true, readings };
  assert.equal(buildFollowupPlan('incident1', gallery, context).templateName, 'guardian_incident_photo_update_v3');
  const plan = buildFollowupPlan('incident1', gallery, { ...context, incidentReadingsApproved: true });
  assert.equal(plan.templateName, 'guardian_incident_update_v1');
  const values = plan.components[0].parameters.map(p => p.text);
  assert.equal(values.length, 9);
  assert.match(values[4], /Heart rate: 72 bpm.*received 7 Oct 2026, 16:00 GMT\+4/);
  assert.match(values[5], /no fresh reading received/);
  assert.match(values[6], /120\/80 mmHg/);
  assert.match(values[7], /no fresh reading received/);
  assert.equal(plan.components[1].parameters[0].text, 'incident1');
  assert(incidentReadingParameters({ readings: {} }).every(line => line.includes('no fresh reading received')));
  assert.equal(buildFollowupPlan('incident1', gallery, { ...context, incidentReadingsApproved: true,
    readings: { pending: true } }).templateName, 'guardian_incident_photo_update_v3');
});

test('new template has sequential parameters and is isolated from the immediate alert templates', () => {
  const definitions = templateDefinitions({ appUrl: 'https://guardian.example', incidentReadings: true });
  assert.equal(definitions.length, 1);
  const body = definitions[0].components[0];
  assert.deepEqual([...body.text.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(body.example.body_text[0].length, 9);
  const rendered = body.text.replace(/\{\{(\d+)\}\}/g, (_, number) => body.example.body_text[0][number - 1]);
  assert(rendered.length <= 1024);
  assert.match(rendered, /receipt times, not measurement times/);
  assert.equal(checkPhotoTemplates(definitions.map(d => ({ ...d, status: 'APPROVED' })), definitions)[0].ready, true);
});

function family() {
  const db = database();
  const service = { ownerUid: 'owner', policyVersion: '2026-10',
    subscription: { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' },
    members: { owner: { status: 'active', whatsapp: true, whatsappConsent: true },
      viewer: { status: 'active', whatsapp: true, whatsappConsent: true, permissions: { alerts: true, photos: true } } } };
  db.rows.set(`familyServices/${imei}`, service);
  db.rows.set(`wellbeingConsents/${imei}`, { version: 1, status: 'granted', managedBy: 'guardian_admin', wearerAcknowledgedAt: new Date(+at - 1000) });
  db.rows.set('familyChannels/owner', { verifiedAtMs: +at - 1, phone: '+23050000001' });
  db.rows.set('familyChannels/viewer', { verifiedAtMs: +at - 1, phone: '+23050000002' });
  return { db, service };
}

test('health delivery requires current wellbeing permission and a verified, opted-in destination', async () => {
  const { db, service } = family();
  const incident = { imei, ownerUid: 'owner' }, owner = { guardianUid: 'owner', whatsapp: '+23050000001' };
  assert.equal(await canSendIncidentReadings(db, incident, owner, +at), true);
  assert.equal(await canSendIncidentReadings(db, incident, { ...owner, whatsapp: '+23050000003' }, +at), false);
  assert.equal(await canSendIncidentReadings(db, incident, { guardianUid: 'viewer', whatsapp: '+23050000002' }, +at), false);
  service.members.owner.whatsappConsent = false;
  assert.equal(await canSendIncidentReadings(db, incident, owner, +at), false);
});

test('incident collection checks active service owner and current wearer consent', async () => {
  const { db, service } = family();
  assert.equal((await incidentAccess(db, imei, 'owner', at)).ok, true);
  assert.equal((await incidentAccess(db, imei, 'different-owner', at)).ok, false);
  db.rows.get(`wellbeingConsents/${imei}`).status = 'revoked';
  assert.equal((await incidentAccess(db, imei, 'owner', at)).ok, false);
  db.rows.get(`wellbeingConsents/${imei}`).status = 'granted';
  service.subscription.status = 'cancelled';
  assert.equal((await incidentAccess(db, imei, 'owner', at)).ok, false);
});
