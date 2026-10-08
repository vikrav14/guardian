'use strict';

const crypto = require('node:crypto');
const jpegCodec = require('jpeg-js');
const { decodeV52PhotoFrame, PhotoDecodeError } = require('./protocol/v52-photo');
const { createRejectedPhotoCapture } = require('./safety-snapshot-rejected-frame');
const { assessSnapshotAccess } = require('./safety-snapshot-requests');
const { normalizePurpose, asDate } = require('./safety-snapshot-policy');
const { readSafetySnapshotRuntime } = require('./safety-snapshot-runtime');
const { storageFailureDetails, storageRuntimeDetails } = require('./safety-snapshot-storage-diagnostics');
const { protocolIdFromFullImei } = require('./imei');
const { consentAllows, readIncidentAuthorization } = require('./incident-photo-policy');
const { beginPhotoCommandTimeline, noteDeviceWrite } = require('./photo-command-timeline');
const { commandCoordinator } = require('./command-coordinator');
const { createPhotoIngressObserver } = require('./photo-ingress-observer');
const { createPhotoTransportDiagnostics } = require('./photo-transport-diagnostics');
const { MANUAL_CAPTURE_WINDOW_MS, INCIDENT_CAPTURE_WINDOW_MS } = require('./photo-capture-window');
const { readIncidentPhotoRollout } = require('./incident-photo-rollout');
const { initialSosConnectionReady } = require('./incident-photo-readiness');

