'use strict';
const crypto = require('node:crypto');
const { MedicationError, publicReminder } = require('./medication-settings-policy');
const LEASE_MS = 45_000;
function createMedicationStore(db, now = Date.now) {
  const ref = id => db.collection('medicationReminders').doc(id);
  const deviceRef = imei => db.collection('medicationVoiceDevices').doc(imei);
  const audioRef = id => db.collection('medicationVoicePrivate').doc(id);
  const requestRef = id => db.collection('medicationVoiceRequests').doc(id);
  async function list(imei) {
    const rows = await db.collection('medicationReminders').where('imei', '==', imei).get();
    return rows.docs.map(d => publicReminder(d.id, d.data(), now())).filter(d => !d.deleted);
  }
  async function audio({ id, imei, uid }) {
    const row = (await ref(id).get()).data();
    if (!row || row.imei !== imei || row.createdBy !== uid || row.deletedAt || row.mode !== 'voice') {
      throw new MedicationError('recording_unavailable', 404);
    }
    const privateRow = (await audioRef(id).get()).data();
    if (!privateRow || privateRow.version !== row.version) throw new MedicationError('recording_unavailable', 404);
    return privateRow;
  }
  async function claim({ access, request, encoded, pcm }) {
    const { imei, uid } = access, { id, requestId, settings, version, action } = request;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ uid, imei, ...request })).digest('hex');
    return db.runTransaction(async tx => {
      const [prior, current, device, rows, privateSnap, commands] = await Promise.all([
        tx.get(requestRef(requestId)), tx.get(ref(id)), tx.get(deviceRef(imei)),
        tx.get(db.collection('medicationReminders').where('imei', '==', imei)), tx.get(audioRef(id)),
        tx.get(db.collection('deviceCommands').where('imei', '==', imei)),
      ]);
      if (prior.exists) {
        if (prior.data().fingerprint !== fingerprint) throw new MedicationError('request_id_conflict');
        return { replay: true, reminder: publicReminder(id, current.data() || {}, now()) };
      }
      const old = current.data() || {}, state = device.data() || {};
      if (current.exists && (old.imei !== imei || old.createdBy !== uid || old.deletedAt)) throw new MedicationError('reminder_unavailable', 403);
      if ((old.version || 0) !== version) throw new MedicationError('settings_changed');
      if (old.managed === 'voice-v1' && settings.enabled
          && ['sending', 'unconfirmed'].includes(publicReminder(id, old, now()).status)) {
        throw new MedicationError('turn_off_before_retry');
      }
      if (!current.exists && action === 'delete') throw new MedicationError('reminder_unavailable', 404);
      if (state.leaseUntilMs > now()) throw new MedicationError('change_in_progress');
      if (commands.docs.some(d => d.data().type === 'set_medication_reminder'
          && ['pending', 'sending'].includes(d.data().status))) throw new MedicationError('legacy_change_pending');
      const occupied = new Map(Object.entries(state.slots || {}).map(([slot, owner]) => [+slot, owner]));
      for (const row of rows.docs) {
        // A deleted legacy row is still reserved: its write wasn't a readback.
        if (row.id === id) continue;
        if (row.data().managed === 'voice-v1' && row.data().deletedAt && row.data().deviceSyncStatus === 'reply_observed') continue;
        const s = row.data().slot || row.data().frequency;
        if ([1, 2, 3].includes(s)) occupied.set(s, row.id);
      }
      const slot = current.exists ? (old.slot || old.frequency) : [1, 2, 3].find(s => !occupied.has(s));
      if (!slot) throw new MedicationError('watch_slots_full');
      if (occupied.has(slot) && occupied.get(slot) !== id) throw new MedicationError('slot_conflict');
      const priorAudio = privateSnap.data();
      if (settings.mode === 'voice' && !encoded && (!priorAudio || old.mode !== 'voice')) throw new MedicationError('recording_required', 400);
      const durationMs = settings.mode === 'voice' ? encoded?.durationMs || old.durationMs : 0;
      const at = now();
      const value = { ...old, ...settings, id, imei, createdBy: uid, ownerUid: access.ownerUid,
        week: null, managed: 'voice-v1', slot, version: version + 1, requestId,
        durationMs, deviceSyncStatus: 'waiting', deviceSyncError: null,
        leaseUntilMs: at + LEASE_MS, deleteRequested: action === 'delete',
        createdAt: old.createdAt || new Date(at), updatedAt: new Date(at), deletedAt: null };
      const asset = settings.mode === 'voice' ? { version: version + 1,
        pcm: pcm?.toString('base64') || priorAudio.pcm,
        amr: encoded?.audio.toString('base64') || priorAudio.amr } : null;
      tx.set(ref(id), value);
      if (asset) tx.set(audioRef(id), asset); else if (privateSnap.exists) tx.delete(audioRef(id));
      tx.set(deviceRef(imei), { slots: { ...(state.slots || {}), [slot]: id },
        requestId, leaseUntilMs: at + LEASE_MS });
      // Idempotency audit deliberately contains neither audio nor reminder text.
      tx.set(requestRef(requestId), { fingerprint, id, imei, at, status: 'waiting' });
      return { replay: false, value, audio: asset ? Buffer.from(asset.amr, 'base64') : null };
    });
  }
  async function update(value, status, reason = null, evidence = null) {
    return db.runTransaction(async tx => {
      const [current, device] = await Promise.all([tx.get(ref(value.id)), tx.get(deviceRef(value.imei))]);
      if (current.data()?.requestId !== value.requestId || device.data()?.requestId !== value.requestId) {
        throw new MedicationError('operation_superseded');
      }
      if (status === 'sending' && current.data().leaseUntilMs <= now()) throw new MedicationError('request_expired');
      const terminal = status !== 'sending';
      const deleted = value.deleteRequested && status === 'reply_observed';
      const patch = { deviceSyncStatus: status, deviceSyncError: reason,
        ...(evidence ? { evidence } : {}), ...(deleted ? { deletedAt: new Date(now()) } : {}) };
      tx.set(ref(value.id), patch, { merge: true });
      tx.set(requestRef(value.requestId), { status, reason }, { merge: true });
      if (terminal) {
        const slots = { ...device.data().slots };
        if (deleted) delete slots[value.slot];
        tx.set(deviceRef(value.imei), { ...device.data(), slots, leaseUntilMs: 0 });
      }
      if (deleted) tx.delete(audioRef(value.id));
      return publicReminder(value.id, { ...current.data(), ...patch }, now());
    });
  }
  return { list, audio, claim, update };
}
module.exports = { createMedicationStore, LEASE_MS };
