/** Active TCP device sessions (socket -> session state). */
const config = require('./config');

const sessions = new Map();
const MIN_IDLE_MS = 60_000;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * A socket must never be closed before the watch's next expected report.
 * Once Guardian knows the applied interval, allow two missed reports plus a
 * minute of transport jitter. Until then, retain the configured fallback.
 */
function idleTimeoutMsForInterval(
  expectedReportingIntervalSeconds,
  fallbackMinutes = config.tcpIdleMinutes
) {
  const intervalSeconds = positiveNumber(expectedReportingIntervalSeconds);
  if (intervalSeconds != null) {
    return Math.max(MIN_IDLE_MS, (intervalSeconds * 2 + 60) * 1000);
  }

  const minutes = positiveNumber(fallbackMinutes) || 12;
  return Math.max(MIN_IDLE_MS, minutes * 60_000);
}

function recoveryGraceMs() {
  const seconds = positiveNumber(config.tcpRecoveryGraceSeconds) || 90;
  return Math.max(30_000, seconds * 1000);
}

function outingLocationStaleMs() {
  const seconds = positiveNumber(config.outingLocationStaleSeconds) || 150;
  return Math.max(60_000, seconds * 1000);
}

function outingLocationProbeIntervalMs() {
  const seconds = positiveNumber(config.outingLocationProbeIntervalSeconds) || 180;
  return Math.max(60_000, seconds * 1000);
}

function getActiveSessions() {
  return sessions;
}

function clearIdleTimer(session) {
  if (session?.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function clearLocationTimer(session) {
  if (session?.locationTimer) {
    clearTimeout(session.locationTimer);
    session.locationTimer = null;
  }
}

function scheduleIdleTimer(socket, delayMs) {
  const session = sessions.get(socket);
  if (!session) return;
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    handleIdleTimeout(socket);
  }, delayMs);
}

function invokeRecoveryProbe(session, reason) {
  if (typeof session?.onRecoveryProbe !== 'function') return false;
  try {
    const result = session.onRecoveryProbe({
      imei: session.imei,
      protocolId: session.protocolId,
      reason,
      expectedReportingIntervalSeconds:
        session.expectedReportingIntervalSeconds ?? null,
      outingActive: session.outingActive === true,
    });
    return result === true || result?.ok === true;
  } catch (err) {
    console.warn(
      `[tcp] recovery probe failed imei=${session.imei || 'unknown'}: ${err.message}`
    );
    return false;
  }
}

/** Probe once before destroying a packet-silent socket. */
function handleIdleTimeout(socket) {
  const session = sessions.get(socket);
  if (!session) return { action: 'missing_session' };
  clearIdleTimer(session);

  if (!session.packetRecoveryProbeAt) {
    const probed = invokeRecoveryProbe(session, 'packet_silence');
    if (probed) {
      session.packetRecoveryProbeAt = Date.now();
      const graceMs = recoveryGraceMs();
      console.warn(
        `[tcp] silent imei=${session.imei || 'unknown'}; CR recovery probe sent ` +
          `(grace=${Math.round(graceMs / 1000)}s)`
      );
      scheduleIdleTimer(socket, graceMs);
      return { action: 'probe', graceMs };
    }
  }

  console.log(`[tcp] idle timeout imei=${session.imei || 'unknown'} after recovery`);
  try {
    socket.destroy();
  } catch (_) {
    /* ignore */
  }
  return { action: 'destroy' };
}

function scheduleLocationFreshnessProbe(socket, delayMs = outingLocationStaleMs()) {
  const session = sessions.get(socket);
  if (!session) return;
  clearLocationTimer(session);
  if (!session.outingActive) return;
  session.locationTimer = setTimeout(() => {
    handleLocationStale(socket);
  }, delayMs);
}

/**
 * Packet heartbeats can remain healthy while indoor GPS is unavailable. During
 * an outing, request a fresh GPS/Wi-Fi/LBS observation without declaring the
 * whole device offline or drawing an invented route.
 */
