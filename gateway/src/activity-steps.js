'use strict';
const { cleanupWellnessRecords } = require('./wellness-retention');
const { ingestCounterLedger, deleteExpiredActivityIntervals } = require('./activity-counter-ledger');

const DEFAULT_TIME_ZONE = 'Indian/Mauritius';
const COUNTER_MODE_UNVERIFIED = 'unverified';
const COUNTER_MODE_DAILY_RESET = 'daily_reset';
const COUNTER_MODE_OBSERVED_DELTA = 'observed_delta';
const MAX_RAW_STEPS = 10_000_000;

function finiteAtLeast(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDateKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = validDate(value);
  if (!date) throw new TypeError('A valid observation time is required');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeActivityObservation(event = {}, options = {}) {
  const receivedAt = validDate(options.receivedAt || event.receivedAt || new Date());
  const timeZone = String(options.timeZone || DEFAULT_TIME_ZONE).trim();
  const imei = String(event.imei || '').trim();
  const stepsRaw = event.stepsRaw;
  const deviceTime = event.location?.recordedAt;
  const deviceObservedAt = deviceTime == null ? null : asTimestamp(deviceTime);

  if (!imei) return null;
  if (!receivedAt || !timeZone) return null;
  // Timestamped old uploads must not be folded into today's activity, even
  // when this store is invoked independently of journey ingress.
  if (deviceTime != null && (!deviceObservedAt ||
      receivedAt - deviceObservedAt > 120_000 || deviceObservedAt - receivedAt > 30_000)) return null;
  if (!Number.isInteger(stepsRaw) || stepsRaw < 0 || stepsRaw > MAX_RAW_STEPS) {
    return null;
  }

  return Object.freeze({
    imei,
    stepsRaw,
    receivedAt,
    localDate: localDateKey(receivedAt, timeZone),
    timeZone,
    deviceObservedAt,
    source: String(event.source || event.command || event.type || 'v52_counter').toLowerCase(),
  });
}

function asTimestamp(value) {
  if (!value) return null;
  const date = value?.toDate?.() || validDate(value);
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function startingDay(observation, counterMode) {
  const displayable = counterMode === COUNTER_MODE_DAILY_RESET;
  return {
    schemaVersion: 1,
    imei: observation.imei,
    localDate: observation.localDate,
    timeZone: observation.timeZone,
    source: 'v52_counter',
    counterMode,
    displayable,
    reportedSteps: displayable ? observation.stepsRaw : null,
    observedDeltaSteps: 0,
    firstRaw: observation.stepsRaw,
    lastRaw: observation.stepsRaw,
    firstObservedAt: observation.receivedAt,
    lastObservedAt: observation.receivedAt,
    sampleCount: 1,
    resetCount: 0,
    anomalyCount: 0,
    quality: displayable ? 'partial' : 'unverified',
  };
}

function reduceActivityDay(previous, observation, options = {}) {
  const counterMode = options.counterMode === COUNTER_MODE_DAILY_RESET
    ? COUNTER_MODE_DAILY_RESET
    : COUNTER_MODE_UNVERIFIED;
  const maxStepsPerMinute = finiteAtLeast(options.maxStepsPerMinute, 300, 30);
  const minimumJumpAllowance = finiteAtLeast(
    options.minimumJumpAllowance,
    500,
    100,
  );

  if (!previous || previous.localDate !== observation.localDate) {
    return startingDay(observation, counterMode);
  }

  const lastRaw = Number(previous.lastRaw);
  const lastObservedAt = asTimestamp(previous.lastObservedAt);
  if (!Number.isInteger(lastRaw) || lastRaw < 0 || !lastObservedAt) {
    return startingDay(observation, counterMode);
  }

  const next = {
    ...previous,
    schemaVersion: 1,
    imei: observation.imei,
    localDate: observation.localDate,
    timeZone: observation.timeZone,
    source: 'v52_counter',
    counterMode,
    displayable:
      counterMode === COUNTER_MODE_DAILY_RESET &&
      Number(previous.anomalyCount || 0) === 0,
    lastRaw: observation.stepsRaw,
    lastObservedAt: observation.receivedAt,
    sampleCount: Number(previous.sampleCount || 0) + 1,
    resetCount: Number(previous.resetCount || 0),
    anomalyCount: Number(previous.anomalyCount || 0),
    observedDeltaSteps: Number(previous.observedDeltaSteps || 0),
    reportedSteps:
      counterMode === COUNTER_MODE_DAILY_RESET &&
      Number.isInteger(previous.reportedSteps)
        ? previous.reportedSteps
        : null,
  };

  const delta = observation.stepsRaw - lastRaw;
  if (delta === 0) {
    next.quality = next.anomalyCount > 0
      ? 'anomalous'
      : next.displayable
        ? previous.quality || 'partial'
        : 'unverified';
    return next;
  }

  const elapsedMinutes = Math.max(
    1,
    (observation.receivedAt.getTime() - lastObservedAt.getTime()) / 60_000,
  );
  const allowance = Math.max(
    minimumJumpAllowance,
    Math.ceil(elapsedMinutes * maxStepsPerMinute),
  );

  const increment = delta > 0 ? delta : observation.stepsRaw;
  const suspiciousReset = delta < 0 && observation.stepsRaw > minimumJumpAllowance;
  if (increment > allowance || suspiciousReset) {
    next.anomalyCount += 1;
    next.displayable = false;
    next.reportedSteps = null;
    next.quality = 'anomalous';
    return next;
  }

  if (delta < 0) next.resetCount += 1;
  next.observedDeltaSteps += increment;
  if (counterMode === COUNTER_MODE_DAILY_RESET && next.displayable) {
    const priorTotal = Number(previous.reportedSteps);
    next.reportedSteps = Number.isInteger(priorTotal)
      ? priorTotal + increment
      : observation.stepsRaw;
    next.quality = next.resetCount > 0 ? 'reset_recovered' : 'partial';
  } else {
    next.reportedSteps = null;
    next.quality = next.anomalyCount > 0 ? 'anomalous' : 'unverified';
  }
  return next;
}

class ActivityStepsStore {
  constructor(db, options = {}) {
    this.db = db;
    this.enabled = options.enabled === true;
    this.customerEnabled = options.customerEnabled === true;
    this.timeZone = String(options.timeZone || DEFAULT_TIME_ZONE);
    this.counterMode = [COUNTER_MODE_DAILY_RESET, COUNTER_MODE_OBSERVED_DELTA].includes(options.counterMode)
      ? options.counterMode
      : COUNTER_MODE_UNVERIFIED;
    this.retentionDays = finiteAtLeast(options.retentionDays, 90, 7);
    this.writeIntervalMs = finiteAtLeast(
      options.writeIntervalMinutes,
      15,
      1,
    ) * 60_000;
    this.maxStepsPerMinute = finiteAtLeast(options.maxStepsPerMinute, 300, 30);
    this.states = new Map();
    this.pending = new Map();
  }

  async loadState(observation) {
    const key = `${observation.imei}:${observation.localDate}`;
    if (this.states.has(key)) return this.states.get(key);
    let day = null;
    if (this.db) {
      const snap = await this.db
        .collection('devices')
        .doc(observation.imei)
        .collection('activityDays')
        .doc(observation.localDate)
        .get();
      if (snap.exists) day = snap.data() || null;
    }
    const state = { day, lastPersistedAt: asTimestamp(day?.updatedAt) };
    this.states.set(key, state);
    return state;
  }

  async ingest(event, receivedAt = new Date()) {
    if (!this.enabled) return { status: 'disabled' };
    if (!this.db) return { status: 'firestore_unavailable' };
    const observation = normalizeActivityObservation(event, {
      receivedAt,
      timeZone: this.timeZone,
    });
    if (!observation) return { status: 'ignored_invalid' };

    // Heartbeats and positions can arrive while an earlier write is pending.
    // Preserve receipt order per watch, without blocking the live dispatcher.
    const prior = this.pending.get(observation.imei) || Promise.resolve();
    const task = prior.catch(() => {}).then(() => this.ingestObservation(observation));
    this.pending.set(observation.imei, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(observation.imei) === task) this.pending.delete(observation.imei);
    }
  }

  async ingestObservation(observation) {
    if (this.counterMode !== COUNTER_MODE_DAILY_RESET) {
      return ingestCounterLedger(this.db, observation, this);
    }
    const state = await this.loadState(observation);
    const previous = state.day;
    const previousObservedAt = asTimestamp(previous?.lastObservedAt);
    if (
      previousObservedAt &&
      observation.receivedAt.getTime() <= previousObservedAt.getTime()
    ) {
      return { status: 'ignored_stale', day: previous };
    }
    const day = reduceActivityDay(previous, observation, {
      counterMode: this.counterMode,
      maxStepsPerMinute: this.maxStepsPerMinute,
    });
    const rawChanged = !previous || previous.lastRaw !== day.lastRaw;
    const resetChanged = Number(previous?.resetCount || 0) !== day.resetCount;
    const anomalyChanged = Number(previous?.anomalyCount || 0) !== day.anomalyCount;
    const intervalDue = !state.lastPersistedAt ||
      observation.receivedAt.getTime() - state.lastPersistedAt.getTime() >= this.writeIntervalMs;
    if (!rawChanged && !resetChanged && !anomalyChanged && !intervalDue) {
      state.day = day;
      return { status: 'deduplicated', day };
    }

    const expiresAt = new Date(
      observation.receivedAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const stored = { ...day, displayable: day.displayable && this.customerEnabled, expiresAt, updatedAt: observation.receivedAt };
    const deviceRef = this.db.collection('devices').doc(observation.imei);
    const dayRef = deviceRef.collection('activityDays').doc(observation.localDate);
    const batch = this.db.batch();
    batch.set(dayRef, stored, { merge: true });
    await batch.commit();
    state.day = stored;
    state.lastPersistedAt = observation.receivedAt;
    return { status: 'stored', day: stored };
  }
}

async function deleteExpiredActivityDays(db, options = {}) {
  if (!db?.collectionGroup) return 0;
  const now = validDate(options.now || new Date());
  if (!now) return 0;
  const limit = Math.floor(Math.min(500, finiteAtLeast(options.limit, 200, 1)));
  const snap = await db
    .collectionGroup('activityDays')
    .where('expiresAt', '<=', now)
    .limit(limit)
    .get();
  const daysDeleted = snap.docs.length ? (await cleanupWellnessRecords(db, snap.docs, { now })).deleted : 0;
  return daysDeleted + await deleteExpiredActivityIntervals(db, now, limit);
}

module.exports = {
  DEFAULT_TIME_ZONE,
  COUNTER_MODE_UNVERIFIED,
  COUNTER_MODE_DAILY_RESET,
  COUNTER_MODE_OBSERVED_DELTA,
  MAX_RAW_STEPS,
  localDateKey,
  normalizeActivityObservation,
  reduceActivityDay,
  ActivityStepsStore,
  deleteExpiredActivityDays,
};
