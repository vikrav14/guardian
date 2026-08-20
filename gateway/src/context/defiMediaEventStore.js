'use strict';

const { increment: incrementMetric } = require('../ops-metrics/collector');

function eventPayload(item, now, previous = null) {
  const observedAt = now.toISOString();
  return {
    ...item,
    firstObservedAt: previous?.firstObservedAt || observedAt,
    lastChangedAt: observedAt,
    observeOnly: true,
    deliveryEligible: false,
    deliverySent: false,
  };
}

/**
 * Firestore-backed content-hash deduplication.
 *
 * The RSS provider also deduplicates in memory. This second boundary prevents
 * a gateway restart from making the current feed look new again.
 */
async function persistChangedNewsEvents(db, items = [], now = new Date()) {
  const result = {
    persistent: Boolean(db),
    received: items.length,
    created: [],
    updated: [],
    unchanged: [],
    writes: 0,
  };
  if (!db) {
    result.created = [...items];
    return result;
  }

  for (const item of items) {
    const ref = db.collection('contextNewsEvents').doc(item.documentId);
    const snapshot = await ref.get();
    incrementMetric('firestoreReads');
    const previous = snapshot.exists ? (snapshot.data() || {}) : null;
    if (previous?.contentHash === item.contentHash) {
      result.unchanged.push(item);
      continue;
    }

    await ref.set(eventPayload(item, now, previous), { merge: true });
    incrementMetric('firestoreWrites');
    incrementMetric('contextNewsEventWrites');
    result.writes += 1;
    if (previous) result.updated.push(item);
    else result.created.push(item);
  }
  return result;
}

module.exports = {
  eventPayload,
  persistChangedNewsEvents,
};
