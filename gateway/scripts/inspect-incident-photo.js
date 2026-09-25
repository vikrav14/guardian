'use strict';

const { consentAllows, validIncidentId } = require('../src/incident-photo-policy');
const { asDate } = require('../src/safety-snapshot-policy');
const { createPhotoAnalyzer, analysisFailure } = require('../src/incident-photo-analysis');
const photoIdValid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '');

async function inspectIncidentPhoto({ db, photoId }) {
  if (!photoIdValid(photoId)) throw Error('invalid_photo_id');
  const photo = (await db.collection('safetySnapshotAuthorizations').doc(photoId).get()).data();
  if (!photo || !validIncidentId(photo.incidentId)) throw Error('incident_photo_not_found');
  const incident = (await db.collection('incidentPhotos').doc(photo.incidentId).get()).data();
  if (!incident || incident.imei !== photo.imei || incident.ownerUid !== photo.serviceOwnerUid ||
      !Array.isArray(incident.requestIds) || !incident.requestIds.includes(photoId) ||
      incident.requestIds.length > 5 || !incident.requestIds.every(photoIdValid)) throw Error('invalid_incident');
  const rows = await Promise.all(incident.requestIds.map(id => db.collection('safetySnapshotAuthorizations').doc(id).get()));
  return { outcome: 'inspection', incidentId: photo.incidentId, incidentState: incident.state,
    incidentReason: incident.reason || null, photos: rows.map(doc => {
      const row = doc.data() || {};
      // Explicit field selection: never include scene descriptions, identifiers
      // of household members, object paths, hashes or the original image.
      return { requestId: doc.id, sequence: row.sequence, state: row.state, reason: row.reason || null,
        aiStatus: row.analysis?.status || null, aiReason: row.analysis?.reason || null,
        failureStage: row.receiveDiagnostics?.failureStage || null,
        rejectionReason: row.receiveDiagnostics?.rejectionReason || null };
    }) };
}

async function probeOriginal({ db, snapshots, photoId, analyze, now = () => new Date() }) {
  if (!photoIdValid(photoId)) return { outcome: 'probe_blocked', reason: 'invalid_photo_id' };
  if (!analyze) return { outcome: 'probe_blocked', reason: 'analysis_not_configured' };
  const photo = (await db.collection('safetySnapshotAuthorizations').doc(photoId).get()).data();
  if (!photo || !validIncidentId(photo.incidentId)) return { outcome: 'probe_blocked', reason: 'incident_photo_not_found' };
  async function reauthorize() {
    const current = await snapshots.authorized(photo.serviceOwnerUid, photoId, { viewing: true });
    const settings = (await db.collection('incidentPhotoSettings').doc(photo.imei).get()).data();
    const incident = (await db.collection('incidentPhotos').doc(photo.incidentId).get()).data();
    if (current.imei !== photo.imei || current.serviceOwnerUid !== photo.serviceOwnerUid ||
        current.incidentId !== photo.incidentId || incident?.ownerUid !== photo.serviceOwnerUid ||
        incident?.imei !== photo.imei || !incident?.requestIds?.includes(photoId) ||
        !(asDate(incident?.expiresAt) > now()) ||
        !consentAllows(settings, photo.serviceOwnerUid, { ai: true })) throw Error('probe_access_unavailable');
  }
  let bytes;
  try {
    await reauthorize();
    bytes = await snapshots.image(photo.serviceOwnerUid, photoId);
    await reauthorize();
  } catch { return { outcome: 'probe_blocked', reason: 'original_or_consent_unavailable' }; }
  let result;
  try { result = await analyze(bytes); }
  catch (error) { return { outcome: 'probe_failed', ...analysisFailure(error) }; }
  try { await reauthorize(); }
  catch { return { outcome: 'probe_blocked', reason: 'access_changed_during_probe' }; }
  return { outcome: 'probe_succeeded', status: result.status, basis: 'original_photo',
    visibleDetailCount: result.visibleDetails.length, uncertaintyCount: result.uncertainDetails.length,
    limitationCount: result.limitations.length, savedAnalysisChanged: false };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = name => args.includes(`--${name}`);
  const value = name => args[args.indexOf(`--${name}`) + 1];
  if (!flag('photo') || !photoIdValid(value('photo'))) throw Error('invalid_photo_id');
  if (flag('probe-ai') && !flag('confirm')) throw Error('probe_confirmation_required');
  const config = require('../src/config');
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw Error('firestore_unavailable');
  try {
    console.log(JSON.stringify(await inspectIncidentPhoto({ db, photoId: value('photo') }), null, 2));
    if (!flag('probe-ai')) return;
    const bucketName = flag('bucket') ? value('bucket') : process.env.FIREBASE_STORAGE_BUCKET;
    if (![`${config.firebaseProjectId}.firebasestorage.app`, `${config.firebaseProjectId}.appspot.com`].includes(bucketName)) {
      throw Error('project_bucket_required');
    }
    const { createSnapshotController } = require('../src/safety-snapshot-live');
    const admin = require('firebase-admin');
    // No session, worker, watcher, retry or camera dispatch is started here.
    const snapshots = createSnapshotController({ db, bucket: admin.storage().bucket(bucketName), findSessions: () => [] });
    const analyze = createPhotoAnalyzer({ apiKey: config.anthropicApiKey,
      model: process.env.INCIDENT_PHOTO_AI_MODEL || config.anthropicModel });
    console.log(JSON.stringify(await probeOriginal({ db, snapshots, photoId: value('photo'), analyze }), null, 2));
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch(error => {
  const allowed = ['invalid_photo_id', 'probe_confirmation_required', 'incident_photo_not_found',
    'invalid_incident', 'firestore_unavailable', 'project_bucket_required'];
  console.error(JSON.stringify({ outcome: 'inspection_failed', reason: allowed.includes(error?.message)
    ? error.message : 'check_configuration_or_access' }));
  process.exitCode = 1;
});
module.exports = { inspectIncidentPhoto, probeOriginal };
