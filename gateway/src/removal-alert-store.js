'use strict';

const {
  normalizeRemovalObservation,
  reduceRemovalState,
} = require('./removal-alert-policy');

async function ingestRemovalObservation(db, event, options = {}) {
  if (options.enabled !== true) return { status: 'disabled' };
  if (!db) return { status: 'firestore_unavailable' };

  const observation = normalizeRemovalObservation(event, options.now || new Date());
  if (!observation?.imei) return { status: 'ignored_invalid' };

  const deviceRef = db.collection('devices').doc(observation.imei);
  const stateRef = deviceRef.collection('safetyStates').doc('watchRemoval');
  const deviceSnap = await deviceRef.get();
  const device = deviceSnap.exists ? deviceSnap.data() || {} : {};
  const settings = device.removalAlerts || {};
  let outcome = null;

  await db.runTransaction(async (transaction) => {
    const stateSnap = await transaction.get(stateRef);
    const previous = stateSnap.exists ? stateSnap.data() || null : null;
    outcome = reduceRemovalState(previous, observation, settings, {
      mode: options.mode,
      customerEnabled: options.customerEnabled,
    });
    if (outcome.ignored === 'stale') return;
    transaction.set(stateRef, {
      ...outcome.state,
      imei: observation.imei,
      updatedAt: observation.observedAt,
    }, { merge: true });
  });

  if (!outcome || outcome.ignored === 'stale') {
    return { status: 'ignored_stale', state: outcome?.state || null };
  }

  if (outcome.transition) {
    await db.collection('removalAlertAudit').add({
      imei: observation.imei,
      eventType: outcome.transition.type,
      eventAt: outcome.transition.at,
      source: observation.source,
      quiet: outcome.transition.quiet,
      notificationEligible: outcome.transition.notify,
      mode: outcome.state.mode,
      createdAt: observation.observedAt,
    });
  }

  return {
    status: 'stored',
    state: outcome.state,
    transition: outcome.transition,
  };
}

module.exports = { ingestRemovalObservation };
