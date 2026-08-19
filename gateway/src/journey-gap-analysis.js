'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function eventsInsideGap(journey, gap) {
  const from = number(gap?.fromOffsetMs);
  const to = number(gap?.toOffsetMs);
  return (Array.isArray(journey?.diagnosticEvents)
    ? journey.diagnosticEvents
    : []
  ).filter((event) => {
    const offset = number(event?.offsetMs, -1);
    return offset >= from && offset <= to;
  });
}

function classifyGap(journey, gap) {
  const events = eventsInsideGap(journey, gap);
  const types = new Set(events.map((event) => event.type));
  const heartbeats = events.filter(
    (event) => event.type === 'heartbeat_received'
  ).length;
  const locations = events.filter(
    (event) => event.type === 'location_received'
  ).length;

  if (types.has('tcp_disconnected')) {
    return {
      cause: 'transport_disconnect',
      confidence: 'high',
      explanation:
        'The watch TCP session disconnected during the missing interval.',
      events,
    };
  }
  if (types.has('approximate_resolution_failed')) {
    return {
      cause: 'fallback_resolution_failed',
      confidence: 'high',
      explanation:
        'Guardian received approximate positioning evidence but could not resolve it to a usable location.',
      events,
    };
  }
  if (heartbeats > 0 && locations === 0) {
    return {
      cause: 'location_reporting_or_gps',
      confidence: 'high',
      explanation:
        `The connection remained active (${heartbeats} heartbeat${heartbeats === 1 ? '' : 's'}), but no location was received.`,
      events,
    };
  }
  if (types.has('recovery_probe_sent')) {
    return {
      cause: 'packet_or_location_silence',
      confidence: 'medium',
      explanation:
        'Guardian detected silence and sent a continuous-reporting recovery probe.',
      events,
    };
  }
  if (events.length === 0) {
    return {
      cause: 'insufficient_telemetry',
      confidence: 'none',
      explanation:
        'This journey predates timestamped diagnostics, so the stored route proves the gap but not its cause.',
      events,
    };
  }
  return {
    cause: 'inconclusive',
    confidence: 'low',
    explanation:
      'Some gateway activity was recorded, but it does not isolate one cause.',
    events,
  };
}

function analyzeJourneyGaps(journey) {
  return (Array.isArray(journey?.routeGaps) ? journey.routeGaps : []).map(
    (gap, index) => ({
      index: index + 1,
      fromOffsetMs: number(gap.fromOffsetMs),
      toOffsetMs: number(gap.toOffsetMs),
      durationSeconds: number(gap.durationSeconds),
      ...classifyGap(journey, gap),
    })
  );
}

module.exports = { analyzeJourneyGaps, classifyGap, eventsInsideGap };
