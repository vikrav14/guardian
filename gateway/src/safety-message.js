const DEFAULT_TIME_ZONE = 'Indian/Mauritius';
const ONLINE_HEARTBEAT_MS = 15 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function wearerName(device = {}) {
  for (const raw of [device.nickname, device.relationship, device.name]) {
    if (!raw || !String(raw).trim()) continue;
    const cleaned = String(raw)
      .trim()
      .replace(/(?:'s)?\s+(?:watch|pendant|device)$/i, '')
      .trim();
    if (cleaned && !cleaned.toLowerCase().startsWith('device ')) return cleaned;
  }
  return 'Loved one';
}

function positioningDescription(source) {
  switch (String(source || '').trim().toLowerCase()) {
    case 'gps':
      return { label: 'Satellite GPS', approximate: false };
    case 'wifi':
      return { label: 'Approximate location (WiFi positioning)', approximate: true };
    case 'lbs':
      return { label: 'Approximate location (cell tower positioning)', approximate: true };
    default:
      return { label: null, approximate: false };
  }
}

function formatAge(value, now = new Date()) {
  const d = toDate(value);
  const n = toDate(now) || new Date();
  if (!d) return null;
  const seconds = Math.max(0, Math.round((n.getTime() - d.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatEventTime(value, timeZone = DEFAULT_TIME_ZONE) {
  const d = toDate(value);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return null;
  }
}

function hasCoordinates(location = {}) {
  return Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng));
}

function mapsUrl(location = {}) {
  if (!hasCoordinates(location)) return null;
  return `https://maps.google.com/?q=${Number(location.lat)},${Number(location.lng)}`;
}

function isOnline(device = {}, now = new Date()) {
  if (device.online !== true) return false;
  const heartbeat = toDate(device.lastHeartbeatAt) || toDate(device.updatedAt);
  if (!heartbeat) return false;
  const n = toDate(now) || new Date();
  return n.getTime() - heartbeat.getTime() <= ONLINE_HEARTBEAT_MS;
}

function clampBattery(value) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function buildSafetyContext({ device = {}, alert = {}, now = new Date() } = {}) {
  const location = device.location || {};
  const source = positioningDescription(device.accuracySource);
  const freshAge = formatAge(location.recordedAt, now);
  const url = mapsUrl(location);
  const placeLabel = String(location.placeLabel || '').trim() || null;
  const eventTime = formatEventTime(
    alert.eventAt || alert.triggeredAt || alert.createdAt,
    alert.timeZone || DEFAULT_TIME_ZONE
  );

  return {
    wearerName: wearerName(device),
    eventTime,
    placeLabel,
    hasLocation: Boolean(url),
    mapsUrl: url,
    locationFreshness: freshAge,
    positioningLabel: source.label,
    approximate: source.approximate,
    online: isOnline(device, now),
    batteryPercent: clampBattery(device.batteryPercent),
  };
}

function buildLocationLines(ctx) {
  if (!ctx.hasLocation) return ['📍 Location unavailable'];

  const lines = [];
  if (ctx.placeLabel) {
    lines.push(`📍 ${ctx.approximate ? 'Approximate location near ' : ''}${ctx.placeLabel}`);
  } else {
    lines.push(`📍 ${ctx.approximate ? 'Approximate location available' : 'Location available'}`);
  }

  const detail = [ctx.positioningLabel, ctx.locationFreshness ? `Updated ${ctx.locationFreshness}` : null]
    .filter(Boolean)
    .join(' · ');
  if (detail) lines.push(detail);
  return lines;
}

function buildSafetyMessage({ type, device = {}, alert = {}, now = new Date() } = {}) {
  const normalizedType = String(type || alert.type || '').trim().toLowerCase();
  const ctx = buildSafetyContext({ device, alert, now });
  const isFall = normalizedType === 'fall';
  const title = isFall
    ? `⚠️ GUARDIAN FALL ALERT — ${ctx.wearerName}`
    : `🚨 GUARDIAN SOS — ${ctx.wearerName}`;
  const eventLabel = isFall ? 'Fall alert received' : 'SOS alert received';
  const eventLine = `${eventLabel}${ctx.eventTime ? ` at ${ctx.eventTime}` : ''}.`;

  const lines = [title, '', eventLine, '', ...buildLocationLines(ctx)];
  const statusParts = [`Watch ${ctx.online ? 'online' : 'offline'}`];
  if (ctx.batteryPercent != null) statusParts.push(`Battery ${ctx.batteryPercent}%`);
  lines.push(statusParts.join(' · '));

  if (ctx.mapsUrl) lines.push('', 'Open location:', ctx.mapsUrl);
  else lines.push('', 'Location link unavailable.');

  return lines.join('\n');
}

module.exports = {
  DEFAULT_TIME_ZONE,
  ONLINE_HEARTBEAT_MS,
  toDate,
  wearerName,
  positioningDescription,
  formatAge,
  formatEventTime,
  hasCoordinates,
  mapsUrl,
  isOnline,
  clampBattery,
  buildSafetyContext,
  buildSafetyMessage,
};
