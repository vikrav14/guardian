'use strict';
const { asDate } = require('./safety-snapshot-policy');
const SOS_SETTLE_MS = 30_000;
const TELEMETRY_FRESH_MS = 30_000;

// Receipt on this particular socket; no identity, coordinates or packet body.
// Alarm frames can also contain a location: they do not qualify as later telemetry.
function noteIncidentPhotoTelemetry(session, events, receivedAtMs) {
  if (!session || !Number.isFinite(receivedAtMs) || events.some(e => e.type === 'alarm')) return;
  if (events.some(e => e.type === 'heartbeat' || e.type === 'location')) {
    session.incidentPhotoTelemetryAt = receivedAtMs;
  }
}

// Pilot candidate for the observed SOS/reconnect race, not camera-readiness proof.
// Wait passively before the first write. Never replay a previously sent request.
function initialSosConnectionReady(incident, session, atMs) {
  if (!incident || incident.trial || incident.type !== 'sos' || incident.requestIds?.length) return true;
  const eventAt = asDate(incident.eventAt);
  const telemetryAt = session.incidentPhotoTelemetryAt;
  return eventAt != null && Number.isFinite(telemetryAt) &&
    telemetryAt >= +eventAt + SOS_SETTLE_MS && telemetryAt <= atMs &&
    atMs - telemetryAt <= TELEMETRY_FRESH_MS;
}
module.exports = { noteIncidentPhotoTelemetry, initialSosConnectionReady, SOS_SETTLE_MS };
