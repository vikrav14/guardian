'use strict';

const crypto = require('node:crypto');
const jpegCodec = require('jpeg-js');
const { decodeV52PhotoFrame } = require('./protocol/v52-photo');
const { assessSnapshotAccess } = require('./safety-snapshot-requests');
const { normalizePurpose, asDate } = require('./safety-snapshot-policy');
const { readSafetySnapshotRuntime } = require('./safety-snapshot-runtime');
const { protocolIdFromFullImei } = require('./imei');

const WINDOW_MS = 120_000;
const RETENTION_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
const ACTIVE_STATES = ['dispatching', 'waiting_for_image', 'receiving'];
const privatePath = (owner, imei, id) => `privateSafetySnapshots/${owner}/${imei}/${id}.jpg`;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function isPhotoFrame(frame) {
  return Buffer.isBuffer(frame) && frame.length >= 24 && frame.subarray(20, 24).equals(Buffer.from('img,'));
}
function decodePhoto(frame, protocolId) {
  const decoded = decodeV52PhotoFrame(frame, protocolId);
  const pixels = jpegCodec.decode(decoded.jpeg, {
    useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
    maxResolutionInMP: 1.1, maxMemoryUsageInMB: 32,
  });
  if (pixels.width !== decoded.metadata.width || pixels.height !== decoded.metadata.height ||
      pixels.data.length !== pixels.width * pixels.height * 3) fail('invalid_image');
  return decoded;
}