function handleLocationStale(socket) {
  const session = sessions.get(socket);
  if (!session || !session.outingActive) return { action: 'inactive' };
  clearLocationTimer(session);

  const probed = invokeRecoveryProbe(session, 'location_stale');
  if (probed) {
    const now = Date.now();
    session.lastLocationProbeAt = now;
    // When both location and packets are stale, this single CR is also the
    // packet-recovery attempt. Start the grace clock here instead of sending a
    // duplicate CR again when the packet-idle timer fires moments later.
    if (now - (session.lastPacketAt || 0) >= outingLocationStaleMs()) {
      session.packetRecoveryProbeAt = now;
      scheduleIdleTimer(socket, recoveryGraceMs());
    }
    console.warn(
      `[tracking] stale location imei=${session.imei || 'unknown'} during outing; ` +
        'CR recovery probe sent'
    );
  }
  scheduleLocationFreshnessProbe(socket, outingLocationProbeIntervalMs());
  return { action: probed ? 'probe' : 'probe_unavailable' };
}

function touchSessionActivity(socket) {
  const session = sessions.get(socket);
  if (!session) return;
  const idleMs = idleTimeoutMsForInterval(
    session.expectedReportingIntervalSeconds
  );
  scheduleIdleTimer(socket, idleMs);
}

function registerSession(socket, initial = {}) {
  const session = {
    imei: null,
    protocolId: null,
    buffer: Buffer.alloc(0),
    lastPacketAt: Date.now(),
    lastLocationAt: null,
    expectedReportingIntervalSeconds: null,
    outingActive: false,
    packetRecoveryProbeAt: null,
    ...initial,
  };
  sessions.set(socket, session);
  if (typeof socket.setKeepAlive === 'function') {
    const delayMs = Math.max(
      10_000,
      positiveNumber(config.tcpKeepAliveInitialDelayMs) || 60_000
    );
    try {
      socket.setKeepAlive(true, delayMs);
    } catch (err) {
      console.warn(`[tcp] could not enable keepalive: ${err.message}`);
    }
  }
  touchSessionActivity(socket);
}

function noteSessionPacket(socket) {
  const session = sessions.get(socket);
  if (!session) return false;
  const recovered = Boolean(session.packetRecoveryProbeAt);
  session.lastPacketAt = Date.now();
  session.packetRecoveryProbeAt = null;
  return recovered;
}

function setDeviceReportingContext(
  imeiOrProtocolId,
  { expectedReportingIntervalSeconds, outingActive } = {}
) {
  const matches = findSocketsForDevice(imeiOrProtocolId);
  const interval = positiveNumber(expectedReportingIntervalSeconds);
  for (const { socket, session } of matches) {
    if (interval != null) {
      session.expectedReportingIntervalSeconds = interval;
    }
    const wasOuting = session.outingActive === true;
    session.outingActive = outingActive === true;
    touchSessionActivity(socket);

    if (!session.outingActive) {
      clearLocationTimer(session);
    } else if (!wasOuting || !session.locationTimer) {
      scheduleLocationFreshnessProbe(socket);
    }
  }
  return matches.length;
}

function noteDeviceLocation(imeiOrProtocolId, nowMs = Date.now()) {
  const matches = findSocketsForDevice(imeiOrProtocolId);
  for (const { socket, session } of matches) {
    session.lastLocationAt = nowMs;
    session.lastLocationProbeAt = null;
    if (session.outingActive) scheduleLocationFreshnessProbe(socket);
  }
  return matches.length;
}

function unregisterSession(socket) {
  const session = sessions.get(socket);
  if (session) {
    clearIdleTimer(session);
    clearLocationTimer(session);
  }
  sessions.delete(socket);
}

function getSession(socket) {
  return sessions.get(socket);
}

/** Find open sockets for a 15-digit IMEI or 10-digit protocol id. */
function findSocketsForDevice(imeiOrProtocolId) {
  const matches = [];
  for (const [socket, session] of sessions) {
    if (
      session.imei === imeiOrProtocolId ||
      session.protocolId === imeiOrProtocolId
    ) {
      matches.push({ socket, session });
    }
  }
  return matches;
}

function listConnectedImeis() {
  const imeis = new Set();
  for (const session of sessions.values()) {
    if (session.imei) imeis.add(session.imei);
  }
  return imeis;
}

module.exports = {
  getActiveSessions,
  registerSession,
  unregisterSession,
  getSession,
  findSocketsForDevice,
  touchSessionActivity,
  noteSessionPacket,
  noteDeviceLocation,
  setDeviceReportingContext,
  idleTimeoutMsForInterval,
  handleIdleTimeout,
  handleLocationStale,
  listConnectedImeis,
};
