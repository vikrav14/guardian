'use strict';
const crypto = require('node:crypto');
const {
  VoiceError,
  publicMessage,
  RETENTION_MS,
} = require('./voice-message-policy');
const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
function createVoiceStore(db, now = Date.now) {
  const messages = db.collection('voiceMessages'),
    assets = db.collection('voiceMessagePrivate'),
    devices = db.collection('voiceMessageDevices');
  async function put({
    access,
    id,
    direction,
    audio,
    pcm,
    durationMs,
    dispatchUntilMs = now() + 30000,
  }) {
    const fingerprint = digest(
      Buffer.concat([
        Buffer.from(`${access.uid}:${access.imei}:${direction}:`),
        audio,
      ]),
    );
    return db.runTransaction(async (tx) => {
      const [prior, device] = await Promise.all([
        tx.get(messages.doc(id)),
        tx.get(devices.doc(access.imei)),
      ]);
      if (prior.exists) {
        const row = prior.data();
        if (
          row.fingerprint !== fingerprint ||
          row.uid !== access.uid ||
          row.imei !== access.imei
        )
          throw new VoiceError('request_id_conflict');
        if (
          direction === 'incoming' &&
          (row.expiresAtMs <= now() || row.deletedAtMs)
        )
          throw new VoiceError('message_expired');
        return { replay: true, row };
      }
      const state = device.data() || {},
        day = Math.floor(now() / RETENTION_MS);
      if (direction === 'outgoing' && dispatchUntilMs <= now())
        throw new VoiceError('send_expired');
      if (direction === 'outgoing' && state.pendingId)
        throw new VoiceError('delivery_unconfirmed');
      if (state.day === day && state.count >= 120)
        throw new VoiceError('daily_message_limit', 429);
      if (direction === 'outgoing' && now() < (state.nextSendAtMs || 0))
        throw new VoiceError('send_cooldown', 429);
      const row = {
        id,
        uid: access.uid,
        ownerUid: access.ownerUid,
        imei: access.imei,
        direction,
        fingerprint,
        durationMs,
        createdAtMs: now(),
        expiresAtMs: now() + RETENTION_MS,
        dispatchUntilMs: Math.min(dispatchUntilMs, now() + 30000),
        status: direction === 'incoming' ? 'received' : 'preparing',
        playedBy: [],
        deletedAtMs: null,
      };
      tx.set(messages.doc(id), row);
      tx.set(assets.doc(id), {
        imei: access.imei,
        uid: access.uid,
        expiresAtMs: row.expiresAtMs,
        amr: audio.toString('base64'),
        pcm: pcm.toString('base64'),
      });
      tx.set(devices.doc(access.imei), {
        ...state,
        day,
        count: state.day === day ? (state.count || 0) + 1 : 1,
        ...(direction === 'outgoing'
          ? { pendingId: id, nextSendAtMs: now() + 60000 }
          : {}),
      });
      return { replay: false, row };
    });
  }
  async function update(row, status, reason = null) {
    return db.runTransaction(async (tx) => {
      const [snap, device] = await Promise.all([
        tx.get(messages.doc(row.id)),
        tx.get(devices.doc(row.imei)),
      ]);
      if (
        !snap.exists ||
        snap.data().deletedAtMs ||
        snap.data().expiresAtMs <= now()
      )
        throw new VoiceError('message_expired');
      if (
        status === 'sending' &&
        (snap.data().status !== 'preparing' || row.dispatchUntilMs <= now())
      )
        throw new VoiceError('send_expired');
      const current = { ...snap.data(), status, reason };
      tx.set(messages.doc(row.id), { status, reason }, { merge: true });
      // Ambiguous or interrupted dispatch stays latched across process restarts.
      // A future admin recovery procedure must be explicit, never a blind replay.
      if (
        ['reply_observed', 'rejected', 'not_sent'].includes(status) &&
        device.data()?.pendingId === row.id
      )
        tx.set(devices.doc(row.imei), { pendingId: null }, { merge: true });
      return current;
    });
  }
  async function authorizedRow(access, id) {
    const row = (await messages.doc(id).get()).data();
    if (
      !row ||
      row.imei !== access.imei ||
      row.uid !== access.uid ||
      row.deletedAtMs ||
      row.expiresAtMs <= now()
    )
      throw new VoiceError('message_unavailable', 404);
    return row;
  }
  async function audio(access, id) {
    await authorizedRow(access, id);
    const asset = (await assets.doc(id).get()).data();
    if (
      !asset ||
      asset.uid !== access.uid ||
      asset.imei !== access.imei ||
      asset.expiresAtMs <= now()
    )
      throw new VoiceError('message_unavailable', 404);
    return Buffer.from(asset.pcm, 'base64');
  }
  async function markPlayed(access, id) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(messages.doc(id)),
        row = snap.data();
      if (
        !row ||
        row.imei !== access.imei ||
        row.uid !== access.uid ||
        row.deletedAtMs ||
        row.expiresAtMs <= now()
      )
        throw new VoiceError('message_unavailable', 404);
      if (row.direction !== 'incoming')
        throw new VoiceError('invalid_playback_action', 400);
      const playedBy = [...new Set([...(row.playedBy || []), access.uid])];
      tx.set(messages.doc(id), { playedBy }, { merge: true });
    });
  }
  async function remove(access, id) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(messages.doc(id));
      const row = snap.data();
      if (!row || row.imei !== access.imei || row.uid !== access.uid)
        throw new VoiceError('message_unavailable', 404);
      // Deleting audio must remain possible even after an ambiguous send.
      // Keep the device dispatch latch; deletion never authorizes another send.
      tx.delete(assets.doc(id));
      tx.set(
        messages.doc(id),
        { deletedAtMs: now(), status: 'expired', playedBy: [] },
        { merge: true },
      );
    });
  }
  async function list(access) {
    const rows = await messages
      .where('imei', '==', access.imei)
      .orderBy('createdAtMs', 'desc')
      .limit(240)
      .get();
    const state = (await devices.doc(access.imei).get()).data() || {};
    return {
      messages: rows.docs
        .map((d) => d.data())
        .filter(
          (r) =>
            r.uid === access.uid && !r.deletedAtMs && r.expiresAtMs > now(),
        )
        .map((r) => publicMessage(r, access.uid, now()))
        .reverse(),
      sendingBlocked: !!state.pendingId,
      nextSendAt: state.nextSendAtMs || 0,
    };
  }
  async function cleanup() {
    const rows = await assets.where('expiresAtMs', '<=', now()).limit(50).get();
    if (rows.docs.length) {
      const batch = db.batch();
      for (const row of rows.docs) batch.delete(row.ref);
      await batch.commit();
    }
    // Minimal receipt/idempotency metadata outlives private audio by six days.
    const old = await messages
      .where('expiresAtMs', '<=', now() - 6 * RETENTION_MS)
      .limit(50)
      .get();
    if (old.docs.length) {
      const batch = db.batch();
      for (const row of old.docs) {
        batch.delete(row.ref);
        batch.delete(assets.doc(row.id));
      }
      await batch.commit();
    }
  }
  return {
    put,
    update,
    audio,
    markPlayed,
    remove,
    list,
    cleanup,
    incomingId: (imei, audio) =>
      'in_' +
      digest(
        Buffer.concat([
          Buffer.from(imei + ':' + Math.floor(now() / RETENTION_MS) + ':'),
          audio,
        ]),
      ),
  };
}
module.exports = { createVoiceStore };
