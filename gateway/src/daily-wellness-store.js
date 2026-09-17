'use strict';

const { parseDailyRoutine, localDate, slotFor, DUE_WINDOW_MS } = require('./daily-wellness-scheduler');

const ACTIVE_WINDOW_MS = 5 * 60_000;
const RETENTION_MS = 30 * 86400_000;
const date = value => value?.toDate?.() || (value instanceof Date ? value : null);
const time = value => +(date(value) || new Date(value));

function createDailyWellnessStore({ db, imei, owner, clock = Date.now }) {
  if (!db || !/^\d{15}$/.test(imei || '') || typeof owner !== 'string' || !owner) {
    throw new TypeError('A Firestore database, exact device and lease owner are required.');
  }
  const device = db.collection('devices').doc(imei);
  const requestRef = db.collection('wellnessRoutineRequests').doc(imei);
  const stateRef = device.collection('wellnessRoutine').doc('current');
  const dayRef = day => device.collection('wellnessScheduleDays').doc(day);
  const slotRef = slotId => device.collection('wellnessScheduleSlots').doc(slotId);
  const owns = (state, at) => state?.leaseOwner === owner && time(state.leaseUntil) > at;
  function latest(a, b) { return !a || time(b.scheduledAt) >= time(a.scheduledAt) ? b : a; }

  async function claim(input) {
    if (!input || !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(input.slotId || '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time || '') ||
        !['attempt', 'skipped'].includes(input.disposition)) {
      throw new TypeError('A valid current-day schedule slot is required.');
    }
    const canonical = slotFor(input.date, input.time);
    if (canonical.slotId !== input.slotId || time(input.scheduledAt) !== +canonical.scheduledAt) {
      throw new TypeError('The slot identifier and scheduled time must agree.');
    }
    return db.runTransaction(async tx => {
      const [requestDoc, stateDoc, dayDoc, slotDoc] = await Promise.all([
        tx.get(requestRef), tx.get(stateRef), tx.get(dayRef(input.date)), tx.get(slotRef(input.slotId)),
      ]);
      const at = clock(), state = stateDoc.data() || {}, day = dayDoc.data() || {};
      if (!owns(state, at)) return { claimed: false, reason: 'schedule_lease_lost' };
      const request = parseDailyRoutine(requestDoc.data());
      if (!request || request.updatedAt.toISOString() !== input.revision ||
          +request.updatedAt !== time(input.requestUpdatedAt) || !request.times.includes(input.time)) {
        return { claimed: false, reason: 'schedule_revision_changed' };
      }
      if (slotDoc.exists) return { claimed: false, reason: 'slot_already_recorded', record: slotDoc.data() };
      if (localDate(at) !== input.date || +canonical.scheduledAt > at) {
        return { claimed: false, reason: 'slot_not_due' };
      }
      const limit = request.times.length;
      if (input.maxAttempts !== limit || ![2, 3].includes(limit)) {
        return { claimed: false, reason: 'schedule_limit_changed' };
      }
      let reason = input.disposition === 'skipped' ? String(input.reason || 'skipped').slice(0, 80) : null;
      if (+canonical.scheduledAt < +request.updatedAt) reason = 'before_schedule_update';
      else if (at - +canonical.scheduledAt >= DUE_WINDOW_MS) reason = 'missed';
      if (dayDoc.exists && (!Number.isInteger(day.attempts) || day.attempts < 0 || day.attempts > 3)) {
        return { claimed: false, reason: 'daily_ledger_invalid' };
      }
      const attempts = dayDoc.exists ? day.attempts : 0;
      if (!reason && attempts >= limit) reason = 'daily_attempt_limit';
      if (!reason && state.dailyActiveSlot !== input.slotId && time(state.dailyActiveUntil) > at) {
        reason = 'previous_attempt_reserved';
      }
      const takingAttempt = reason === null;
      const record = { version: 1, slotId: input.slotId, date: input.date, time: input.time,
        scheduledAt: canonical.scheduledAt, revision: input.revision, claimedAt: new Date(at),
        updatedAt: new Date(at), activeUntil: takingAttempt ? new Date(+canonical.scheduledAt + ACTIVE_WINDOW_MS) : null,
        phase: takingAttempt ? 'dispatch_pending' : 'finished',
        outcome: takingAttempt ? 'dispatch_pending' : 'skipped', terminal: !takingAttempt,
        attemptConsumed: takingAttempt, attemptId: null, reason,
        ...(takingAttempt ? { startedAt: new Date(at) } : { finishedAt: new Date(at) }),
        expiresAt: new Date(at + RETENTION_MS) };
      tx.set(slotRef(input.slotId), record);
      tx.set(dayRef(input.date), { version: 1, date: input.date,
        attempts: attempts + (takingAttempt ? 1 : 0), lastAttempt: latest(day.lastAttempt, record),
        updatedAt: new Date(at), expiresAt: new Date(at + RETENTION_MS) }, { merge: true });
      tx.set(stateRef, { dailyLastAttempt: latest(state.dailyLastAttempt, record),
        ...(takingAttempt ? { dailyActiveSlot: input.slotId, dailyActiveUntil: record.activeUntil } : {}) }, { merge: true });
      return { claimed: true, record, ...(reason ? { reason } : {}) };
    });
  }

  async function save(patch) {
    if (!patch || !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(patch.slotId || '')) {
      throw new TypeError('A recorded slot identifier is required.');
    }
    return db.runTransaction(async tx => {
      const slot = slotRef(patch.slotId);
      const [slotDoc, stateDoc] = await Promise.all([tx.get(slot), tx.get(stateRef)]);
      if (!slotDoc.exists) return { saved: false, reason: 'slot_not_recorded' };
      const prior = slotDoc.data(), state = stateDoc.data() || {};
      const day = dayRef(prior.date), dayDoc = await tx.get(day);
      const at = clock();
      if (!owns(state, at)) return { saved: false, reason: 'schedule_lease_lost' };
      if (patch.revision !== prior.revision) return { saved: false, reason: 'slot_revision_mismatch' };
      const safe = {};
      for (const key of ['phase', 'outcome', 'reason', 'attemptId']) {
        if (patch[key] === null) safe[key] = null;
        else if (typeof patch[key] === 'string' && patch[key].length <= 128 &&
            !/[\u0000-\u001f\u007f]/.test(patch[key])) safe[key] = patch[key];
      }
      for (const key of ['terminal', 'temperatureRequested']) if (typeof patch[key] === 'boolean') safe[key] = patch[key];
      if (date(patch.finishedAt) && time(patch.finishedAt) <= at) safe.finishedAt = date(patch.finishedAt);
      const record = { ...prior, ...safe, updatedAt: new Date(at) };
      tx.set(slot, record);
      tx.set(day, { lastAttempt: latest(dayDoc.data()?.lastAttempt, record), updatedAt: new Date(at) }, { merge: true });
      tx.set(stateRef, { dailyLastAttempt: latest(state.dailyLastAttempt, record) }, { merge: true });
      return { saved: true, record };
    });
  }

  async function readLatest() {
    return (await stateRef.get()).data()?.dailyLastAttempt || null;
  }
  return { claim, save, readLatest };
}

module.exports = { createDailyWellnessStore, ACTIVE_WINDOW_MS, RETENTION_MS };
