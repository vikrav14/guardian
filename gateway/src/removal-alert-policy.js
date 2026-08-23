'use strict';

const MODE_UNVERIFIED = 'unverified';
const MODE_ACCEPTED = 'accepted';
const STATE_UNKNOWN = 'unknown';
const STATE_WORN = 'worn';
const STATE_REMOVED = 'removed';

function asDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date?.getTime?.()) ? date : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function validClock(value) {
  const text = String(value || '').trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function normalizeRemovalSettings(value = {}) {
  return Object.freeze({
    enabled: value.enabled === true,
    debounceSeconds: boundedInteger(value.debounceSeconds, 60, 30, 600),
    restoreDebounceSeconds: boundedInteger(
      value.restoreDebounceSeconds,
      60,
      30,
      600,
    ),
    quietStart: validClock(value.quietStart),
    quietEnd: validClock(value.quietEnd),
    timeZone: 'Indian/Mauritius',
  });
}

function localMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return value('hour') * 60 + value('minute');
}

function clockMinutes(clock) {
  if (!clock) return null;
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

function isQuietAt(date, settings) {
  const start = clockMinutes(settings.quietStart);
  const end = clockMinutes(settings.quietEnd);
  if (start == null || end == null || start === end) return false;
  const current = localMinutes(date, settings.timeZone);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function normalizeRemovalObservation(event = {}, now = new Date()) {
  if (typeof event.braceletRemoved !== 'boolean') return null;
  const observedAt = asDate(event.observedAt || event.receivedAt || now);
  if (!observedAt) return null;
  return Object.freeze({
    imei: String(event.imei || '').trim(),
    removed: event.braceletRemoved,
    observedAt,
    source: String(event.source || event.command || 'v52_tracker_state')
      .trim()
      .toLowerCase(),
    trackerState: event.trackerState || event.alarmCode || null,
  });
}

function initialRemovalState(observation, settings, mode) {
  const state = observation.removed ? STATE_UNKNOWN : STATE_WORN;
  return {
    schemaVersion: 1,
    state,
    candidateState: observation.removed ? STATE_REMOVED : null,
    candidateSince: observation.removed ? observation.observedAt : null,
    lastObservedAt: observation.observedAt,
    lastSource: observation.source,
    lastTrackerState: observation.trackerState,
    observationCount: 1,
    transitionCount: 0,
    duplicateCount: 0,
    mode,
    displayable: mode === MODE_ACCEPTED,
    settings,
  };
}

function reduceRemovalState(previous, observation, rawSettings = {}, options = {}) {
  const settings = normalizeRemovalSettings(rawSettings);
  const mode = options.mode === MODE_ACCEPTED ? MODE_ACCEPTED : MODE_UNVERIFIED;
  if (!previous) {
    return { state: initialRemovalState(observation, settings, mode), transition: null };
  }

  const lastObservedAt = asDate(previous.lastObservedAt);
  if (lastObservedAt && observation.observedAt <= lastObservedAt) {
    return { state: previous, transition: null, ignored: 'stale' };
  }

  const target = observation.removed ? STATE_REMOVED : STATE_WORN;
  const current = [STATE_WORN, STATE_REMOVED].includes(previous.state)
    ? previous.state
    : STATE_UNKNOWN;
  const next = {
    ...previous,
    schemaVersion: 1,
    mode,
    displayable: mode === MODE_ACCEPTED,
    settings,
    lastObservedAt: observation.observedAt,
    lastSource: observation.source,
    lastTrackerState: observation.trackerState,
    observationCount: Number(previous.observationCount || 0) + 1,
    transitionCount: Number(previous.transitionCount || 0),
    duplicateCount: Number(previous.duplicateCount || 0),
  };

  if (target === current) {
    next.candidateState = null;
    next.candidateSince = null;
    next.duplicateCount += 1;
    return { state: next, transition: null };
  }

  const candidateSince = asDate(previous.candidateSince);
  if (previous.candidateState !== target || !candidateSince) {
    next.candidateState = target;
    next.candidateSince = observation.observedAt;
    return { state: next, transition: null };
  }

  const requiredSeconds = target === STATE_REMOVED
    ? settings.debounceSeconds
    : settings.restoreDebounceSeconds;
  const elapsedSeconds =
    (observation.observedAt.getTime() - candidateSince.getTime()) / 1000;
  if (elapsedSeconds < requiredSeconds) return { state: next, transition: null };

  next.state = target;
  next.stateChangedAt = observation.observedAt;
  next.candidateState = null;
  next.candidateSince = null;
  next.transitionCount += 1;
  const quiet = isQuietAt(observation.observedAt, settings);
  return {
    state: next,
    transition: Object.freeze({
      type: target === STATE_REMOVED ? 'watch_removed' : 'watch_restored',
      at: observation.observedAt,
      quiet,
      notify: target === STATE_REMOVED && settings.enabled && !quiet &&
        mode === MODE_ACCEPTED && options.customerEnabled === true,
    }),
  };
}

module.exports = {
  MODE_UNVERIFIED,
  MODE_ACCEPTED,
  STATE_UNKNOWN,
  STATE_WORN,
  STATE_REMOVED,
  normalizeRemovalSettings,
  normalizeRemovalObservation,
  isQuietAt,
  reduceRemovalState,
};
