'use strict';

const crypto = require('node:crypto');
const { BUILDERS, TCP_ONLY_TYPES, sendDeviceCommand } = require('./commands');
const { findSocketsForDevice } = require('./sessions');
const { commandCoordinator, promptCommand } = require('./command-coordinator');
const { loadEntitlementsForUser } = require('./entitlements');
const MAX_WAIT_MS = 120_000;
const millis = value => value?.toMillis?.() || +new Date(value);
const settingKey = row => row.type?.startsWith('set_')
  // The legacy TAKEPILLS builder uses frequency as its physical slot. Two
  // app reminder IDs must not create independent queues for that same slot.
  ? `${row.imei}:${row.type}:${row.type === 'set_medication_reminder' ? row.params?.frequency : row.params?.slot || ''}` : null;

async function authorizeCommand(db, row, now) {
  if (!row.createdBy || !/^\d{15}$/.test(row.imei || '')) return false;
  // Firestore rules prohibit every client from creating this command type.
  // Retain the exact Admin SDK operator route; a linked client cannot opt in.
  if (row.type === 'set_alarm_mode') return row.createdBy === 'operator:queue-v52-alarm-mode'
    && (await db.collection('devices').doc(row.imei).get()).exists;
  if (['set_phonebook_contact', 'set_watch_answer_mode'].includes(row.type)) return false;
  try {
    await require('./family-policy').watchAccess(db, row.createdBy, row.imei,
      row.type === 'set_medication_reminder' ? 'reminders' : 'settings', { now });
  } catch { return false; }
  const snap = await db.collection('users').doc(row.createdBy).get();
  const user = { ...snap.data(), uid: row.createdBy };
  if (!snap.exists || !user.linkedImeis?.includes(row.imei)) return false;
  if (['set_watch_alert_profile', 'set_medication_reminder'].includes(row.type)) {
    const access = await loadEntitlementsForUser(db, user, { now: new Date(now), imei: row.imei });
    return access.serviceActive && ['family', 'care'].includes(access.plan);
  }
  return true;
}

