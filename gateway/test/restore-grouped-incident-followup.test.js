'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { database, imei } = require('./helpers/photo-harness');
const { CONSENT_VERSION } = require('../src/incident-photo-policy');
const { restoreGroupedIncidentFollowup: restore } = require('../scripts/restore-grouped-incident-followup');

function fixture() {
  const db = database(), at = new Date('2026-09-25T01:00:00Z');
  const eventAt = new Date(+at - 20 * 60000), expiresAt = new Date(+at + 3600000);
  db.rows.set(`incidentPhotoSettings/${imei}`, { ownerUid: 'owner', enabled: true, consentConfirmed: true, consentVersion: CONSENT_VERSION });
  db.rows.set('alerts/fall', { imei, type: 'fall', eventAt, incidentPhotoEligible: true,
    photoIncidentId: 'sos', wellbeingIncidentId: 'fall', notifyStatus: 'partial' });
  db.rows.set('incidentPhotos/sos', { imei, ownerUid: 'owner', eventAt: new Date(+eventAt - 600000), followupState: 'accepted', requestIds: ['old-photo'] });
  db.rows.set('incidentWellbeing/fall', { id: 'fall', imei, ownerUid: 'owner', eventAt, expiresAt,
    state: 'available', readings: { fixture: 'private' } });
  return { db, alertId: 'fall', expectedParentId: 'sos', now: () => at, authorize: async () => ({ ok: true, ownerUid: 'owner' }) };
}

test('dry run is read-only; competing repair queues one independent follow-up without photo capture or changing readings', async () => {
  const f = fixture(), before = structuredClone(f.db.rows);
  assert.equal((await restore(f)).outcome, 'ready');
  assert.deepEqual(f.db.rows, before);
  const results = await Promise.all([restore({ ...f, apply: true }), restore({ ...f, apply: true })]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['already_exists', 'queued']);
  const own = f.db.rows.get('incidentPhotos/fall');
  assert.equal(own.type, 'fall'); assert.equal(own.state, 'stopped'); assert.equal(own.followupState, 'pending');
  assert.deepEqual(own.requestIds, []);
  assert.equal(f.db.rows.get('alerts/fall').photoIncidentId, 'fall');
  assert.deepEqual(f.db.rows.get('incidentPhotos/sos'), before.get('incidentPhotos/sos'));
  assert.deepEqual(f.db.rows.get('incidentWellbeing/fall'), before.get('incidentWellbeing/fall'));
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('safetySnapshot')), false);
});

test('repair rejects changed links, consent, owner, expired or active readings and an existing transport attempt', async () => {
  for (const change of ['link', 'consent', 'owner', 'expired', 'active', 'delivery', 'future', 'trial']) {
    const f = fixture();
    if (change === 'link') f.db.rows.get('alerts/fall').photoIncidentId = 'different';
    if (change === 'consent') f.db.rows.get(`incidentPhotoSettings/${imei}`).enabled = false;
    if (change === 'owner') f.authorize = async () => ({ ok: true, ownerUid: 'other' });
    if (change === 'expired') f.db.rows.get('incidentWellbeing/fall').expiresAt = f.now();
    if (change === 'active') f.db.rows.get('incidentWellbeing/fall').state = 'collecting';
    if (change === 'delivery') f.db.rows.set('incidentPhotoDelivery/fall', { results: [] });
    if (change === 'future') f.db.rows.get('alerts/fall').eventAt = new Date(+f.now() + 1);
    if (change === 'trial') f.db.rows.get('alerts/fall').incidentPhotoTrial = true;
    const before = structuredClone(f.db.rows);
    await assert.rejects(restore({ ...f, apply: true }), /repair_evidence_changed_or_ineligible/, change);
    assert.deepEqual(f.db.rows, before);
  }
});
