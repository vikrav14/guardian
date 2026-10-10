'use strict';

const { asDate } = require('../src/safety-snapshot-policy');
const { validIncidentId, consentAllows, CAPTURE_POLICY, REQUEST_WINDOW_MS, SEQUENCE_MS } = require('../src/incident-photo-policy');

// Explicit administrator repair, never an automatic sweep or a capture retry.
// The normal worker rechecks recipients/consent and claims the follow-up once.
async function restoreGroupedIncidentFollowup({ db, alertId, expectedParentId, authorize,
  apply = false, now = () => new Date() }) {
  if (!validIncidentId(alertId) || !validIncidentId(expectedParentId) || alertId === expectedParentId) throw Error('invalid_repair_target');
  const alertRef = db.collection('alerts').doc(alertId);
  const initial = (await alertRef.get()).data();
  const access = initial && await authorize(initial.imei);
  if (!access?.ok || !access.ownerUid) throw Error('repair_access_unavailable');
  return db.runTransaction(async tx => {
    const incidentRef = db.collection('incidentPhotos').doc(alertId);
    const [alertDoc, existing, parentDoc, wellbeingDoc, deliveryDoc] = await Promise.all([
      tx.get(alertRef), tx.get(incidentRef), tx.get(db.collection('incidentPhotos').doc(expectedParentId)),
      tx.get(db.collection('incidentWellbeing').doc(alertId)), tx.get(db.collection('incidentPhotoDelivery').doc(alertId)),
    ]);
    if (existing.exists) return { outcome: 'already_exists' };
    const alert = alertDoc.data(), parent = parentDoc.data(), wellbeing = wellbeingDoc.data(), at = now();
    const settings = alert && (await tx.get(db.collection('incidentPhotoSettings').doc(alert.imei))).data();
    const eventAt = asDate(alert?.eventAt), expiresAt = asDate(wellbeing?.expiresAt);
    if (!alert || alert.imei !== initial.imei || !['sos', 'fall'].includes(alert.type) ||
        alert.incidentPhotoEligible !== true || alert.incidentPhotoTrial === true || alert.incidentPhotoPending ||
        alert.photoIncidentId !== expectedParentId || alert.wellbeingIncidentId !== alertId ||
        !['accepted', 'partial', 'sent', 'delivered'].includes(alert.notifyStatus) || deliveryDoc.exists ||
        !eventAt || eventAt > at || !expiresAt || expiresAt <= at ||
        !parent || parent.imei !== alert.imei || parent.ownerUid !== access.ownerUid ||
        parent.followupState !== 'accepted' || !asDate(parent.eventAt) || asDate(parent.eventAt) >= eventAt ||
        !wellbeing || wellbeing.id !== alertId || wellbeing.imei !== alert.imei || wellbeing.ownerUid !== access.ownerUid ||
        +asDate(wellbeing.eventAt) !== +eventAt || !['available', 'partial', 'unavailable'].includes(wellbeing.state) ||
        wellbeing.frozenAt || !consentAllows(settings, access.ownerUid)) throw Error('repair_evidence_changed_or_ineligible');
    if (!apply) return { outcome: 'ready', type: alert.type, eventAt, readingsState: wellbeing.state, photoCount: 0 };
    tx.create(incidentRef, { id: alertId, imei: alert.imei, ownerUid: access.ownerUid, type: alert.type,
      eventAt, trial: false, createdAt: at, updatedAt: at, deadlineAt: new Date(+eventAt + SEQUENCE_MS),
      capturePolicy: CAPTURE_POLICY, requestWindowEndsAt: new Date(+eventAt + REQUEST_WINDOW_MS),
      expiresAt, requestIds: [], target: 1, state: 'stopped', reason: 'prior_incident_link',
      nextAt: at, followupState: 'pending', restoredFromIncidentId: expectedParentId });
    tx.update(alertRef, { photoIncidentId: alertId,
      photoFollowupRepair: { at, previousIncidentId: expectedParentId, reason: 'prior_incident_link' } });
    return { outcome: 'queued', type: alert.type, eventAt, readingsState: wellbeing.state, photoCount: 0 };
  });
}

module.exports = { restoreGroupedIncidentFollowup };
