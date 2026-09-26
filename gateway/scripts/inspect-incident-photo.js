'use strict';

const { isDeepStrictEqual } = require('node:util');
const { consentAllows, validIncidentId } = require('../src/incident-photo-policy');
const { asDate } = require('../src/safety-snapshot-policy');
const { createPhotoAnalyzer, analysisFailure, analysisRecord, analysisProvenance } = require('../src/incident-photo-analysis');
const { createOrientedPhotoAnalyzer } = require('../src/incident-photo-orientation');
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
      const provenance = analysisProvenance(row.analysis);
      // Explicit field selection: never include scene descriptions, identifiers
      // of household members, object paths, hashes or the original image.
      return { requestId: doc.id, sequence: row.sequence, state: row.state, reason: row.reason || null,
        aiStatus: row.analysis?.status || null, aiReason: row.analysis?.reason || null,
        aiModel: provenance.model || null, aiResponseModel: provenance.responseModel || null,
        aiPromptVersion: provenance.promptVersion || null,
        aiInputRotationClockwiseDegrees: [0, 90, 180, 270].includes(row.analysis?.inputRotationClockwiseDegrees)
          ? row.analysis.inputRotationClockwiseDegrees : null,
        aiOrientationMethod: row.analysis?.orientationSelection?.method === 'four_views_then_description'
          ? 'four_views_then_description' : null,
        aiOrientationVerification: ['confirmed', 'uncertain', 'conflicting', 'not_selected'].includes(row.analysis?.orientationSelection?.verification)
          ? row.analysis.orientationSelection.verification : null,
        failureStage: row.receiveDiagnostics?.failureStage || null,
        rejectionReason: row.receiveDiagnostics?.rejectionReason || null };
    }) };
}

async function probeOriginal({ db, snapshots, photoId, analyze, showAnalysis = false, rotateClockwise = null,
  saveAnalysis = false, now = () => new Date() }) {
  if (!photoIdValid(photoId)) return { outcome: 'probe_blocked', reason: 'invalid_photo_id' };
  if (rotateClockwise !== null && ![0, 90, 180, 270].includes(rotateClockwise)) return { outcome: 'probe_blocked', reason: 'invalid_rotation' };
  if (!analyze) return { outcome: 'probe_blocked', reason: 'analysis_not_configured' };
  const photo = (await db.collection('safetySnapshotAuthorizations').doc(photoId).get()).data();
  if (!photo || !validIncidentId(photo.incidentId)) return { outcome: 'probe_blocked', reason: 'incident_photo_not_found' };
  const recoverable = row => row?.analysis?.status === 'unavailable' &&
    ['analysis_orientation_uncertain', 'analysis_orientation_inconsistent'].includes(row.analysis.reason);
  if (saveAnalysis && (!recoverable(photo) || rotateClockwise !== null)) {
    return { outcome: 'probe_blocked', reason: 'analysis_not_recoverable' };
  }
  const unchanged = row => row?.imei === photo.imei && row.serviceOwnerUid === photo.serviceOwnerUid &&
    row.incidentId === photo.incidentId && row.mediaPath === photo.mediaPath && row.sha256 === photo.sha256 &&
    recoverable(row) && isDeepStrictEqual(row.analysis, photo.analysis);
  async function reauthorize() {
    const current = await snapshots.authorized(photo.serviceOwnerUid, photoId, { viewing: true });
    const settings = (await db.collection('incidentPhotoSettings').doc(photo.imei).get()).data();
    const incident = (await db.collection('incidentPhotos').doc(photo.incidentId).get()).data();
    if (current.imei !== photo.imei || current.serviceOwnerUid !== photo.serviceOwnerUid ||
        current.incidentId !== photo.incidentId || incident?.ownerUid !== photo.serviceOwnerUid ||
        incident?.imei !== photo.imei || !incident?.requestIds?.includes(photoId) ||
        !(asDate(incident?.expiresAt) > now()) ||
        !consentAllows(settings, photo.serviceOwnerUid, { ai: true }) ||
        (saveAnalysis && !unchanged(current))) throw Error('probe_access_unavailable');
  }
  let bytes;
  try {
    await reauthorize();
    bytes = await snapshots.image(photo.serviceOwnerUid, photoId);
    await reauthorize();
  } catch { return { outcome: 'probe_blocked', reason: 'original_or_consent_unavailable' }; }
  let result;
  try { result = analysisRecord(await analyze(bytes, { probeRotationClockwiseDegrees: rotateClockwise, reauthorize })); }
  catch (error) { return { outcome: 'probe_failed', ...analysisFailure(error) }; }
  try { await reauthorize(); }
  catch { return { outcome: 'probe_blocked', reason: 'access_changed_during_probe' }; }
  if (saveAnalysis) {
    if (!result.orientationSelection) return { outcome: 'probe_blocked', reason: 'orientation_probe_required' };
    let saved;
    try {
      saved = await db.runTransaction(async tx => {
        const ref = db.collection('safetySnapshotAuthorizations').doc(photoId);
        const current = (await tx.get(ref)).data();
        const settings = (await tx.get(db.collection('incidentPhotoSettings').doc(photo.imei))).data();
        const incident = (await tx.get(db.collection('incidentPhotos').doc(photo.incidentId))).data();
        const decision = await snapshots.access(photo.serviceOwnerUid, photo.imei, doc => tx.get(doc));
        if (!unchanged(current) || current.state !== 'available' || !(asDate(current.mediaExpiresAt) > now()) ||
            decision?.ownerUid !== photo.serviceOwnerUid || incident?.ownerUid !== photo.serviceOwnerUid ||
            incident?.imei !== photo.imei || !incident?.requestIds?.includes(photoId) ||
            !(asDate(incident?.expiresAt) > now()) || !consentAllows(settings, photo.serviceOwnerUid, { ai: true })) return false;
        // Only this old failed analysis is replaced. Never reopen capture or
        // follow-up delivery, extend retention, or overwrite a concurrent result.
        tx.update(ref, { analysis: { ...result, generatedAt: now() } });
        return true;
      });
    } catch { return { outcome: 'probe_blocked', reason: 'analysis_save_not_confirmed' }; }
    if (!saved) return { outcome: 'probe_blocked', reason: 'access_or_analysis_changed_before_save' };
  }
  return { outcome: saveAnalysis ? 'analysis_saved' : 'probe_succeeded', status: result.status, basis: result.basis,
    ...(result.inputRotationClockwiseDegrees === undefined ? {} : {
      inputRotationClockwiseDegrees: result.inputRotationClockwiseDegrees,
      inputEncoding: result.inputEncoding, orientationReference: result.orientationReference }),
    ...analysisProvenance(result),
    ...(result.orientationSelection ? { orientationSelection: result.orientationSelection,
      orientation: result.orientation || { clockwiseDegrees: null, confidence: 'low' } } : {}),
    visibleDetailCount: result.visibleDetails.length, uncertaintyCount: result.uncertainDetails.length,
    limitationCount: result.limitations.length, savedAnalysisChanged: saveAnalysis,
    ...(showAnalysis ? { analysis: result } : {}) };
}

function parseInspectionArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(options, key)) throw Error('invalid_arguments');
    if (['--probe-ai', '--confirm', '--show-analysis', '--probe-orientation', '--save-analysis'].includes(key)) options[key] = true;
    else if (['--photo', '--bucket', '--rotate-clockwise'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i];
    else throw Error('invalid_arguments');
  }
  if (!photoIdValid(options['--photo'])) throw Error('invalid_photo_id');
  if (options['--show-analysis'] && !options['--probe-ai']) throw Error('probe_required');
  if (options['--probe-orientation'] && !options['--probe-ai']) throw Error('probe_required');
  if (options['--save-analysis'] && !options['--probe-orientation']) throw Error('orientation_probe_required');
  if (options['--probe-orientation'] && options['--rotate-clockwise'] !== undefined) throw Error('invalid_arguments');
  if (options['--rotate-clockwise'] !== undefined) {
    if (!/^(0|90|180|270)$/.test(options['--rotate-clockwise'])) throw Error('invalid_rotation');
    if (!options['--probe-ai']) throw Error('probe_required');
  }
  if (options['--probe-ai'] && !options['--confirm']) throw Error('probe_confirmation_required');
  return { photoId: options['--photo'], bucket: options['--bucket'], probe: options['--probe-ai'] === true,
    showAnalysis: options['--show-analysis'] === true,
    ...(options['--probe-orientation'] ? { orientationProbe: true } : {}),
    ...(options['--save-analysis'] ? { saveAnalysis: true } : {}),
    ...(options['--rotate-clockwise'] === undefined ? {} : { rotateClockwise: Number(options['--rotate-clockwise']) }) };
}

async function main() {
  const options = parseInspectionArgs(process.argv.slice(2));
  const config = require('../src/config');
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw Error('firestore_unavailable');
  try {
    console.log(JSON.stringify(await inspectIncidentPhoto({ db, photoId: options.photoId }), null, 2));
    if (!options.probe) return;
    const bucketName = options.bucket || process.env.FIREBASE_STORAGE_BUCKET;
    if (![`${config.firebaseProjectId}.firebasestorage.app`, `${config.firebaseProjectId}.appspot.com`].includes(bucketName)) {
      throw Error('project_bucket_required');
    }
    const { createSnapshotController } = require('../src/safety-snapshot-live');
    const admin = require('firebase-admin');
    // No session, worker, watcher, retry or camera dispatch is started here.
    const snapshots = createSnapshotController({ db, bucket: admin.storage().bucket(bucketName), findSessions: () => [] });
    const factory = options.orientationProbe ? createOrientedPhotoAnalyzer : createPhotoAnalyzer;
    const analyze = factory({ apiKey: config.anthropicApiKey,
      model: process.env.INCIDENT_PHOTO_AI_MODEL || config.anthropicModel });
    console.log(JSON.stringify(await probeOriginal({ db, snapshots, photoId: options.photoId,
      analyze, showAnalysis: options.showAnalysis, rotateClockwise: options.rotateClockwise,
      saveAnalysis: options.saveAnalysis }), null, 2));
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch(error => {
  const allowed = ['invalid_arguments', 'invalid_photo_id', 'invalid_rotation', 'probe_required', 'orientation_probe_required', 'probe_confirmation_required', 'incident_photo_not_found',
    'invalid_incident', 'firestore_unavailable', 'project_bucket_required'];
  console.error(JSON.stringify({ outcome: 'inspection_failed', reason: allowed.includes(error?.message)
    ? error.message : 'check_configuration_or_access' }));
  process.exitCode = 1;
});
module.exports = { inspectIncidentPhoto, probeOriginal, parseInspectionArgs };
