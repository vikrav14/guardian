'use strict';

const { asDate } = require('./safety-snapshot-policy');
const { MAX_PHOTOS, SEQUENCE_MS, consentAllows, validIncidentId } = require('./incident-photo-policy');
const { analysisRecord, analysisFailure } = require('./incident-photo-analysis');
const { createPhotoProgress } = require('./incident-photo-progress');
const RETENTION_MS = 24 * 60 * 60_000;
const ACTIVE_PHOTO = ['dispatching', 'waiting_for_image', 'receiving'];
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { code, status }); };

function createIncidentPhotos({ db, snapshots, enabled = false, trialOnly = true, analyze = null, now = () => new Date(),
  onComplete = async () => {}, log = () => {} }) {
  const incidentRef = id => db.collection('incidentPhotos').doc(id);
  const photoRef = id => db.collection('safetySnapshotAuthorizations').doc(id);
  const settingsRef = imei => db.collection('incidentPhotoSettings').doc(imei);
  const lockRef = imei => db.collection('safetySnapshotDeviceLocks').doc(imei);
  const report = () => log('[incident-photos] operation deferred; private content omitted');
  const captureProgress = createPhotoProgress({ name: 'capture', now, log });
  const followupProgress = createPhotoProgress({ name: 'analysis_followup', now, log });
  let lastCaptureOutcome = null;

  async function enqueue(id) {
    if (!validIncidentId(id)) return;
    const alertRef = db.collection('alerts').doc(id);
    const alert = (await alertRef.get()).data();
    // Client-created SOS and old alerts cannot manufacture automatic capture.
    if (!alert?.incidentPhotoPending || alert.incidentPhotoEligible !== true ||
        !['sos', 'fall'].includes(alert.type) || !/^\d{15}$/.test(alert.imei)) return;
    const settings = (await settingsRef(alert.imei).get()).data();
    let allowed = enabled && snapshots && (!trialOnly || alert.incidentPhotoTrial === true) && consentAllows(settings, settings?.ownerUid);
    if (allowed) {
      try {
        const decision = await snapshots.access(settings.ownerUid, alert.imei);
        allowed = decision.ownerUid === settings.ownerUid;
      } catch { allowed = false; }
    }
    const eventAt = asDate(alert.eventAt);
    allowed = allowed && eventAt && eventAt <= now() && now() - eventAt <= 90_000;
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(alertRef)).data();
      const existing = await tx.get(incidentRef(id));
      const lock = (await tx.get(lockRef(alert.imei))).data() || {};
      const consent = (await tx.get(settingsRef(alert.imei))).data();
      if (!fresh?.incidentPhotoPending || existing.exists) return;
      // A delayed transaction/retry cannot admit an old alarm for new capture.
      if (!allowed || !eventAt || eventAt > now() || now() - eventAt > 90_000 ||
          !consentAllows(consent, settings?.ownerUid)) {
        tx.update(alertRef, { incidentPhotoPending: false, incidentPhotoStatus: 'unavailable' });
        return;
      }
      if (asDate(lock.incidentUntil) > now() && lock.incidentId) {
        tx.update(alertRef, { incidentPhotoPending: false, photoIncidentId: lock.incidentId });
        return;
      }
      const busy = asDate(lock.activeUntil) > now();
      const at = now();
      const incident = { id, imei: alert.imei, ownerUid: consent.ownerUid, type: alert.type,
        eventAt, trial: alert.incidentPhotoTrial === true, createdAt: at, updatedAt: at, deadlineAt: new Date(at.getTime() + SEQUENCE_MS),
        expiresAt: new Date(at.getTime() + RETENTION_MS), requestIds: [], target: MAX_PHOTOS,
        state: busy ? 'stopped' : 'collecting', reason: busy ? 'camera_busy' : null,
        nextAt: at, followupState: 'pending' };
      tx.create(incidentRef(id), incident);
      tx.set(lockRef(alert.imei), { ...lock, incidentId: id,
        incidentUntil: new Date(at.getTime() + SEQUENCE_MS) });
      tx.update(alertRef, { incidentPhotoPending: false, photoIncidentId: id });
    });
  }

  async function stop(id, reason) {
    await db.runTransaction(async tx => {
      const doc = await tx.get(incidentRef(id));
      if (doc.data()?.state === 'collecting') tx.update(doc.ref, { state: 'stopped', reason, updatedAt: now() });
    });
  }

  async function tick(id) {
    const incident = (await incidentRef(id).get()).data();
    if (incident?.state !== 'collecting') return;
    const settings = (await settingsRef(incident.imei).get()).data();
    if (!enabled || !consentAllows(settings, incident.ownerUid)) return stop(id, 'capture_disabled');
    if (!(asDate(incident.deadlineAt) > now())) return stop(id, 'sequence_deadline');
    if (incident.requestIds.length) {
      const last = (await photoRef(incident.requestIds.at(-1)).get()).data();
      if (ACTIVE_PHOTO.includes(last?.state)) return;
      // Never send the next command after an ambiguous timeout/failed upload.
      if (last?.state !== 'available') return stop(id, last?.reason || 'photo_unavailable');
    }
    if (incident.requestIds.length >= MAX_PHOTOS) {
      await incidentRef(id).update({ state: 'complete', updatedAt: now() });
      return;
    }
    try {
      await snapshots.requestIncident(incident.ownerUid, incident.imei, id);
      lastCaptureOutcome = 'request_processed';
    }
    catch (error) {
      if (error.code === 'incident_waiting_for_connection') {
        lastCaptureOutcome = 'waiting_for_connection'; return;
      }
      if (['incident_waiting_for_photo', 'camera_busy', 'incident_not_active'].includes(error.code)) return;
      await stop(id, error.code === 'watch_offline_or_reconnecting' ? 'watch_disconnected' : 'capture_unavailable');
    }
  }

  async function analyzePhoto(id) {
    const claim = await db.runTransaction(async tx => {
      const doc = await tx.get(photoRef(id));
      const photo = doc.data();
      if (!photo?.incidentId || photo.state !== 'available' || !(asDate(photo.mediaExpiresAt) > now())) return null;
      const settings = (await tx.get(settingsRef(photo.imei))).data();
      if (photo.analysis?.status === 'analysing' && asDate(photo.analysis.deadlineAt) <= now()) {
        tx.update(doc.ref, { analysis: { status: 'unavailable', reason: 'analysis_interrupted' } });
        return null;
      }
      if (photo.analysis?.status !== 'pending') return null;
      if (!analyze || !consentAllows(settings, photo.serviceOwnerUid, { ai: true })) {
        tx.update(doc.ref, { analysis: { status: 'unavailable', reason: 'analysis_not_enabled' } });
        return null;
      }
      tx.update(doc.ref, { analysis: { status: 'analysing', deadlineAt: new Date(now().getTime() + 60_000) } });
      return photo;
    });
    if (!claim) return;
    let analysis;
    let stage = 'original';
    const reauthorize = async () => {
      const photo = await snapshots.authorized(claim.serviceOwnerUid, id, { viewing: true });
      const settings = (await settingsRef(claim.imei).get()).data();
      const incident = (await incidentRef(claim.incidentId).get()).data();
      if (photo.serviceOwnerUid !== claim.serviceOwnerUid || photo.imei !== claim.imei ||
          photo.incidentId !== claim.incidentId || photo.analysis?.status !== 'analysing' ||
          !(asDate(photo.analysis.deadlineAt) > now()) ||
          incident?.ownerUid !== claim.serviceOwnerUid || incident?.imei !== claim.imei ||
          !incident?.requestIds?.includes(id) || !(asDate(incident?.expiresAt) > now()) ||
          !consentAllows(settings, claim.serviceOwnerUid, { ai: true })) fail('analysis_access_changed');
    };
    try {
      const image = await snapshots.image(claim.serviceOwnerUid, id);
      stage = 'provider';
      await reauthorize();
      const result = await analyze(image, { reauthorize });
      await reauthorize();
      analysis = { ...analysisRecord(result), generatedAt: now() };
    } catch (error) {
      analysis = stage === 'original'
        ? { status: 'unavailable', reason: 'analysis_original_unavailable' }
        : analysisFailure(error);
    }
    await db.runTransaction(async tx => {
      const doc = await tx.get(photoRef(id));
      const photo = doc.data();
      const settings = (await tx.get(settingsRef(claim.imei))).data();
      const incident = (await tx.get(incidentRef(claim.incidentId))).data();
      let decision = null;
      try { decision = await snapshots.access(claim.serviceOwnerUid, claim.imei, ref => tx.get(ref)); } catch { /* revoked */ }
      // Deletion, expiry, ownership and consent always beat a late AI response.
      if (photo?.state !== 'available' || photo.analysis?.status !== 'analysing' ||
          !(asDate(photo.mediaExpiresAt) > now()) || decision?.ownerUid !== claim.serviceOwnerUid ||
          incident?.ownerUid !== claim.serviceOwnerUid || !(asDate(incident?.expiresAt) > now()) ||
          !incident?.requestIds?.includes(id) ||
          !consentAllows(settings, claim.serviceOwnerUid, { ai: true })) return;
      tx.update(doc.ref, { analysis });
    });
  }

  async function gallery(uid, alertId) {
    if (!validIncidentId(alertId)) fail('incident_not_found', 404);
    const alert = (await db.collection('alerts').doc(alertId).get()).data();
    if (!alert || !['sos', 'fall'].includes(alert.type)) fail('incident_not_found', 404);
    const decision = await snapshots.access(uid, alert.imei);
    const id = alert.photoIncidentId || alertId;
    const incident = (await incidentRef(id).get()).data();
    if (!incident) return { id: alertId, type: alert.type, state: alert.incidentPhotoPending ? 'preparing' : 'unavailable',
      target: MAX_PHOTOS, photos: [], summary: [], eventAt: asDate(alert.eventAt || alert.createdAt) };
    if (incident.ownerUid !== decision.ownerUid || incident.imei !== alert.imei) fail('incident_not_found', 404);
    if (!(asDate(incident.expiresAt) > now())) return { id: alertId, type: incident.type, state: 'expired', target: MAX_PHOTOS, photos: [], summary: [] };
    const settings = (await settingsRef(incident.imei).get()).data();
    const aiAllowed = consentAllows(settings, incident.ownerUid, { ai: true });
    const photos = [];
    for (const photoId of incident.requestIds) {
      const photo = await snapshots.authorized(uid, photoId);
      const active = photo.state === 'available' && asDate(photo.mediaExpiresAt) > now();
      const state = photo.state === 'available' && !active ? 'expired' : photo.state;
      photos.push({ id: photoId, sequence: photo.sequence, state, receivedAt: asDate(photo.receivedAt),
        mediaExpiresAt: asDate(photo.mediaExpiresAt), reason: photo.reason || null,
        analysis: active ? (aiAllowed ? photo.analysis || { status: 'pending' } : { status: 'unavailable' }) : null });
    }
    // Cross-photo summary only cites per-photo statements; no inferred movement,
    // diagnosis, location confirmation or emergency decision is generated.
    const summary = photos.filter(p => p.analysis?.status === 'ready').map(p => ({
      photo: p.sequence, text: p.analysis.summary || p.analysis.visibleDetails[0],
    }));
    return { id: alertId, type: incident.type, trial: incident.trial, state: incident.state, reason: incident.reason,
      eventAt: asDate(incident.eventAt), expiresAt: asDate(incident.expiresAt), target: MAX_PHOTOS, photos, summary };
  }

  let analysisJob = null;
  async function sweep() {
    followupProgress.check();
    if (!snapshots || !captureProgress.begin()) return;
    try {
      const queue = await captureProgress.step('pending_alerts_read', () =>
        db.collection('alerts').where('incidentPhotoPending', '==', true).limit(25).get());
      for (const doc of queue.docs) await captureProgress.step('incident_enqueue', () => enqueue(doc.id));
      const active = await captureProgress.step('active_incidents_read', () =>
        db.collection('incidentPhotos').where('state', '==', 'collecting').limit(25).get());
      for (const doc of active.docs) await captureProgress.step('capture_tick', () => tick(doc.id));
      if (!analysisJob) {
        followupProgress.begin();
        analysisJob = (async () => {
          // Even the follow-up query is independent of the capture sweep.
          const work = await followupProgress.step('followup_queue_read', () =>
            db.collection('incidentPhotos').where('followupState', '==', 'pending').limit(25).get());
          for (const doc of work.docs) {
            const incident = doc.data();
            if (!(asDate(incident.expiresAt) > now())) {
              await followupProgress.step('followup_expire', () => doc.ref.update({ followupState: 'expired' })); continue;
            }
            for (const id of incident.requestIds) await followupProgress.step('photo_analysis', () => analyzePhoto(id));
            const fresh = (await followupProgress.step('followup_incident_read', () => doc.ref.get())).data();
            if (fresh.state === 'collecting') continue;
            const photos = await followupProgress.step('followup_photos_read', () =>
              Promise.all(fresh.requestIds.map(id => photoRef(id).get())));
            if (photos.some(p => p.data()?.state === 'available' &&
                ['pending', 'analysing'].includes(p.data()?.analysis?.status))) continue;
            const alert = (await followupProgress.step('followup_alert_read', () =>
              db.collection('alerts').doc(fresh.id).get())).data();
            // An optional photo update must not overtake the initial alert.
            if (!fresh.trial && ['pending', 'sending'].includes(alert?.notifyStatus)) continue;
            const claimed = await followupProgress.step('followup_claim', () => db.runTransaction(async tx => {
              const row = await tx.get(doc.ref);
              if (row.data()?.followupState !== 'pending') return false;
              tx.update(doc.ref, { followupState: 'claimed', followupClaimedAt: now() }); return true;
            }));
            if (claimed) {
              // At-most-once transport attempt, including restart/ambiguous send.
              try {
                const result = fresh.trial || !['accepted', 'partial', 'sent', 'delivered'].includes(alert?.notifyStatus)
                  ? { ok: false } : await followupProgress.step('followup_send', () => onComplete(fresh));
                await followupProgress.step('followup_result', () =>
                  doc.ref.update({ followupState: result?.ok ? 'accepted' : 'unavailable' }));
              } catch { await followupProgress.step('followup_result', () => doc.ref.update({ followupState: 'unavailable' })); }
            }
          }
        })().catch(report).finally(() => { followupProgress.finish(); analysisJob = null; });
      }
    } finally { captureProgress.finish(); }
  }
  function getStatus() {
    return { version: 1, workerStarted: true, enabled: Boolean(enabled), trialOnly: Boolean(trialOnly),
      aiEnabled: Boolean(analyze), lastCaptureOutcome,
      capture: captureProgress.getStatus(), analysisFollowup: followupProgress.getStatus() };
  }
  return { enqueue, tick, sweep, gallery, analyzePhoto, getStatus, drain: () => analysisJob };
}

module.exports = { createIncidentPhotos };
