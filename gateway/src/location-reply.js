'use strict';

const { buildSosLocationSnapshot } = require('./sos-location-snapshot');
const { toDate } = require('./sos-location-policy');
const { batteryFreshness, formatAge } = require('./battery-freshness');

function recordedDate(value, now) {
  try {
    const date = toDate(value);
    return date && date.getTime() <= now.getTime() ? date : null;
  } catch {
    return null;
  }
}

function ageSeconds(date, now) {
  return date ? Math.floor((now.getTime() - date.getTime()) / 1000) : null;
}

/**
 * Reuse the validated, read-only map/SOS selection contract. This does not
 * create an SOS or write a snapshot. An approximate observation never replaces
 * retained GPS just because 30 minutes passed; its evidence stays separate.
 */
function buildLocationReplyData(device = {}, { now = new Date() } = {}) {
  const selection = buildSosLocationSnapshot(device, { now });
  const clock = selection.capturedAt;
  const loc = selection.location;
  const latest = selection.latestObservation;
  const heartbeatAt = recordedDate(device.lastHeartbeatAt, clock);
  const updatedAt = recordedDate(device.updatedAt, clock);
  const battery = batteryFreshness({
    ...device,
    lastHeartbeatAt: heartbeatAt,
    updatedAt,
    batteryUpdatedAt: recordedDate(device.batteryUpdatedAt, clock),
  }, { now: clock });
  const percentage = device.batteryPercent == null ? null : Number(device.batteryPercent);

  return {
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    placeLabel: loc?.placeLabel || null,
    accuracySource: loc?.source || null,
    accuracyMeters: loc?.accuracyMeters ?? null,
    recordedAt: loc?.recordedAt?.toISOString() || null,
    ageSeconds: selection.ageSeconds,
    stalenessSeconds: selection.ageSeconds,
    locationState: selection.state,
    retainedSatellite: selection.retainedSatellite,
    latestObservationSource: latest?.source || null,
    latestObservationAt: latest?.recordedAt?.toISOString() || null,
    latestObservationAgeSeconds: ageSeconds(latest?.recordedAt, clock),
    latestObservationAccuracyMeters: latest?.accuracyMeters ?? null,
    latestObservationIsNewer: Boolean(latest?.recordedAt && loc?.recordedAt &&
      latest.recordedAt.getTime() > loc.recordedAt.getTime()),
    locationDisclosure: !loc
      ? 'No usable recorded location is available.'
      : selection.retainedSatellite
        ? 'Showing the last satellite fix. Current position unconfirmed.'
        : loc.source === 'wifi' || loc.source === 'lbs'
          ? 'This is an approximate network location. Current position unconfirmed.'
          : loc.source !== 'gps'
            ? 'Positioning source unconfirmed. Current position unconfirmed.'
            : selection.state === 'last_known'
              ? 'This is the last known satellite GPS fix. Current position unconfirmed.'
              : 'This is the latest recorded satellite GPS fix.',
    online: battery.online,
    lastHeartbeatAt: heartbeatAt?.toISOString() || null,
    heartbeatAgeSeconds: ageSeconds(heartbeatAt, clock),
    batteryPercent: Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
      ? percentage : null,
    batteryReadingAt: battery.readingAt,
    batteryAgeSeconds: battery.ageSeconds,
    batteryStale: battery.stale,
    // Preserve legacy tool fields, but never use device updates or speed as
    // evidence of the location's age, current position or a journey.
    speedKmh: device.speedKmh != null && device.speedKmh >= 5 ? device.speedKmh : 0,
    updatedAt: updatedAt?.toISOString() || null,
    mapsUrl: loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : null,
  };
}

function shortLabel(value, limit) {
  // Labels cannot add a second map or expose a hardware identifier. The only
  // URL in the reply is constructed from the selected observation's coordinates.
  return String(value || '').replace(/https?:\/\/\S+/gi, '')
    .replace(/\b\d{15}\b/g, '').replace(/[\r\n*_~`]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function recordedTime(result) {
  if (!result.recordedAt) return 'Recording time unavailable.';
  const date = toDate(result.recordedAt);
  if (!date) return 'Recording time unavailable.';
  const timestamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Indian/Mauritius', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  const age = formatAge(result.ageSeconds);
  return `Recorded ${age ? `${age} · ` : ''}${timestamp} MUT.`;
}

function radiusText(value) {
  return Number.isFinite(value) && value >= 0 ? `Estimated radius ${Math.round(value)} m.` : '';
}

/** Location facts are rendered directly; no model can remove their uncertainty. */
function formatLocationReply(result) {
  if (!result || result.error) {
    return 'I could not retrieve a recorded location for the selected watch. Please check the linked watch in Guardian and try again.';
  }
  const name = shortLabel(result.name, 80) || 'your loved one';
  const place = shortLabel(result.placeLabel, 140);
  const approximate = ['wifi', 'lbs'].includes(result.accuracySource);
  const historical = result.retainedSatellite || result.locationState !== 'fresh';
  const lines = [];

  if (!result.mapsUrl || result.locationState === 'unavailable') {
    lines.push(`No usable recorded location is available for ${name}.`, 'Current position unconfirmed.');
  } else {
    const heading = result.accuracySource === 'gps'
      ? `${historical ? 'Last known' : 'Latest recorded'} GPS location`
      : approximate
        ? `Approximate ${result.accuracySource === 'wifi' ? 'Wi-Fi' : 'cellular'} location`
        : 'Recorded location — source unconfirmed';
    lines.push(`*${heading} for ${name}*`);
    if (place) lines.push(`${approximate ? 'Near ' : ''}${place}`);
    lines.push(recordedTime(result));
    if (approximate && radiusText(result.accuracyMeters)) lines.push(radiusText(result.accuracyMeters));
    if (historical || result.accuracySource !== 'gps') lines.push('Current position unconfirmed.');

    if (result.retainedSatellite && ['wifi', 'lbs'].includes(result.latestObservationSource)) {
      const source = result.latestObservationSource === 'wifi' ? 'Wi-Fi' : 'cellular';
      const age = formatAge(result.latestObservationAgeSeconds) || 'recording time unavailable';
      const radius = radiusText(result.latestObservationAccuracyMeters);
      lines.push('', `${result.latestObservationIsNewer ? 'Newer approximate' : 'Approximate'} ${source} reading: ${age}.${radius ? ` ${radius}` : ''}`);
    }
    const mapLabel = result.accuracySource === 'gps'
      ? historical ? 'View last known GPS location:' : 'View recorded GPS location:'
      : approximate ? 'View approximate location:' : 'View recorded location (source unconfirmed):';
    lines.push('', mapLabel, result.mapsUrl);
  }

  const heartbeatAge = formatAge(result.heartbeatAgeSeconds);
  lines.push('', `Watch ${result.online ? 'online' : 'offline'}${heartbeatAge
    ? ` · last check-in ${heartbeatAge}` : ' · check-in time unavailable'}.`);
  if (result.batteryPercent != null) {
    const batteryAge = formatAge(result.batteryAgeSeconds);
    lines.push(`Battery last reported ${Math.round(result.batteryPercent)}%${batteryAge
      ? ` ${batteryAge}` : ' · reading time unavailable'}.${result.batteryStale ? ' This reading may be stale.' : ''}`);
  }
  return lines.join('\n');
}

module.exports = { buildLocationReplyData, formatLocationReply };
