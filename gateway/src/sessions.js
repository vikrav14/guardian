/** Active TCP device sessions (socket -> session state). */
const config = require('./config');

const sessions = new Map();

function getActiveSessions() {
  return sessions;
}

function clearIdleTimer(session) {
  if (session?.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function touchSessionActivity(socket) {
  const session = sessions.get(socket);
  if (!session) return;
  clearIdleTimer(session);
  const idleMs = Math.max(60_000, Number(config.tcpIdleMinutes || 4) * 60_000);
  session.idleTimer = setTimeout(() => {
    console.log(`[tcp] idle timeout imei=${session.imei || 'unknown'}`);
    try {
      socket.destroy();
    } catch (_) {
      /* ignore */
    }
  }, idleMs);
}

function registerSession(socket, initial = {}) {
  sessions.set(socket, {
    imei: null,
    protocolId: null,
    buffer: Buffer.alloc(0),
    lastPacketAt: Date.now(),
    ...initial,
  });
  touchSessionActivity(socket);
}

function noteSessionPacket(socket) {
  const session = sessions.get(socket);
  if (session) session.lastPacketAt = Date.now();
}

/** IMEIs with an open TCP socket but no packets for [maxSilentMs]. */
function listSilentConnectedImeis(maxSilentMs) {
  const now = Date.now();
  const silent = new Set();
  for (const session of sessions.values()) {
    if (!session.imei) continue;
    const last = session.lastPacketAt ?? 0;
    if (now - last >= maxSilentMs) silent.add(session.imei);
  }
  return silent;
}

function unregisterSession(socket) {
  const session = sessions.get(socket);
  if (session) clearIdleTimer(session);
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
  listSilentConnectedImeis,
  listConnectedImeis,
};
