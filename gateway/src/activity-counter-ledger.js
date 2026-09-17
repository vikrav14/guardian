'use strict';

const { wearAt } = require('./wear-evidence');
const VERSION = 2;
const MAX_INTERVAL_MS = 30 * 60_000;
const INTERVAL_RETENTION_MS = 7 * 86_400_000;
const MAX_RECENT_INTERVALS = 256;

function date(value) {
  if (value == null) return null;
  const result = value?.toDate?.() || new Date(value);
  return Number.isFinite(+result) ? result : null;
}

function addReason(day, reason) {
  day.coverageReasons = [...new Set([...day.coverageReasons, reason])];
}

// Raw counts have no documented reset epoch. This ledger records increases
// between observations; it never treats the first raw value as today's total.
// Receipt-time intervals cannot locate individual steps within an interval.
function reduceCounterLedger(previousState, previousDay, observation, options = {}) {
  const at = observation.receivedAt;
  const compatible = previousState?.schemaVersion === VERSION &&
    previousState.timeZone === observation.timeZone &&
    Number.isInteger(previousState.lastRaw) && previousState.lastRaw >= 0 &&
    date(previousState.baselineAt) && date(previousState.lastObservedAt);
  const prior = compatible ? previousState : null;
  if (prior && +at <= +date(prior.lastObservedAt)) return { status: 'ignored_stale' };
  if (observation.deviceObservedAt && prior?.lastDeviceObservedAt &&
      +observation.deviceObservedAt <= +date(prior.lastDeviceObservedAt)) {
    return { status: 'ignored_stale' };
  }
  const existing = previousDay?.schemaVersion === VERSION &&
    previousDay.timeZone === observation.timeZone &&
    Number.isInteger(previousDay.recordedSteps) && previousDay.recordedSteps >= 0;
  const day = existing ? { ...previousDay,
    coverageReasons: [...(previousDay.coverageReasons || [])] } : {
    schemaVersion: VERSION, imei: observation.imei, localDate: observation.localDate,
    timeZone: observation.timeZone, source: 'v52_counter',
    aggregation: 'observed_delta', recordedSteps: 0, observedDeltaSteps: 0,
    firstRaw: observation.stepsRaw, firstObservedAt: at,
    sampleCount: 0, resetCount: 0, confirmedResetCount: 0, anomalyCount: 0,
    unallocatedSteps: 0, gapCount: 0, coverage: 'partial', coverageReasons: [],
  };
  const state = prior ? { ...prior } : {
    schemaVersion: VERSION, timeZone: observation.timeZone,
    lastRaw: observation.stepsRaw, baselineAt: at, baselineLocalDate: observation.localDate,
    segment: 1, pendingDiscontinuity: null, lastDeviceObservedAt: null,
  };
  const interval = {
    schemaVersion: VERSION, displayable: false,
    from: date(state.baselineAt), to: at,
    fromLocalDate: state.baselineLocalDate, toLocalDate: observation.localDate,
    rawBefore: state.lastRaw, rawAfter: observation.stepsRaw,
    source: observation.source, deviceObservedAt: observation.deviceObservedAt || null,
    timeBasis: 'gateway_receipt_interval', segment: state.segment,
    acceptedSteps: 0, unallocatedSteps: 0, reason: 'baseline_started',
    expiresAt: new Date(+at + INTERVAL_RETENTION_MS),
  };
  const elapsed = +at - +date(state.baselineAt);
  const allowance = Math.max(500, Math.ceil(Math.max(1, elapsed / 60_000) *
    (options.maxStepsPerMinute || 300)));
  const delta = observation.stepsRaw - state.lastRaw;
  let advanceBaseline = true;
  if (!prior) {
    addReason(day, previousState ? 'baseline_restarted' : 'monitoring_started');
  } else if (state.pendingDiscontinuity) {
    const pending = state.pendingDiscontinuity;
    const candidateDelta = observation.stepsRaw - pending.raw;
    const candidateAllowance = Math.max(500, Math.ceil(Math.max(1,
      (+at - +date(pending.at)) / 60_000) * (options.maxStepsPerMinute || 300)));
    const confirmsReset = pending.kind === 'reset' && observation.stepsRaw < state.lastRaw &&
      candidateDelta >= 0 && candidateDelta <= candidateAllowance;
    const confirmsJump = pending.kind === 'jump' && observation.stepsRaw >= pending.raw &&
      candidateDelta >= 0 && candidateDelta <= candidateAllowance;
    if (confirmsReset || confirmsJump) {
      interval.reason = confirmsReset ? 'reset_baseline_confirmed' : 'jump_baseline_confirmed';
      state.segment += 1;
      state.pendingDiscontinuity = null;
      if (confirmsReset) day.confirmedResetCount += 1;
      // Even the confirming value is a new baseline, not an inferred reset total.
      addReason(day, 'counter_discontinuity');
    } else if (delta >= 0 && delta <= allowance) {
      // A stale low/high value followed by the original range must not create
      // a reset-and-rebound increase. Rebaseline without crediting this interval.
      interval.reason = 'discontinuity_rebounded';
      state.pendingDiscontinuity = null;
      addReason(day, 'counter_discontinuity');
    } else {
      interval.reason = 'awaiting_stable_counter';
      state.pendingDiscontinuity = { kind: delta < 0 ? 'reset' : 'jump',
        raw: observation.stepsRaw, at };
      advanceBaseline = false;
      addReason(day, 'counter_discontinuity');
    }
  } else if (delta < 0 || delta > allowance) {
    const kind = delta < 0 ? 'reset' : 'jump';
    interval.reason = kind === 'reset' ? 'counter_decreased' : 'implausible_increase';
    state.pendingDiscontinuity = { kind, raw: observation.stepsRaw, at };
    if (kind === 'reset') day.resetCount += 1;
    else day.anomalyCount += 1;
    advanceBaseline = false;
    addReason(day, 'counter_discontinuity');
  } else if (elapsed > MAX_INTERVAL_MS) {
    interval.reason = 'observation_gap';
    interval.unallocatedSteps = delta;
    day.gapCount += 1;
    addReason(day, 'observation_gap');
  } else if (state.baselineLocalDate !== observation.localDate && delta > 0) {
    interval.reason = 'cross_midnight_unallocated';
    interval.unallocatedSteps = delta;
    addReason(day, 'cross_midnight_unallocated');
  } else {
    interval.reason = delta === 0 ? 'unchanged' : 'observed_increase';
    interval.acceptedSteps = delta;
  }
  const wear = wearAt(observation.wearEvidence, at);
  const sameWearingPeriod = wear.eligible && prior?.baselineWearId === wear.continuityId;
  interval.wearQualifiedSteps = sameWearingPeriod ? interval.acceptedSteps : 0;
  interval.wearReason = sameWearingPeriod ? 'continuous_wearing_evidence' : wear.reason;
  // Existing diagnostic totals are never backfilled as wearer-qualified steps.
  day.wearQualityVersion = 1;
  day.wearQualifiedSteps = (day.wearQualifiedSteps || 0) + interval.wearQualifiedSteps;
  day.wearExcludedSteps = day.recordedSteps + interval.acceptedSteps - day.wearQualifiedSteps;
  day.wearReason = interval.wearReason;
  if (sameWearingPeriod && ['observed_increase', 'unchanged'].includes(interval.reason)) {
    day.lastWearQualifiedAt = at;
  }
  if (!sameWearingPeriod) addReason(day, 'wearing_not_confirmed_for_interval');
  if (advanceBaseline) {
    state.baselineWearId = wear.eligible ? wear.continuityId : null;
    state.lastRaw = observation.stepsRaw;
    state.baselineAt = at;
    state.baselineLocalDate = observation.localDate;
  }
  state.latestRaw = observation.stepsRaw;
  state.lastObservedAt = at;
  if (observation.deviceObservedAt) state.lastDeviceObservedAt = observation.deviceObservedAt;
  state.lastSource = observation.source;
  state.counterMode = options.counterMode || 'unverified';
  state.lastIntervalReason = interval.reason;
  day.recordedSteps += interval.acceptedSteps;
  day.observedDeltaSteps = day.recordedSteps;
  day.unallocatedSteps += interval.unallocatedSteps;
  day.lastRaw = observation.stepsRaw;
  day.lastObservedAt = at;
  day.lastIntervalReason = interval.reason;
  day.sampleCount += 1;
  day.counterMode = state.counterMode;
  // Coverage stays explicitly partial: no evidence claims a complete day or
  // that a silent interval proves inactivity. Customer activation is separate.
  day.quality = day.counterMode === 'observed_delta' ? 'partial' : 'unverified';
  day.displayable = day.counterMode === 'observed_delta' &&
    options.customerEnabled === true && day.anomalyCount === 0;
  // Recorded deltas are estimates. They are intentionally not replaced by
  // wear-qualified totals because the watch cannot prove wrist contact.
  day.reportedSteps = day.displayable ? day.recordedSteps : null;
  return { status: 'stored', state, day, interval };
}

