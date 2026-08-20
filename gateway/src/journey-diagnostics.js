const DEFAULT_TIME_ZONE = 'Indian/Mauritius';

function asDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value.seconds === 'number') {
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
    const date = new Date(value.seconds * 1000 + Math.floor(nanos / 1_000_000));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationMs(journey) {
  const start = asDate(journey?.startAt);
  const end = asDate(journey?.endAt);
  if (!start || !end) return 0;
  return Math.max(0, end.getTime() - start.getTime());
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatDateTime(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = asDate(value);
  if (!date) return 'unknown';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function listEvents(journey) {
  return Array.isArray(journey?.events)
    ? journey.events.filter((event) => event && typeof event === 'object')
    : [];
}

function inferStartTrigger(journey) {
  const events = listEvents(journey);
  const exit = events.find((event) => event.type === 'geofence_exit');

  if (exit) {
    const name = exit.name || journey.originGeofenceName || 'safe zone';
    return {
      type: 'geofence_exit',
      label: `Safe-zone exit: ${name}`,
      evidence: 'stored geofence_exit event',
    };
  }

  return {
    type: 'generic_movement',
    label: 'Generic movement',
    evidence: 'no geofence_exit event stored at journey start',
  };
}

function closeReasonLabel(journey) {
  const reason = String(journey?.closeReason || '').trim();

  switch (reason) {
    case 'return_to_origin':
      return `Confirmed return to ${journey.originGeofenceName || 'origin safe zone'}`;
    case 'idle':
      return 'Idle timeout';
    case 'daily_boundary':
      return 'Daily boundary';
    case 'manual':
      return 'Manual close';
    case 'disconnect':
      return 'Disconnect close (legacy)';
    case '':
      return 'Unknown';
    default:
      return reason.replaceAll('_', ' ');
  }
}

function stopDurationMs(journey) {
  if (!Array.isArray(journey?.stops)) return 0;
  return journey.stops.reduce((total, stop) => {
    const minutes = Number(stop?.durationMinutes);
    if (Number.isFinite(minutes) && minutes >= 0) {
      return total + minutes * 60_000;
    }

    const start = asDate(stop?.startAt);
    const end = asDate(stop?.endAt);
    if (!start || !end) return total;
    return total + Math.max(0, end.getTime() - start.getTime());
  }, 0);
}

function analyzeJourney(journey = {}) {
  const duration = durationMs(journey);
  const distanceKm = Number(journey.distanceKm || 0);
  const pointCount = Number(journey.pointCount || 0);
  const stopCount = Number.isFinite(Number(journey.stopCount))
    ? Number(journey.stopCount)
    : (Array.isArray(journey.stops) ? journey.stops.length : 0);
  const legCount = Number.isFinite(Number(journey.legCount))
    ? Number(journey.legCount)
    : (Array.isArray(journey.legs) ? journey.legs.length : 0);
  const startTrigger = inferStartTrigger(journey);
  const reasons = [];

  // Diagnostic-only heuristics. These never alter or delete journey data.
  if (duration >= 2 * 60 * 60 * 1000 && distanceKm <= 1) {
    reasons.push(
      `very long duration (${formatDuration(duration)}) with only ${distanceKm.toFixed(2)} km`
    );
  }

  if (duration >= 4 * 60 * 60 * 1000 && pointCount <= 20) {
    reasons.push(
      `very sparse route: ${pointCount} points across ${formatDuration(duration)}`
    );
  }

  if (
    startTrigger.type === 'generic_movement' &&
    duration >= 60 * 60 * 1000 &&
    distanceKm <= 1
  ) {
    reasons.push('journey started without a stored safe-zone exit');
  }

  if (pointCount < 2) {
    reasons.push('fewer than 2 route points');
  }

  const likelyStationaryDrift =
    duration >= 2 * 60 * 60 * 1000 &&
    distanceKm <= 1 &&
    pointCount <= 20;

  return {
    id: journey.id || journey.journeyId || null,
    startAt: asDate(journey.startAt),
    endAt: asDate(journey.endAt),
    durationMs: duration,
    distanceKm,
    pointCount,
    startTrigger,
    closeReason: journey.closeReason || null,
    closeLabel: closeReasonLabel(journey),
    originGeofenceId: journey.originGeofenceId || null,
    originGeofenceName: journey.originGeofenceName || null,
    stopCount,
    legCount,
    stopDurationMs: stopDurationMs(journey),
    events: listEvents(journey),
    assessment:
      reasons.length === 0
        ? 'ok'
        : (likelyStationaryDrift ? 'likely_stationary_drift' : 'review'),
    reasons,
  };
}

function formatEvent(event, timeZone = DEFAULT_TIME_ZONE) {
  const name = event.name ? ` · ${event.name}` : '';
  const at = formatDateTime(event.at, timeZone);
  const confirmed =
    event.confirmedAt != null
      ? ` (confirmed ${formatDateTime(event.confirmedAt, timeZone)})`
      : '';
  return `${at} · ${event.type || 'event'}${name}${confirmed}`;
}

function formatJourneyDiagnostic(journey, options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const analysis = analyzeJourney(journey);
  const lines = [];

  lines.push(`Journey ${analysis.id || '(unknown id)'}`);
  lines.push(`  Start:      ${formatDateTime(analysis.startAt, timeZone)}`);
  lines.push(`  End:        ${formatDateTime(analysis.endAt, timeZone)}`);
  lines.push(`  Duration:   ${formatDuration(analysis.durationMs)}`);
  lines.push(`  Distance:   ${analysis.distanceKm.toFixed(2)} km`);
  lines.push(`  Points:     ${analysis.pointCount}`);
  lines.push(`  Started by: ${analysis.startTrigger.label}`);
  lines.push(`  Closed by:  ${analysis.closeLabel}`);

  if (analysis.originGeofenceId || analysis.originGeofenceName) {
    lines.push(
      `  Origin:     ${analysis.originGeofenceName || 'safe zone'}`
      + `${analysis.originGeofenceId ? ` (${analysis.originGeofenceId})` : ''}`
    );
  }

  const stopText =
    analysis.stopCount > 0
      ? `${analysis.stopCount} (${formatDuration(analysis.stopDurationMs)} total)`
      : `${analysis.stopCount}`;
  lines.push(`  Structure:  ${stopText} stop(s) · ${analysis.legCount} leg(s)`);

  const assessmentLabel = {
    ok: 'OK',
    review: 'REVIEW',
    likely_stationary_drift: 'LIKELY STATIONARY DRIFT',
  }[analysis.assessment] || analysis.assessment;

  lines.push(`  Assessment: ${assessmentLabel}`);

  if (analysis.reasons.length > 0) {
    for (const reason of analysis.reasons) {
      lines.push(`    - ${reason}`);
    }
  }

  if (analysis.events.length > 0) {
    lines.push('  Events:');
    for (const event of analysis.events) {
      lines.push(`    - ${formatEvent(event, timeZone)}`);
    }
  } else {
    lines.push('  Events:     none stored');
  }

  return lines.join('\n');
}

module.exports = {
  DEFAULT_TIME_ZONE,
  asDate,
  durationMs,
  formatDuration,
  formatDateTime,
  inferStartTrigger,
  analyzeJourney,
  formatJourneyDiagnostic,
};