function createSnapshotController({ db, bucket, findSessions, runtime, now = () => new Date(), log = console.warn }) {
  const pending = new Map();
  const config = runtime || readSafetySnapshotRuntime();
  const ref = id => db.collection('safetySnapshotAuthorizations').doc(id);
  const lockRef = imei => db.collection('safetySnapshotDeviceLocks').doc(imei);
  const enabledFor = imei => config.deviceDispatchAllowed && config.acceptedImeis.includes(imei);
  const report = () => log('[safety-snapshot] operation failed; private payload omitted');
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

  async function finishFailure(id, reason) {
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref(id));
      if (!doc.exists || !ACTIVE_STATES.includes(doc.data().state)) return;
      tx.update(ref(id), { state: 'failed', reason, updatedAt: now() });
    });
  }

  async function request(uid, input) {
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
      if (last && at.getTime() < last.getTime() + COOLDOWN_MS) {
        const error = Object.assign(new Error('cooldown_active'), { code: 'cooldown_active', status: 429, retryAt: new Date(last.getTime() + COOLDOWN_MS) });
        throw error;
      }
      const auth = {
        requestId: id, imei, requestedBy: uid, serviceOwnerUid: decision.ownerUid,
        purpose, consentConfirmed: true, safetyPurposeConfirmed: true,
        state: 'dispatching', deviceCommand: 'rcapture', deviceCommandSent: false,
        createdAt: at, updatedAt: at, authorizationExpiresAt: new Date(at.getTime() + WINDOW_MS),
        mediaExpiresAt: new Date(at.getTime() + RETENTION_MS),
        mediaPath: privatePath(decision.ownerUid, imei, id), publicUrl: null,
        cleanupPending: false, correlation: 'same_session_request_window', requestCorrelationVerified: false,
      };
      tx.create(ref(id), auth);
      tx.set(lockRef(imei), { lastRequestedAt: at, requestId: id });
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
      expiresAt: claimed.authorizationExpiresAt, receiving: false };
    pending.set(selected.socket, slot);
    try {
      selected.socket.write(Buffer.from(`[3G*${selected.session.protocolId}*0008*rcapture]`, 'ascii'), error => {
        if (error) {
          if (pending.get(selected.socket) === slot) pending.delete(selected.socket);
          finishFailure(id, 'send_failed').catch(report);
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
    } catch {
      if (pending.get(selected.socket) === slot) pending.delete(selected.socket);
      await finishFailure(id, 'send_or_persistence_failed');
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
    try {
      const image = decodePhoto(frame, slot.session.protocolId);
      await db.runTransaction(async tx => {
        const doc = await tx.get(ref(slot.id));
        const auth = doc.data();
        const decision = await access(slot.uid, slot.imei, doc => tx.get(doc));
        if (!auth || !['dispatching', 'waiting_for_image'].includes(auth.state) ||
            decision.ownerUid !== auth.serviceOwnerUid || asDate(auth.authorizationExpiresAt) <= now()) fail('request_no_longer_active');
        tx.update(ref(slot.id), { state: 'receiving', cleanupPending: true, uploadLeaseUntil: new Date(now().getTime() + 120_000), updatedAt: now() });
      });
      const path = privatePath(slot.ownerUid, slot.imei, slot.id);
      attemptedSave = true;
      await bucket.file(path).save(image.jpeg, {
        resumable: false, timeout: 30_000, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store',
          metadata: { requestId: slot.id, expiresAt: new Date(now().getTime() + RETENTION_MS).toISOString() } },
      });
      await db.runTransaction(async tx => {
        const doc = await tx.get(ref(slot.id));
        const auth = doc.data();
        const decision = await access(slot.uid, slot.imei, doc => tx.get(doc));
        if (auth?.state !== 'receiving' || decision.ownerUid !== auth.serviceOwnerUid || asDate(auth.authorizationExpiresAt) <= now()) fail('request_no_longer_active');
        tx.update(ref(slot.id), { state: 'available', receivedAt: now(), updatedAt: now(),
          sizeBytes: image.jpeg.length, width: image.metadata.width, height: image.metadata.height,
          contentType: 'image/jpeg', sha256: crypto.createHash('sha256').update(image.jpeg).digest('hex'),
          deviceTimestampRaw: image.metadata.deviceTimestampRaw, cleanupPending: false, uploadLeaseUntil: null,
          validation: 'full_pixel_decode', timeBasis: 'gateway_receipt_not_verified_capture_time' });
      });
      await event(slot.id, 'image_available').catch(report);
    } catch {
      await finishFailure(slot.id, 'image_rejected_or_storage_failed');
      if (attemptedSave) {
        await ref(slot.id).update({ cleanupPending: true, uploadLeaseUntil: null });
        await cleanup(slot.id);
      }
    } finally {
      if (pending.get(slot.socket) === slot) pending.delete(slot.socket);
    }
  }

  function observe(frame, socket, session) {
    if (!isPhotoFrame(frame)) return false;
    const slot = pending.get(socket);
    if (slot && !slot.receiving && slot.session === session && slot.imei === session.imei && now() < slot.expiresAt) {
      slot.receiving = true;
      receive(slot, Buffer.from(frame)).catch(report);
    }
    // Unsolicited, duplicate and expired images are dropped without logs or ACKs.
    return true;
  }

  function disconnect(socket) {
    const slot = pending.get(socket);
    pending.delete(socket);
    if (slot && !slot.receiving) finishFailure(slot.id, 'watch_disconnected').catch(report);
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
    return { cameraAvailable: enabledFor(imei), online: Boolean(connection(imei)), retryAt,
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
      tx.update(ref(id), { state: 'deleted', deletedAt: now(), updatedAt: now(), cleanupPending: true });
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
        await finishFailure(doc.id, 'image_timeout');
      }
      for (const [socket, slot] of pending) if (slot.expiresAt <= now()) pending.delete(socket);
      const available = await db.collection('safetySnapshotAuthorizations').where('state', '==', 'available').where('mediaExpiresAt', '<=', now()).orderBy('mediaExpiresAt').limit(100).get();
      for (const doc of available.docs) if (asDate(doc.data().mediaExpiresAt) <= now()) {
        await db.runTransaction(async tx => {
          const fresh = await tx.get(doc.ref);
          if (fresh.data()?.state === 'available') tx.update(doc.ref, { state: 'expired', cleanupPending: true, updatedAt: now() });
        });
      }
      const dirty = await db.collection('safetySnapshotAuthorizations').where('cleanupPending', '==', true).limit(100).get();
      for (const doc of dirty.docs) if (!ACTIVE_STATES.includes(doc.data().state)) {
        try { await cleanup(doc.id); } catch { report(); }
      }
    } finally { sweeping = false; }
  }
  return { request, observe, disconnect, list, image, remove, sweep, access };
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
    live = createSnapshotController({ db, bucket, findSessions, runtime });
  } catch {
    console.warn('[safety-snapshot] initialization failed; camera unavailable');
    return null;
  }
  live.sweep().catch(() => console.warn('[safety-snapshot] cleanup deferred'));
  const timer = setInterval(() => live.sweep().catch(() => console.warn('[safety-snapshot] cleanup deferred')), 30_000);
  timer.unref();
  return live;
}
module.exports = { createSnapshotController, startSnapshotController, getSnapshotController, isPhotoFrame, decodePhoto };
