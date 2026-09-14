'use strict';

function iso(value) {
  if (value == null) return null;
  const result = value?.toDate?.() || new Date(value);
  return Number.isFinite(+result) ? result.toISOString() : null;
}

function summarizeActivityDay(day) {
  return {
    localDate: day.localDate, schemaVersion: day.schemaVersion ?? 1,
    lastRaw: day.lastRaw ?? null,
    recordedSteps: day.schemaVersion === 2 ? day.recordedSteps ?? null : null,
    wearQualifiedSteps: day.wearQualifiedSteps ?? null,
    wearExcludedSteps: day.wearExcludedSteps ?? null, wearReason: day.wearReason || null,
    lastWearQualifiedAt: iso(day.lastWearQualifiedAt),
    observedDeltaSteps: day.observedDeltaSteps ?? null,
    reportedSteps: day.displayable === true ? day.reportedSteps ?? null : null,
    displayable: day.displayable === true, quality: day.quality || 'unverified',
    coverage: day.coverage || 'unverified', coverageReasons: day.coverageReasons || [],
    unallocatedSteps: day.unallocatedSteps ?? 0, gapCount: day.gapCount ?? 0,
    resetCount: day.resetCount ?? 0, confirmedResetCount: day.confirmedResetCount ?? 0,
    anomalyCount: day.anomalyCount ?? 0, lastIntervalReason: day.lastIntervalReason || null,
    firstObservedAt: iso(day.firstObservedAt), lastObservedAt: iso(day.lastObservedAt),
  };
}

function summarizeActivityState(state) {
  if (!state) return null;
  return {
    schemaVersion: state.schemaVersion ?? null, timeZone: state.timeZone || null,
    counterMode: state.counterMode || null, latestRaw: state.latestRaw ?? null,
    baselineRaw: state.lastRaw ?? null, baselineAt: iso(state.baselineAt),
    lastObservedAt: iso(state.lastObservedAt), lastDeviceObservedAt: iso(state.lastDeviceObservedAt),
    segment: state.segment ?? null, lastIntervalReason: state.lastIntervalReason || null,
    pendingDiscontinuity: state.pendingDiscontinuity ? {
      kind: state.pendingDiscontinuity.kind, raw: state.pendingDiscontinuity.raw,
      at: iso(state.pendingDiscontinuity.at),
    } : null,
  };
}

function summarizeActivityInterval(interval) {
  return {
    from: iso(interval.from), to: iso(interval.to),
    fromLocalDate: interval.fromLocalDate, toLocalDate: interval.toLocalDate,
    rawBefore: interval.rawBefore, rawAfter: interval.rawAfter,
    acceptedSteps: interval.acceptedSteps, unallocatedSteps: interval.unallocatedSteps,
    wearQualifiedSteps: interval.wearQualifiedSteps ?? null, wearReason: interval.wearReason || null,
    reason: interval.reason, timeBasis: interval.timeBasis,
  };
}

module.exports = { summarizeActivityDay, summarizeActivityState, summarizeActivityInterval };