const RETENTION_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
// A writable socket alone is not evidence the watch has resumed after SOS.
// This is a gateway freshness policy, not a firmware readiness guarantee.
const INCIDENT_PACKET_FRESH_MS = 30_000;
const ACTIVE_STATES = ['dispatching', 'waiting_for_image', 'receiving'];
const privatePath = (owner, imei, id) => `privateSafetySnapshots/${owner}/${imei}/${id}.jpg`;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function isPhotoFrame(frame) {
  return Buffer.isBuffer(frame) && frame.length >= 24 && frame.subarray(20, 24).equals(Buffer.from('img,'));
}
// Diagnostic classification only: never accepts a new media format. Inspect a
// bounded header and retain booleans/counts, never image bytes or header text.
function hasPhotoHeader(bytes) {
  return /^\[[a-z0-9]{2}\*\d{10,15}\*[a-f0-9]{4}\*img(?:,|$)/i
    .test(bytes.subarray(0, 48).toString('latin1'));
}
function receiveDiagnostics() {
  return { version: 1, chunks: 0, bytes: 0, frames: 0, rcaptureReplies: 0,
    photoFrames: 0, photoHeaderSeen: false, firstPhotoHeaderAfterMs: null,
    firstDataAfterMs: null, lastDataAfterMs: null, bufferedBytes: 0,
    maxBufferedBytes: 0, incompletePhotoBuffered: false, identityChanged: false,
    acceptedPhotoFrames: 0, differentSessionPhotoFrames: 0,
    identityMismatchPhotoFrames: 0, expiredPhotoFrames: 0,
    duplicatePhotoFrames: 0, failureStage: null, rejectionReason: null, storageError: null, decodeError: null,
    decodeDetails: null, rejectedFrameCapture: 'not_enabled' };
}
function decodePhoto(frame, protocolId) {
  const decoded = decodeV52PhotoFrame(frame, protocolId);
  let pixels;
  try {
    pixels = jpegCodec.decode(decoded.jpeg, {
      useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
      maxResolutionInMP: 1.1, maxMemoryUsageInMB: 32,
    });
  } catch {
    // Never emit a third-party exception: it can contain payload-derived text.
    throw new PhotoDecodeError('jpeg_pixel_decode_failed');
  }
  if (pixels.width !== decoded.metadata.width || pixels.height !== decoded.metadata.height ||
      pixels.data.length !== pixels.width * pixels.height * 3) throw new PhotoDecodeError('jpeg_pixel_dimensions_mismatch');
  return decoded;
}

function createSnapshotController({ db, bucket, findSessions, runtime, now = () => new Date(), log = console.warn,
  captureRejectedFrame = null, coordinator = commandCoordinator, initialSosSettleEnabled = false }) {
  const pending = new Map();
  const ingressObserver = createPhotoIngressObserver({ now: () => +now(), log });
  const config = runtime || readSafetySnapshotRuntime();
  const ref = id => db.collection('safetySnapshotAuthorizations').doc(id);
  const lockRef = imei => db.collection('safetySnapshotDeviceLocks').doc(imei);
  const enabledFor = imei => config.deviceDispatchAllowed && config.acceptedImeis.includes(imei);
  const report = () => log('[safety-snapshot] operation failed; private payload omitted');
  const diagnostics = slot => ({ ...slot.diagnostics,
    ...(slot.transport ? { transport: slot.transport.snapshot() } : {}),
    ...(slot.commandTimeline ? { commandTimeline: slot.commandTimeline.snapshot() } : {}) });
  const reportReceive = (slot, outcome) => {
    // Fixed schema; no exception text, identities, purpose, token or media.
    if (slot) log(`[safety-snapshot] ${JSON.stringify({ requestId: slot.id,
      outcome, receiveDiagnostics: diagnostics(slot) })}`);
  };
  const event = (id, type, uid = null) => db.collection('safetySnapshotAudit').doc(id)
    .collection('events').add({ type, uid, at: now() });

  async function access(uid, imei, reader = doc => doc.get()) {
    if (!/^[0-9]{15}$/.test(imei) || !uid) fail('invalid_identity', 400);
    const userSnap = await reader(db.collection('users').doc(uid));
    const user = userSnap.exists ? userSnap.data() : {};
    const ownerUid = String(user.serviceOwnerUid || uid);
    const owner = ownerUid === uid ? userSnap : await reader(db.collection('users').doc(ownerUid));
    const sub = await reader(db.collection('serviceSubscriptions').doc(ownerUid));
    const shared = await require('./family-policy').watchAccess(db, uid, imei, 'photos', { now: +now(), read: reader });
    if (shared.managed) return { ok: true, ownerUid: shared.service.ownerUid, plan: shared.entitlements.plan };
    const decision = assessSnapshotAccess({ requesterUid: uid, user, owner: owner.data(), subscription: sub.data(), imei, now: now() });
    if (!decision.ok) fail(decision.reason, 403);
    return decision;
  }

  function connection(imei, incident = null) {
    const expectedProtocolId = protocolIdFromFullImei(imei);
    const after = incident && !incident.trial ? asDate(incident.eventAt)?.getTime() : null;
    const at = now().getTime();
    const matches = findSessions(imei).filter(({ socket, session }) =>
      !socket.destroyed && socket.writable !== false && session.imei === imei &&
      expectedProtocolId != null && session.protocolId === expectedProtocolId &&
      (!initialSosSettleEnabled || initialSosConnectionReady(incident, session, at)) &&
      (!incident || incident.trial || (Number.isFinite(after) &&
        Number.isFinite(session.lastPacketAt) && session.lastPacketAt > after &&
        session.lastPacketAt <= at && at - session.lastPacketAt <= INCIDENT_PACKET_FRESH_MS)));
    // Never fan out a camera request across duplicate/replacement sessions.
    // A silent pre-alarm socket cannot block a single fresh replacement.
    return matches.length === 1 ? matches[0] : null;
  }

  async function finishFailure(id, reason, slot = null) {
    if (slot) coordinator.finishCapture(slot.imei, id);
    slot?.commandTimeline?.stop(reason === 'image_timeout' ? 'expired' : 'failed', now());
    const changed = await db.runTransaction(async tx => {
      const doc = await tx.get(ref(id));
      if (!doc.exists || !ACTIVE_STATES.includes(doc.data().state)) return false;
      tx.update(ref(id), { state: 'failed', reason, updatedAt: now(),
        ...(slot ? { receiveDiagnostics: diagnostics(slot) } : {}) });
      return true;
    });
    if (changed) reportReceive(slot, reason);
  }

  async function requestInternal(uid, input, incidentId = null, guardian = false) {
    if (!incidentId && config.manualTestEnabled === false) fail('manual_photos_disabled', 403);
    const imei = String(input?.imei || '');
    let purpose;
    try { purpose = normalizePurpose(input?.purpose); } catch { fail('invalid_purpose', 400); }
    if (purpose.length < 8 || input?.consentConfirmed !== true || input?.safetyPurposeConfirmed !== true) fail('consent_and_purpose_required', 400);
    if (!enabledFor(imei)) fail('camera_unavailable', 503);
    if (!incidentId && !connection(imei)) fail('watch_offline_or_reconnecting');
    // Fixed server-generated ID and transaction lock also serialize different guardians.
    if (guardian && !/^[a-f0-9-]{36}$/.test(input?.requestKey || '')) fail('invalid_request_key', 400);
    const digest = guardian ? crypto.createHash('sha256').update(`${uid}:${incidentId}:${input.requestKey}`).digest('hex') : null;
    const id = digest ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}` : crypto.randomUUID();
    const claimed = await db.runTransaction(async tx => {
      const decision = await access(uid, imei, doc => tx.get(doc));
      const existing = guardian ? (await tx.get(ref(id))).data() : null;
      if (existing) return { replay: true };
      const lock = await tx.get(lockRef(imei));
      const last = asDate(lock.data()?.lastRequestedAt);
      const incidentClaim = incidentId
        ? await readIncidentAuthorization(db, tx, incidentId, decision.ownerUid, imei, now(), { guardian }) : null;
      // Recheck after all awaited reads (including transaction retries). Waiting
      // for a connection creates no authorization, camera lease or attempt.
      const at = now();
      if (incidentClaim && !(incidentClaim.captureDeadlineAt > at)) fail('incident_not_active');
      const selected = connection(imei, incidentClaim?.incident);
      if (!selected) fail(incidentId ? 'incident_waiting_for_connection' : 'watch_offline_or_reconnecting');
      if (asDate(lock.data()?.activeUntil) > at ||
          (asDate(lock.data()?.incidentUntil) > at && lock.data()?.incidentId !== incidentId)) fail('camera_busy');
      if (incidentId && lock.data()?.requestId) {
        const previous = (await tx.get(ref(lock.data().requestId))).data();
        if (require('./incident-photo-policy').photoQuietUntil(previous, lock.data().activeUntil) > at) {
          fail('incident_photo_settling');
        }
      }
      if (!incidentId && last && at.getTime() < last.getTime() + COOLDOWN_MS) {
        const error = Object.assign(new Error('cooldown_active'), { code: 'cooldown_active', status: 429, retryAt: new Date(last.getTime() + COOLDOWN_MS) });
        throw error;
      }
      // The incident's fixed overall deadline also bounds its final capture.
      // Persist once: ACKs, recovery traffic and restart never renew this grant.
      const authorizationExpiresAt = new Date(Math.min(
        at.getTime() + (incidentClaim ? INCIDENT_CAPTURE_WINDOW_MS : MANUAL_CAPTURE_WINDOW_MS),
        incidentClaim ? +incidentClaim.captureDeadlineAt : Infinity,
      ));
      const auth = {
        requestId: id, imei, requestedBy: uid, serviceOwnerUid: decision.ownerUid,
        purpose, consentConfirmed: true, safetyPurposeConfirmed: true,
        ...(incidentId ? { incidentId, sequence: incidentClaim.incident.requestIds.length + 1,
          captureSource: guardian ? 'guardian' : 'automatic',
          analysis: { status: 'pending' } } : {}),
        state: 'dispatching', deviceCommand: 'rcapture', deviceCommandSent: false,
        createdAt: at, updatedAt: at, authorizationExpiresAt,
        mediaExpiresAt: new Date(at.getTime() + RETENTION_MS),
        mediaPath: privatePath(decision.ownerUid, imei, id), publicUrl: null,
        cleanupPending: false, correlation: 'same_session_request_window', requestCorrelationVerified: false,
      };
      tx.create(ref(id), auth);
      tx.set(lockRef(imei), { ...lock.data(), lastRequestedAt: at, requestId: id,
        activeUntil: authorizationExpiresAt });
      if (incidentClaim) tx.update(incidentClaim.ref, {
        requestIds: [...incidentClaim.incident.requestIds, id], updatedAt: at,
        ...(guardian ? { analysisPending: true } : {}),
      });
      tx.create(db.collection('safetySnapshotAudit').doc(id), {
        requestId: id, imei, requestedBy: uid, serviceOwnerUid: decision.ownerUid,
        consentConfirmed: true, safetyPurposeConfirmed: true, purpose, createdAt: at,
      });
      return { auth, selected, incident: incidentClaim?.incident, captureDeadlineAt: incidentClaim?.captureDeadlineAt };
    });
    if (claimed.replay) return id;
    // A slow claim must not extend the authorization/sequence deadline. A
    // changed connection after claim is not permission to migrate the request.
    if (!(claimed.auth.authorizationExpiresAt > now()) ||
        (claimed.incident && !(claimed.captureDeadlineAt > now()))) {
      await finishFailure(id, 'dispatch_expired'); return id;
    }
    const selected = connection(imei, claimed.incident);
    if (!selected || selected.socket !== claimed.selected.socket) {
      await finishFailure(id, 'watch_disconnected'); return id;
    }
    // Install reception before write; reply/upload may race the persistence update.
    const slot = { id, ...selected, imei, ownerUid: claimed.auth.serviceOwnerUid, uid,
      expiresAt: claimed.auth.authorizationExpiresAt, startedAt: now(), receiving: false,
      protocolId: selected.session.protocolId, diagnostics: receiveDiagnostics() };
    const admission = coordinator.beginCapture({ ...slot, expiresAt: slot.expiresAt });
    if (!admission.ok) { await finishFailure(id, admission.error, slot); return id; }
    pending.set(selected.socket, slot);
    ingressObserver.begin(slot);
    try {
      try { slot.commandTimeline = beginPhotoCommandTimeline(slot); }
      catch { /* Diagnostics cannot block authorized capture. */ }
      const captureFrame = Buffer.from(`[3G*${selected.session.protocolId}*0008*rcapture]`, 'ascii');
      try { slot.transport = createPhotoTransportDiagnostics(selected.socket, selected.session, now); }
      catch { /* Diagnostics cannot change capture authorization or dispatch. */ }
      noteDeviceWrite(selected.socket, selected.session, captureFrame, 'photo_capture', now());
      let writeResult;
      try { writeResult = selected.socket.write(captureFrame, error => {
        slot.transport?.callback(error);
        try { log(`[photo-transport] ${JSON.stringify({ requestId: id, event: 'write_callback',
          transport: slot.transport?.snapshot() || null })}`); } catch { /* Diagnostics only. */ }
        if (error) {
          if (pending.get(selected.socket) === slot) pending.delete(selected.socket);
          finishFailure(id, 'send_failed', slot).catch(report);
        }
      }); } catch (error) { slot.transport?.threw(error); throw error; }
      slot.transport?.returned(writeResult);
      await db.runTransaction(async tx => {
        const doc = await tx.get(ref(id));
        tx.update(ref(id), {
          deviceCommandSent: true, sentAt: now(), updatedAt: now(),
          ...(doc.data()?.state === 'dispatching' ? { state: 'waiting_for_image' } : {}),
        });
      });
      await event(id, 'command_handed_off', uid);
      reportReceive(slot, 'command_handed_off');
    } catch {
      if (pending.get(selected.socket) === slot) pending.delete(selected.socket);
      await finishFailure(id, 'send_or_persistence_failed', slot);
    }
    return id;
  }

  async function cleanup(id) {
    const doc = await ref(id).get();
    if (!doc.exists || !doc.data().cleanupPending) return;
    const auth = doc.data();
    // Only a deterministic server-owned path is ever deleted.
    const path = privatePath(auth.serviceOwnerUid, auth.imei, id);
    // A deletion may race an upload, including one from a crashed process.
    // Keep cleanup durable until the bounded write lease ends.
    if (asDate(auth.uploadLeaseUntil) > now()) return;
    await bucket.file(path).delete({ ignoreNotFound: true });
    await ref(id).update({ cleanupPending: false, mediaPath: null, mediaDeletedAt: now() });
  }

  async function receive(slot, frame) {
    let attemptedSave = false;
    let stage = 'decode';
    try {
      const image = decodePhoto(frame, slot.protocolId);
      stage = 'authorize';
      await db.runTransaction(async tx => {
        const doc = await tx.get(ref(slot.id));
        const auth = doc.data();
        const decision = await access(slot.uid, slot.imei, doc => tx.get(doc));
        if (auth?.incidentId) {
          const settings = (await tx.get(db.collection('incidentPhotoSettings').doc(slot.imei))).data();
          if (!consentAllows(settings, auth.serviceOwnerUid)) fail('incident_consent_revoked');
        }
        if (!auth || !['dispatching', 'waiting_for_image'].includes(auth.state) ||
            decision.ownerUid !== auth.serviceOwnerUid || asDate(auth.authorizationExpiresAt) <= now()) fail('request_no_longer_active');
        tx.update(ref(slot.id), { state: 'receiving', cleanupPending: true, uploadLeaseUntil: new Date(now().getTime() + 120_000), updatedAt: now() });
      });
      const path = privatePath(slot.ownerUid, slot.imei, slot.id);
      attemptedSave = true;
      stage = 'storage';
      await bucket.file(path).save(image.jpeg, {
        resumable: false, timeout: 30_000, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store',
          metadata: { requestId: slot.id, expiresAt: new Date(now().getTime() + RETENTION_MS).toISOString() } },
      });
      stage = 'publish';
      await db.runTransaction(async tx => {
        const doc = await tx.get(ref(slot.id));
        const auth = doc.data();
        const decision = await access(slot.uid, slot.imei, doc => tx.get(doc));
        const lock = await tx.get(lockRef(slot.imei));
        if (auth?.incidentId) {
          const settings = (await tx.get(db.collection('incidentPhotoSettings').doc(slot.imei))).data();
          const incident = (await tx.get(db.collection('incidentPhotos').doc(auth.incidentId))).data();
          const previous = await Promise.all((incident?.requestIds || []).filter(id => id !== slot.id)
            .map(id => tx.get(ref(id))));
          const digest = crypto.createHash('sha256').update(image.jpeg).digest('hex');
          if (!consentAllows(settings, auth.serviceOwnerUid)) fail('incident_consent_revoked');
          if (previous.some(doc => doc.data()?.sha256 === digest)) fail('duplicate_incident_image');
        }
        if (auth?.state !== 'receiving' || decision.ownerUid !== auth.serviceOwnerUid || asDate(auth.authorizationExpiresAt) <= now()) fail('request_no_longer_active');
        tx.update(ref(slot.id), { state: 'available', receivedAt: now(), updatedAt: now(),
          sizeBytes: image.jpeg.length, width: image.metadata.width, height: image.metadata.height,
          contentType: 'image/jpeg', sha256: crypto.createHash('sha256').update(image.jpeg).digest('hex'),
          deviceTimestampRaw: image.metadata.deviceTimestampRaw, cleanupPending: false, uploadLeaseUntil: null,
          validation: 'full_pixel_decode', timeBasis: 'gateway_receipt_not_verified_capture_time',
          receiveDiagnostics: diagnostics(slot) });
        if (lock.data()?.requestId === slot.id) tx.update(lockRef(slot.imei), { activeUntil: now() });
      });
      reportReceive(slot, 'image_available');
      await event(slot.id, 'image_available').catch(report);
    } catch (error) {
      slot.diagnostics.failureStage = stage;
      if (stage === 'storage') slot.diagnostics.storageError = storageFailureDetails(error);
      const rejection = ['duplicate_incident_image', 'incident_consent_revoked', 'request_no_longer_active']
        .includes(error?.code) ? error.code : null;
      slot.diagnostics.rejectionReason = rejection;
      if (stage === 'decode') {
        // Only our own fixed decoder codes and numeric/boolean structure facts.
        slot.diagnostics.decodeError = error instanceof PhotoDecodeError ? error.code : 'unexpected_decode_failure';
        const details = { frameBytes: frame.length };
        if (error instanceof PhotoDecodeError) {
          for (const key of ['jpegBytes', 'width', 'height', 'trailerBytes']) {
            if (Number.isSafeInteger(error.details[key]) && error.details[key] >= 0) details[key] = error.details[key];
          }
          if (typeof error.details.trailerAllZero === 'boolean') details.trailerAllZero = error.details.trailerAllZero;
        }
        const lengthField = frame.subarray(15, 19).toString('ascii');
        if (/^[a-f0-9]{4}$/i.test(lengthField)) details.declaredPayloadBytes = parseInt(lengthField, 16);
        slot.diagnostics.decodeDetails = details;
        if (captureRejectedFrame) {
          slot.diagnostics.rejectedFrameCapture = 'not_authorized';
          let allowed = false;
          try {
            const auth = await authorized(slot.uid, slot.id);
            allowed = ACTIVE_STATES.includes(auth.state) && asDate(auth.authorizationExpiresAt) > now();
          } catch { /* A failed access check must not save diagnostic media. */ }
          if (allowed) {
            try {
              slot.diagnostics.rejectedFrameCapture = await captureRejectedFrame({
                frame, requestId: slot.id, protocolId: slot.protocolId, at: now().toISOString(),
              });
            } catch { slot.diagnostics.rejectedFrameCapture = 'write_failed'; }
          }
        }
      }
      await finishFailure(slot.id, rejection || 'image_rejected_or_storage_failed', slot);
      if (attemptedSave) {
        await ref(slot.id).update({ cleanupPending: true, uploadLeaseUntil: null });
        await cleanup(slot.id);
      }
    } finally {
      if (pending.get(slot.socket) === slot) pending.delete(slot.socket);
    }
  }

  function observeTraffic(socket, session, { chunkBytes, frames, rest }) {
    ingressObserver.frames(socket, session, { frames, rest });
    const slot = pending.get(socket);
    if (!slot || now() >= slot.expiresAt) return;
    const d = slot.diagnostics, afterMs = Math.max(0, now() - slot.startedAt);
    d.chunks++; d.bytes += chunkBytes; d.frames += frames.length;
    d.firstDataAfterMs ??= afterMs; d.lastDataAfterMs = afterMs;
    d.bufferedBytes = rest.length;
    d.maxBufferedBytes = Math.max(d.maxBufferedBytes, rest.length);
    d.incompletePhotoBuffered = hasPhotoHeader(rest);
    d.identityChanged ||= slot.session !== session || slot.imei !== session.imei ||
      slot.protocolId !== session.protocolId;
    const reply = Buffer.from(`[3G*${slot.protocolId}*0008*rcapture]`, 'ascii');
    for (const frame of frames) {
      if (frame.equals(reply)) d.rcaptureReplies++;
      if (hasPhotoHeader(frame)) d.photoFrames++;
    }
    if (d.incompletePhotoBuffered || d.photoFrames > 0) {
      d.photoHeaderSeen = true;
      d.firstPhotoHeaderAfterMs ??= afterMs;
    }
  }

  function observe(frame, socket, session) {
    if (!isPhotoFrame(frame)) return false;
    const slot = pending.get(socket);
    const disposition = !slot ? 'no_pending_request' : slot.receiving ? 'duplicate_in_flight'
      : slot.session !== session ? 'different_session'
        : slot.imei !== session.imei || slot.protocolId !== session.protocolId ? 'identity_mismatch'
          : now() >= slot.expiresAt ? 'request_expired' : 'passed_ingress_guard';
    ingressObserver.disposition(socket, session, disposition, slot?.id);
    if (!slot) {
      // Record a replacement-session arrival as evidence only; never adopt it.
      for (const active of pending.values()) {
        if (now() < active.expiresAt && active.imei === session.imei &&
            active.protocolId === session.protocolId) active.diagnostics.differentSessionPhotoFrames++;
      }
    } else if (slot.receiving) slot.diagnostics.duplicatePhotoFrames++;
    else if (slot.session !== session) slot.diagnostics.differentSessionPhotoFrames++;
    else if (slot.imei !== session.imei || slot.protocolId !== session.protocolId) slot.diagnostics.identityMismatchPhotoFrames++;
    else if (now() >= slot.expiresAt) slot.diagnostics.expiredPhotoFrames++;
    else {
      slot.diagnostics.acceptedPhotoFrames++;
      slot.receiving = true;
      slot.commandTimeline?.stop('image_received', now());
      coordinator.finishCapture(slot.imei, slot.id);
      receive(slot, Buffer.from(frame)).catch(report);
    }
    // Dropped images never generate ACKs or raw logs. The separate bounded
    // observer can retain a metadata-only drop reason after pending removal.
    return true;
  }

  function disconnect(socket) {
    ingressObserver.close(socket);
    coordinator.disconnect(socket);
    const slot = pending.get(socket);
    slot?.commandTimeline?.stop('disconnected', now());
    pending.delete(socket);
    if (slot && !slot.receiving) finishFailure(slot.id, 'watch_disconnected', slot).catch(report);
  }

  async function authorized(uid, id, { viewing = false } = {}) {
    const doc = await ref(id).get();
    if (!doc.exists) fail('photo_not_found', 404);
    const auth = doc.data();
    const decision = await access(uid, auth.imei);
    if (decision.ownerUid !== auth.serviceOwnerUid) fail('photo_not_found', 404);
    if (viewing && (auth.state !== 'available' || asDate(auth.mediaExpiresAt) <= now())) fail('photo_unavailable', 410);
    return auth;
  }

  async function list(uid, imei) {
    const decision = await access(uid, imei);
    const snaps = await db.collection('safetySnapshotAuthorizations').where('imei', '==', imei)
      .where('serviceOwnerUid', '==', decision.ownerUid).orderBy('createdAt', 'desc').limit(10).get();
    const lock = await lockRef(imei).get();
    const last = asDate(lock.data()?.lastRequestedAt);
    const retryAt = last ? new Date(last.getTime() + COOLDOWN_MS) : null;
    return { cameraAvailable: enabledFor(imei) && config.manualTestEnabled !== false, online: Boolean(connection(imei)), retryAt,
      snapshots: snaps.docs.map(doc => {
        const a = doc.data();
        let state = a.state;
        if (ACTIVE_STATES.includes(state) && asDate(a.authorizationExpiresAt) <= now()) state = 'failed';
        if (state === 'available' && asDate(a.mediaExpiresAt) <= now()) state = 'expired';
        return { id: doc.id, imei, state, purpose: a.purpose, reason: a.reason || null,
          createdAt: asDate(a.createdAt), receivedAt: asDate(a.receivedAt), mediaExpiresAt: asDate(a.mediaExpiresAt),
          sizeBytes: a.sizeBytes || null, width: a.width || null, height: a.height || null };
      }) };
  }

  async function image(uid, id) {
    const auth = await authorized(uid, id, { viewing: true });
    const [data] = await bucket.file(privatePath(auth.serviceOwnerUid, auth.imei, id)).download({ start: 0, end: 65536 });
    if (data.length > 65536 || crypto.createHash('sha256').update(data).digest('hex') !== auth.sha256) fail('invalid_image', 500);
    await authorized(uid, id, { viewing: true });
    await event(id, 'viewed', uid);
    return data;
  }

  async function remove(uid, id) {
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref(id));
      if (!doc.exists) fail('photo_not_found', 404);
      const auth = doc.data();
      const decision = await access(uid, auth.imei, doc => tx.get(doc));
      if (decision.ownerUid !== auth.serviceOwnerUid) fail('photo_not_found', 404);
      tx.update(ref(id), { state: 'deleted', deletedAt: now(), updatedAt: now(), cleanupPending: true, analysis: null });
    });
    await event(id, 'deletion_requested', uid);
    await cleanup(id);
  }

  let sweeping = false;
  async function sweep() {
    ingressObserver.sweep();
    if (sweeping) return;
    sweeping = true;
    try {
      // Each query is bounded, uses a single-field index, and recovers after restart.
      const active = await db.collection('safetySnapshotAuthorizations').where('state', 'in', ACTIVE_STATES).where('authorizationExpiresAt', '<=', now()).orderBy('authorizationExpiresAt').limit(100).get();
      for (const doc of active.docs) if (asDate(doc.data().authorizationExpiresAt) <= now()) {
        const slot = [...pending.values()].find(value => value.id === doc.id);
        await finishFailure(doc.id, 'image_timeout', slot);
      }
      for (const [socket, slot] of pending) if (slot.expiresAt <= now()) pending.delete(socket);
      const available = await db.collection('safetySnapshotAuthorizations').where('state', '==', 'available').where('mediaExpiresAt', '<=', now()).orderBy('mediaExpiresAt').limit(100).get();
      for (const doc of available.docs) if (asDate(doc.data().mediaExpiresAt) <= now()) {
        await db.runTransaction(async tx => {
          const fresh = await tx.get(doc.ref);
          if (fresh.data()?.state === 'available') tx.update(doc.ref, { state: 'expired', cleanupPending: true, updatedAt: now(), analysis: null });
        });
      }
      const dirty = await db.collection('safetySnapshotAuthorizations').where('cleanupPending', '==', true).limit(100).get();
      for (const doc of dirty.docs) if (!ACTIVE_STATES.includes(doc.data().state)) {
        try { await cleanup(doc.id); } catch { report(); }
      }
    } finally { sweeping = false; }
  }
  const request = (uid, input) => requestInternal(uid, input);
  const requestIncident = (uid, imei, incidentId) => requestInternal(uid, { imei,
    purpose: 'SOS or fall incident surroundings', consentConfirmed: true, safetyPurposeConfirmed: true }, incidentId);
  const requestIncidentByGuardian = (uid, imei, incidentId, requestKey) => requestInternal(uid, { imei, requestKey,
    purpose: 'Guardian requested incident surroundings', consentConfirmed: true, safetyPurposeConfirmed: true }, incidentId, true);
  return { request, requestIncident, requestIncidentByGuardian, authorized, observe, observeTraffic, disconnect, list, image, remove, sweep, access,
    observeIngress: ingressObserver.chunk, ingressDiagnosticsStatus: ingressObserver.getStatus };
}

let live = null;
function getSnapshotController() { return live; }
function startSnapshotController({ db, findSessions, env = process.env }) {
  const runtime = readSafetySnapshotRuntime(env);
  if (!db || !runtime.bucketName) return null;
  try {
    const admin = require('firebase-admin');
    const mediaApp = admin.apps.find(app => app.name === 'safety-snapshot-media') ||
      admin.initializeApp(admin.app().options, 'safety-snapshot-media');
    const bucket = admin.storage(mediaApp).bucket(runtime.bucketName);
    // Bound the write lease: do not replay media writes after ambiguous failures.
    bucket.storage.retryOptions.autoRetry = false;
    bucket.storage.retryOptions.maxRetries = 0;
    console.info(`[safety-snapshot] storage runtime ${JSON.stringify(storageRuntimeDetails({
      bucketName: bucket.name, projectId: mediaApp.options.projectId,
      emulatorEnabled: Boolean(process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST),
    }))}`);
    const captureRejectedFrame = createRejectedPhotoCapture(env.SAFETY_SNAPSHOT_REJECTED_FRAME_FILE);
    live = createSnapshotController({ db, bucket, findSessions, runtime, captureRejectedFrame,
      initialSosSettleEnabled: readIncidentPhotoRollout(env).initialSosSettleEnabled });
  } catch {
    console.warn('[safety-snapshot] initialization failed; camera unavailable');
    return null;
  }
  live.sweep().catch(() => console.warn('[safety-snapshot] cleanup deferred'));
  const timer = setInterval(() => live.sweep().catch(() => console.warn('[safety-snapshot] cleanup deferred')), 30_000);
  timer.unref();
  require('./incident-photos-live').startIncidentPhotos({ db, snapshots: live, env });
  return live;
}
module.exports = { createSnapshotController, startSnapshotController, getSnapshotController, isPhotoFrame, decodePhoto };
