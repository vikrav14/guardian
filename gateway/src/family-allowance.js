'use strict';
const { hash } = require('./family-store');
const { activeMember, policy, serviceEntitlements, monthKey, fail } = require('./family-policy');

// Reservations and provider handoff are persisted separately. An ambiguous send
// stays reserved and is never retried automatically: availability cannot create
// an unbounded paid fan-out after a timeout or a process restart.
function createAllowanceStore(db, { now = Date.now } = {}) {
  const requestRef = id => db.collection('familyAnswers').doc(hash(id));
  async function reserve({ imei, uid, messageId }) {
    if (!messageId || messageId.length > 256) fail('invalid_message', 400);
    const ref = requestRef(messageId), month = monthKey(now());
    const serviceRef = db.collection('familyServices').doc(imei);
    const usageRef = serviceRef.collection('usage').doc(month);
    return db.runTransaction(async tx => {
      const previous = (await tx.get(ref)).data();
      if (previous) return { allowed: false, reason: 'duplicate' };
      const service = (await tx.get(serviceRef)).data();
      const usage = (await tx.get(usageRef)).data() || { used: 0, reserved: 0 };
      if (![usage.used, usage.reserved].every(value => Number.isSafeInteger(value) && value >= 0))
        fail('allowance_needs_review', 503);
      if (!activeMember(service, uid, now()) || !serviceEntitlements(service, now()).serviceActive)
        return { allowed: false, reason: 'access_not_shared' };
      const limit = policy(service).answers;
      if (usage.used + usage.reserved >= limit) return { allowed: false, reason: 'allowance_reached' };
      tx.create(ref, { imei, uid, month, state: 'reserved', createdAtMs: now() });
      tx.set(usageRef, { ...usage, reserved: usage.reserved + 1 });
      return { allowed: true };
    });
  }
  async function transition(messageId, next) {
    const ref = requestRef(messageId);
    return db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (!row || ['sent', 'failed'].includes(row.state)) return false;
      const usageRef = db.collection('familyServices').doc(row.imei).collection('usage').doc(row.month);
      const usage = (await tx.get(usageRef)).data();
      if (next === 'sending') {
        if (row.state !== 'reserved') return false;
        tx.update(ref, { state: 'sending', handoffAtMs: now() });
      } else if (['sent', 'failed'].includes(next)) {
        if (next === 'sent' && row.state !== 'sending') return false;
        tx.update(ref, { state: next, finishedAtMs: now() });
        tx.update(usageRef, { reserved: Math.max(0, usage.reserved - 1), used: usage.used + (next === 'sent' ? 1 : 0) });
      } else fail('invalid_transition', 400);
      return true;
    });
  }
  async function claimNotice(uid, reason) {
    // At most one non-answer response per person per Mauritius day per reason.
    const day = new Date(now() + 4 * 3600000).toISOString().slice(0, 10);
    const ref = db.collection('familyNotices').doc(hash(`${uid}:${day}:${reason}`));
    return db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, { createdAtMs: now(), uid, reason }); return true;
    });
  }
  return { reserve, transition, claimNotice };
}
module.exports = { createAllowanceStore };
