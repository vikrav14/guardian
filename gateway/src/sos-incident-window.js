const SOS_INCIDENT_WINDOW_MS = 90_000;

const lastAcceptedByImei = new Map();

function claimSosIncident(
  imei,
  {
    nowMs = Date.now(),
    windowMs = SOS_INCIDENT_WINDOW_MS,
  } = {}
) {
  const key = String(imei || '').trim();
  const clock = Number(nowMs);
  const window = Number(windowMs);
  if (!key) throw new Error('SOS incident IMEI is required.');
  if (!Number.isFinite(clock)) throw new Error('SOS incident clock must be finite.');
  if (!Number.isFinite(window) || window <= 0) {
    throw new Error('SOS incident window must be positive.');
  }

  const previous = lastAcceptedByImei.get(key);
  const elapsedMs = previous == null ? null : clock - previous;
  if (elapsedMs != null && elapsedMs >= 0 && elapsedMs < window) {
    return {
      accepted: false,
      reason: 'duplicate_sos_packet',
      elapsedMs,
      retryAfterMs: window - elapsedMs,
    };
  }

  lastAcceptedByImei.set(key, clock);
  return {
    accepted: true,
    reason: null,
    elapsedMs,
    retryAfterMs: 0,
  };
}

function resetSosIncidentWindowForTests() {
  lastAcceptedByImei.clear();
}

module.exports = {
  SOS_INCIDENT_WINDOW_MS,
  claimSosIncident,
  resetSosIncidentWindowForTests,
};
