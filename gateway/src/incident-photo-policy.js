'use strict';

const { asDate } = require('./safety-snapshot-policy');
const MAX_PHOTOS = 5;
const SEQUENCE_MS = 12 * 60_000;
const GAP_MS = 10_000;
const CONSENT_VERSION = 'incident-photos-v1';
const validIncidentId = id => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''));
function deny(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
function consentAllows(settings, ownerUid, { ai = false } = {}) {
  return settings?.enabled === true && settings.ownerUid === ownerUid &&
    settings.consentVersion === CONSENT_VERSION && settings.consentConfirmed === true &&
    (!ai || settings.aiConsentConfirmed === true);
}

// Called inside the same transaction as the shared camera lock. Only the
// server-owned incident record can authorize the shorter emergency spacing.
async function readIncidentAuthorization(db, tx, incidentId, uid, imei, at) {
  if (!validIncidentId(incidentId)) deny('invalid_incident');
  const ref = db.collection('incidentPhotos').doc(incidentId);
  const incident = (await tx.get(ref)).data();
  const settings = (await tx.get(db.collection('incidentPhotoSettings').doc(imei))).data();
  if (!incident || incident.ownerUid !== uid || incident.imei !== imei ||
      incident.state !== 'collecting' || !consentAllows(settings, uid) ||
      !(asDate(incident.deadlineAt) > at) || incident.requestIds.length >= MAX_PHOTOS ||
      (asDate(incident.nextAt) && asDate(incident.nextAt) > at)) deny('incident_not_active');
  if (incident.requestIds.length) {
    const previous = (await tx.get(db.collection('safetySnapshotAuthorizations')
      .doc(incident.requestIds.at(-1)))).data();
    if (previous?.state !== 'available' || !(asDate(previous.receivedAt) <= new Date(at.getTime() - GAP_MS))) {
      deny('incident_waiting_for_photo');
    }
  }
  return { ref, incident };
}

module.exports = { MAX_PHOTOS, SEQUENCE_MS, GAP_MS, CONSENT_VERSION, validIncidentId,
  consentAllows, readIncidentAuthorization };
