const FRESH_BATTERY_MS = 10 * 60 * 1000;
const RECENT_BATTERY_MS = 30 * 60 * 1000;
const ONLINE_HEARTBEAT_MS = 15 * 60 * 1000;

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function ageMs(value, now) {
  const date = asDate(value);
  if (!date) return null;
  return Math.max(0, now.getTime() - date.getTime());
}

function batteryFreshness(device, { now = new Date() } = {}) {
  const readingAt =
    asDate(device?.batteryUpdatedAt) ||
    asDate(device?.lastHeartbeatAt) ||
    asDate(device?.updatedAt);
  const heartbeatAt = asDate(device?.lastHeartbeatAt);
  const readingAgeMs = ageMs(readingAt, now);
  const heartbeatAgeMs = ageMs(heartbeatAt, now);

  let freshness = 'unknown';
  if (readingAgeMs != null && readingAgeMs <= FRESH_BATTERY_MS) freshness = 'fresh';
  else if (readingAgeMs != null && readingAgeMs <= RECENT_BATTERY_MS) freshness = 'recent';
  else if (readingAgeMs != null) freshness = 'stale';

  return {
    readingAt: readingAt?.toISOString() || null,
    ageSeconds: readingAgeMs == null ? null : Math.floor(readingAgeMs / 1000),
    ageMinutes: readingAgeMs == null ? null : Math.floor(readingAgeMs / 60000),
    freshness,
    stale: freshness === 'stale' || freshness === 'unknown',
    online: heartbeatAgeMs != null && heartbeatAgeMs <= ONLINE_HEARTBEAT_MS,
  };
}

function formatAge(ageSeconds) {
  if (ageSeconds == null) return null;
  if (ageSeconds < 60) return 'less than a minute ago';
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatBatteryReply(result) {
  const name = String(result?.name || 'Your loved one').trim();
  const percentage = result?.batteryPercent == null ? null : Number(result.batteryPercent);
  if (percentage == null || !Number.isFinite(percentage)) {
    return `I don't have a battery reading for ${name}'s watch yet.`;
  }

  const age = formatAge(result?.ageSeconds);
  let reply = `${name}'s watch last reported ${Math.round(percentage)}% battery`;
  reply += age ? ` ${age}.` : '.';

  if (result?.stale) {
    reply += result?.online
      ? ' This reading may be stale.'
      : ' The watch is currently offline, so this may have changed.';
  }

  return reply;
}

module.exports = {
  FRESH_BATTERY_MS,
  RECENT_BATTERY_MS,
  ONLINE_HEARTBEAT_MS,
  batteryFreshness,
  formatAge,
  formatBatteryReply,
};
