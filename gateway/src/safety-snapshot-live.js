'use strict';

const crypto = require('node:crypto');
const jpegCodec = require('jpeg-js');
const { decodeV52PhotoFrame, PhotoDecodeError } = require('./protocol/v52-photo');
const { createRejectedPhotoCapture } = require('./safety-snapshot-rejected-frame');
const { assessSnapshotAccess } = require('./safety-snapshot-requests');
const { normalizePurpose, asDate } = require('./safety-snapshot-policy');
const { readSafetySnapshotRuntime } = require('./safety-snapshot-runtime');
const { protocolIdFromFullImei } = require('./imei');
const { consentAllows, readIncidentAuthorization } = require('./incident-photo-policy');

const WINDOW_MS = 120_000;
const RETENTION_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
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
    duplicatePhotoFrames: 0, failureStage: null, decodeError: null,
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
  captureRejectedFrame = null }) {
  const pending = new Map();
  const config = runtime || readSafetySnapshotRuntime();
  const ref = id => db.collection('safetySnapshotAuthorizations').doc(id);
  const lockRef = imei => db.collection('safetySnapshotDeviceLocks').doc(imei);
  const enabledFor = imei => config.deviceDispatchAllowed && config.acceptedImeis.includes(imei);
  const report = () => log('[safety-snapshot] operation failed; private payload omitted');
  const reportReceive = (slot, outcome) => {
    // Fixed schema; no exception text, identities, purpose, token or media.
    if (slot) log(`[safety-snapshot] ${JSON.stringify({ requestId: slot.id,
      outcome, receiveDiagnostics: slot.diagnostics })}`);
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
    const decision = assessSnapshotAccess({ requesterUid: uid, user, owner: owner.data(), subscription: sub.data(), imei, now: now() });
    if (!decision.ok) fail(decision.reason, 403);
    return decision;
  }

  function connection(imei) {
    const expectedProtocolId = protocolIdFromFullImei(imei);
    const matches = findSessions(imei).filter(({ socket, session }) =>
      !socket.destroyed && socket.writable !== false && session.imei === imei &&
      expectedProtocolId != null && session.protocolId === expectedProtocolId);
    // Never fan out a camera request across duplicate/replacement sessions.
    return matches.length === 1 ? matches[0] : null;
  }

  async function finishFailure(id, reason, slot = null) {
    const changed = await db.runTransaction(async tx => {
      const doc = await tx.get(ref(id));
      if (!doc.exists || !ACTIVE_STATES.includes(doc.data().state)) return false;
      tx.update(ref(id), { state: 'failed', reason, updatedAt: now(),
        ...(slot ? { receiveDiagnostics: { ...slot.diagnostics } } : {}) });
      return true;
    });
    if (changed) reportReceive(slot, reason);
  }

  async function requestInternal(uid, input, incidentId = null) {
    if (!incidentId && config.manualTestEnabled === false) fail('manual_photos_disabled', 403);
    const imei = String(input?.imei || '');
    let purpose;
    try { purpose = normalizePurpose(input?.purpose); } catch { fail('invalid_purpose', 400); }
    if (purpose.length < 8 || input?.consentConfirmed !== true || input?.safetyPurposeConfirmed !== true) fail('consent_and_purpose_required', 400);
    if (!enabledFor(imei)) fail('camera_unavailable', 503);
    if (!connection(imei)) fail('watch_offline_or_reconnecting');
    // Fixed server-generated ID and transaction lock also serialize different guardians.
    const id = crypto.randomUUID();
    const claimed = await db.runTransaction(async tx => {
      const decision = await access(uid, imei, doc => tx.get(doc));
      const lock = await tx.get(lockRef(imei));
      const last = asDate(lock.data()?.lastRequestedAt);
      const at = now();
      const incidentClaim = incidentId
        ? await readIncidentAuthorization(db, tx, incidentId, uid, imei, at) : null;
      if (asDate(lock.data()?.activeUntil) > at ||
          (asDate(lock.data()?.incidentUntil) > at && lock.data()?.incidentId !== incidentId)) fail('camera_busy');
      if (!incidentId && last && at.getTime() < last.getTime() + COOLDOWN_MS) {
        const error = Object.assign(new Error('cooldown_active'), { code: 'cooldown_active', status: 429, retryAt: new Date(last.getTime() + COOLDOWN_MS) });
        throw error;
      }
      const auth = {
        requestId: id, imei, requestedBy: uid, serviceOwnerUid: decision.ownerUid,
        purpose, consentConfirmed: true, safetyPurposeConfirmed: true,
        ...(incidentId ? { incidentId, sequence: incidentClaim.incident.requestIds.length + 1,
          analysis: { status: 'pending' } } : {}),
        state: 'dispatching', deviceCommand: 'rcapture', deviceCommandSent: false,
        createdAt: at, updatedAt: at, authorizationExpiresAt: new Date(at.getTime() + WINDOW_MS),
        mediaExpiresAt: new Date(at.getTime() + RETENTION_MS),
        mediaPath: privatePath(decision.ownerUid, imei, id), publicUrl: null,
        cleanupPending: false, correlation: 'same_session_request_window', requestCorrelationVerified: false,
      };
      tx.create(ref(id), auth);
      tx.set(lockRef(imei), { ...lock.data(), lastRequestedAt: at, requestId: id,
        activeUntil: new Date(at.getTime() + WINDOW_MS) });
      if (incidentClaim) tx.update(incidentClaim.ref, {
        requestIds: [...incidentClaim.incident.requestIds, id], updatedAt: at,
      });
      tx.create(db.collection('safetySnapshotAudit').doc(id), {
        requestId: id, imei, requestedBy: uid, serviceOwnerUid: decision.ownerUid,
        consentConfirmed: true, safetyPurposeConfirmed: true, purpose, createdAt: at,
      });
      return auth;
    });
    const selected = connection(imei);
    if (!selected) { await finishFailure(id, 'watch_disconnected'); return id; }
    // Install reception before write; reply/upload may race the persistence update.
    const slot = { id, ...selected, imei, ownerUid: claimed.serviceOwnerUid, uid,
      expiresAt: claimed.authorizationExpiresAt, startedAt: now(), receiving: false,
      protocolId: selected.session.protocolId, diagnostics: receiveDiagnostics() };
    pending.set(selected.socket, slot);
    try {
      selected.socket.write(Buffer.from(`[3G*${selected.session.protocolId}*0008*rcapture]`, 'ascii'), error => {
        if (error) {
          if (pending.get(selected.socket) === slot) pending.delete(selected.socket);
          finishFailure(id, 'send_failed', slot).catch(report);
        }
      });
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
          receiveDiagnostics: { ...slot.diagnostics } });
        if (lock.data()?.requestId === slot.id) tx.update(lockRef(slot.imei), { activeUntil: now() });
      });
      reportReceive(slot, 'image_available');
      await event(slot.id, 'image_available').catch(report);
    } catch (error) {
      slot.diagnostics.failureStage = stage;
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
      await finishFailure(slot.id, 'image_rejected_or_storage_failed', slot);
      if (attemptedSave) {
        await ref(slot.id).update({ cleanupPending: true, uploadLeaseUntil: null });
        await cleanup(slot.id);
      }
    } finally {
      if (pending.get(slot.socket) === slot) pending.delete(slot.socket);
    }
  }

  function observeTraffic(socket, session, { chunkBytes, frames, rest }) {
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
      receive(slot, Buffer.from(frame)).catch(report);
    }
    // Dropped images never generate ACKs or raw logs. Counters are bounded to
    // this request and written once with its terminal state, not per packet.
    return true;
  }

  function disconnect(socket) {
    const slot = pending.get(socket);
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
  return { request, requestIncident, authorized, observe, observeTraffic, disconnect, list, image, remove, sweep, access };
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
    const captureRejectedFrame = createRejectedPhotoCapture(env.SAFETY_SNAPSHOT_REJECTED_FRAME_FILE);
    live = createSnapshotController({ db, bucket, findSessions, runtime, captureRejectedFrame });
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