async function ingestCounterLedger(db, observation, options = {}) {
  const device = db.collection('devices').doc(observation.imei);
  const stateRef = device.collection('activityState').doc('counter');
  const dayRef = device.collection('activityDays').doc(observation.localDate);
  // Reads and all accounting writes share one transaction, including across
  // processes. A failed commit consumes neither the baseline nor its interval.
  return db.runTransaction(async transaction => {
    const stateSnap = await transaction.get(stateRef);
    const daySnap = await transaction.get(dayRef);
    const previousState = stateSnap.exists ? stateSnap.data() : null;
    const previousDay = daySnap.exists ? daySnap.data() : null;
    const result = reduceCounterLedger(previousState, previousDay, observation, options);
    if (result.status === 'ignored_stale') return { status: result.status, day: previousDay };
    const sameDay = previousDay?.schemaVersion === VERSION && previousState?.timeZone === observation.timeZone;
    const unchanged = result.interval.reason === 'unchanged' && sameDay &&
      previousDay.counterMode === result.day.counterMode && previousDay.displayable === result.day.displayable &&
      previousState.baselineWearId === result.state.baselineWearId &&
      previousDay.wearQualityVersion === result.day.wearQualityVersion;
    if (unchanged && +observation.receivedAt - +date(previousState.lastObservedAt) < options.writeIntervalMs) {
      return { status: 'deduplicated', day: previousDay };
    }
    result.day.updatedAt = observation.receivedAt;
    result.day.expiresAt = new Date(+observation.receivedAt + options.retentionDays * 86_400_000);
    // No per-heartbeat history. Keep bounded intervals for changes, midnight,
    // rebaselines and gaps; aggregate retained totals remain on activityDays.
    if (!unchanged || previousState.baselineLocalDate !== observation.localDate) {
      result.state.intervalSequence = (previousState?.intervalSequence || 0) + 1;
      const id = String(result.state.intervalSequence % MAX_RECENT_INTERVALS).padStart(3, '0');
      transaction.set(device.collection('activityIntervals').doc(id), result.interval);
    }
    transaction.set(stateRef, result.state);
    transaction.set(dayRef, result.day);
    return { status: 'stored', day: result.day };
  });
}

async function deleteExpiredActivityIntervals(db, now, limit = 200) {
  const snapshot = await db.collectionGroup('activityIntervals').where('expiresAt', '<=', now).limit(limit).get();
  if (!snapshot.docs.length) return 0;
  const batch = db.batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();
  return snapshot.docs.length;
}

module.exports = { reduceCounterLedger, ingestCounterLedger, deleteExpiredActivityIntervals };