function createDeviceCommandDispatcher({ db, now = Date.now, coordinator = commandCoordinator,
  find = findSocketsForDevice, send = sendDeviceCommand, authorize = authorizeCommand,
  onResult = async () => {}, reporting = null, processId = crypto.randomUUID() }) {
  let running = null;
  let rerun = false;
  let startup = true;
  let hasWork = true;
  const ref = id => db.collection('deviceCommands').doc(id);
  async function finish(doc, status, reason, extra = {}, from = 'queued') {
    const changed = await db.runTransaction(async tx => {
      const current = (await tx.get(doc.ref)).data();
      const allowed = from === 'claimed'
        ? current?.status === 'sending' && current.coordinationProcess === processId
        : from === 'abandoned'
          ? current?.status === 'sending' && current.coordinationProcess !== processId
          : ['pending', 'deferred'].includes(current?.status);
      if (!allowed) return false;
      tx.update(doc.ref, { status, error: reason || null, completedAt: new Date(now()), ...extra });
      return true;
    });
    if (changed) await onResult(doc.data(), status, reason);
  }
  async function valid(row) {
    const at = millis(row.createdAt);
    if (!Number.isFinite(at) || at > now() + 5000 || now() >= at + MAX_WAIT_MS) return 'command_expired';
    if (row.status === 'deferred' && row.coordinationProcess !== processId) return 'gateway_restarted';
    if (!Object.hasOwn(BUILDERS, row.type)) return 'unsupported_command';
    try { BUILDERS[row.type](row.params || {}); } catch { return 'invalid_command'; }
    if (!(await authorize(db, row, now()))) return 'authorization_changed';
    if (row.type === 'set_upload_interval') {
      const current = (await db.collection('devices').doc(row.imei).get()).data();
      // The app can switch back to automatic while a manual setting waits.
      // Never restore that obsolete interval when a camera lease ends.
      if (current?.locationReportingMode !== 'manual' ||
          Number(current.manualReportingIntervalSeconds ?? current.locationReportingIntervalSeconds) !== Number(row.params.seconds)) return 'reporting_policy_changed';
    }
    return now() >= at + MAX_WAIT_MS ? 'command_expired' : null;
  }
  async function retainLatest(row, id) {
    const key = settingKey(row);
    if (!key) return true;
    const intent = db.collection('deviceCommandIntents').doc(crypto.createHash('sha256').update(key).digest('hex'));
    return db.runTransaction(async tx => {
      const latest = (await tx.get(intent)).data();
      const at = millis(row.createdAt);
      if (latest && (latest.createdAtMs > at || (latest.createdAtMs === at && latest.commandId > id))) return false;
      // Retain the newest authorized intent even after its handoff/expiry. An
      // older deferred enable must never run after a newer explicit stop.
      if (latest?.commandId !== id) tx.set(intent, { commandId: id, createdAtMs: at });
      return true;
    });
  }
  async function run() {
    if (startup) {
      startup = false;
      const ambiguous = await db.collection('deviceCommands').where('status', '==', 'sending').limit(100).get();
      for (const doc of ambiguous.docs) if (doc.data().coordinationProcess !== processId) {
        await finish(doc, 'failed', 'handoff_unconfirmed_after_restart', {}, 'abandoned');
      }
    }
    // Bounded, single-field query. Only IDs/persisted intent are revisited;
    // an action whose handoff may have occurred is never retried.
    const batch = await db.collection('deviceCommands').where('status', 'in', ['pending', 'deferred']).limit(100).get();
    hasWork = batch.docs.length > 0;
    if (batch.docs.length === 100) {
      for (const doc of batch.docs) await finish(doc, 'failed', 'command_queue_capacity');
      return; // Never choose an older setting from an incomplete candidate set.
    }
    const rows = [];
    for (const doc of batch.docs) {
      const reason = await valid(doc.data());
      if (reason) await finish(doc, 'failed', reason);
      else rows.push(doc);
    }
    rows.sort((a, b) => millis(b.data().createdAt) - millis(a.data().createdAt) || b.id.localeCompare(a.id));
    const newest = new Set();
    const selected = [];
    for (const doc of rows) {
      const key = settingKey(doc.data());
      if (key && newest.has(key)) { await finish(doc, 'failed', 'superseded'); continue; }
      if (key) newest.add(key);
      selected.push(doc);
    }
    selected.sort((a, b) => Number(promptCommand(BUILDERS[b.data().type](b.data().params || {}))) -
      Number(promptCommand(BUILDERS[a.data().type](a.data().params || {}))));
    await Promise.all(selected.map(doc => deliver(doc)));
  }
  async function deliver(original) {
      const doc = await ref(original.id).get(), row = doc.data();
      if (!row || !['pending', 'deferred'].includes(row.status)) return;
      const connection = find(row.imei);
      const protocolId = connection[0]?.session.protocolId;
      const reason = await valid(row);
      if (reason) { await finish(doc, 'failed', reason); return; }
      if (!(await retainLatest(row, doc.id))) { await finish(doc, 'failed', 'superseded'); return; }
      const current = find(row.imei);
      if (TCP_ONLY_TYPES.has(row.type) && (current.length !== 1 || connection.length !== 1 ||
          current[0].socket !== connection[0].socket || current[0].session !== connection[0].session ||
          current[0].session.protocolId !== protocolId ||
          current[0].socket.destroyed || current[0].socket.writable === false)) {
        await finish(doc, 'failed', 'session_changed_or_unavailable'); return;
      }
      const decision = coordinator.decide(row.imei, BUILDERS[row.type](row.params || {}),
        { expiresAt: millis(row.createdAt) + MAX_WAIT_MS });
      if (!decision.ok) {
        if (decision.error !== 'camera_busy') { await finish(doc, 'failed', decision.error); return; }
        if (row.status !== 'deferred') await db.runTransaction(async tx => {
          // A prompt path may already have claimed/completed the same row.
          // Never turn that handoff back into deferred work that can replay.
          const fresh = (await tx.get(doc.ref)).data();
          if (fresh?.status !== 'pending') return;
          tx.update(doc.ref, { status: 'deferred', error: 'camera_busy',
            coordinationProcess: processId, expiresAt: new Date(millis(row.createdAt) + MAX_WAIT_MS) });
        });
        return;
      }
      const claimed = await db.runTransaction(async tx => {
        const fresh = await tx.get(doc.ref);
        if (!['pending', 'deferred'].includes(fresh.data()?.status)) return false;
        tx.update(doc.ref, { status: 'sending', coordinationProcess: processId }); return true;
      });
      if (!claimed) return;
      try {
        // Recheck after the asynchronous claim, immediately before handoff.
        const beforeSend = async () => {
          const reason = await valid(row);
          if (reason) throw new Error(reason);
          if (!(await retainLatest(row, doc.id))) throw new Error('superseded');
          const final = find(row.imei);
          if (now() >= millis(row.createdAt) + MAX_WAIT_MS) throw new Error('command_expired');
          if (TCP_ONLY_TYPES.has(row.type) && (final.length !== 1 || final[0].socket !== current[0].socket ||
              final[0].session !== current[0].session || final[0].session.protocolId !== protocolId ||
              final[0].socket.destroyed || final[0].socket.writable === false)) throw new Error('session_changed');
        };
        await beforeSend();
        const outcome = row.type === 'set_upload_interval' && reporting
          ? await reporting(row, { beforeSend }) : await send(db, row.imei, row.type, row.params, { beforeSend });
        if (outcome?.status === 'deferred') throw new Error('camera_busy');
        await finish(doc, 'sent', null, { result: outcome ?? null }, 'claimed');
      } catch (error) {
        // Even an ambiguous write ends here; no reconnect or restart replay.
        await finish(doc, 'failed', error.code || error.message, {}, 'claimed');
      }
  }

  function tick() {
    // A snapshot can arrive while an empty query is resolving. Remember that
    // wake-up, or idle polling could stop with the new request still pending.
    if (running) rerun = true;
    else running = (async () => {
      do { rerun = false; await run(); } while (rerun);
    })().finally(() => { running = null; });
    return running;
  }
  // Called directly by the snapshot observer for calls/stops. A slow routine
  // reconciliation never becomes a queue in front of these actions.
  function prompt(doc) {
    try {
      const row = doc.data();
      if (promptCommand(BUILDERS[row.type]?.(row.params || {}) || '')) return deliver(doc);
    } catch { /* Regular validation records unsupported/invalid requests. */ }
    return Promise.resolve();
  }
  return { tick, prompt, hasWork: () => hasWork };
}
module.exports = { createDeviceCommandDispatcher, authorizeCommand, settingKey, MAX_WAIT_MS };
