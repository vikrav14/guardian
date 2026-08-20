const SOS_FRESH_LOCATION_MAX_SECONDS = 10 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 2 * 60;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasTrustworthyCoordinates(location = {}) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;

  // Never turn null-island / uninitialised coordinates into an SOS map.
  if (lat === 0 && lng === 0) return false;

  return true;
}

function classifySosLocation({
  device = {},
  now = new Date(),
  freshMaxSeconds = SOS_FRESH_LOCATION_MAX_SECONDS,
} = {}) {
  const location = device.location || {};

  if (!hasTrustworthyCoordinates(location)) {
    return {
      state: 'unavailable',
      reason: 'no_trustworthy_coordinates',
      ageSeconds: null,
      recordedAt: null,
    };
  }

  const recordedAt = toDate(location.recordedAt);
  if (!recordedAt) {
    return {
      state: 'last_known',
      reason: 'timestamp_missing',
      ageSeconds: null,
      recordedAt: null,
    };
  }

  const nowDate = toDate(now) || new Date();
  const rawAgeSeconds = Math.round(
    (nowDate.getTime() - recordedAt.getTime()) / 1000
  );

  // A materially future timestamp cannot be treated as a fresh current fix.
  if (rawAgeSeconds < -MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    return {
      state: 'last_known',
      reason: 'timestamp_future_skew',
      ageSeconds: null,
      recordedAt,
    };
  }

  const ageSeconds = Math.max(0, rawAgeSeconds);
  if (ageSeconds <= Math.max(0, Number(freshMaxSeconds) || 0)) {
    return {
      state: 'fresh',
      reason: 'recent_trustworthy_fix',
      ageSeconds,
      recordedAt,
    };
  }

  return {
    state: 'last_known',
    reason: 'trustworthy_but_stale',
    ageSeconds,
    recordedAt,
  };
}

function formatLocationAge(ageSeconds) {
  if (ageSeconds == null || !Number.isFinite(Number(ageSeconds))) {
    return 'time unavailable';
  }

  const seconds = Math.max(0, Math.round(Number(ageSeconds)));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes
      ? `${hours}h ${remMinutes}m ago`
      : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours
    ? `${days}d ${remHours}h ago`
    : `${days}d ago`;
}

module.exports = {
  SOS_FRESH_LOCATION_MAX_SECONDS,
  MAX_FUTURE_CLOCK_SKEW_SECONDS,
  toDate,
  hasTrustworthyCoordinates,
  classifySosLocation,
  formatLocationAge,
};
