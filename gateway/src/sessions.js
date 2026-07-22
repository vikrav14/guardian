/** Active TCP device sessions (socket -> session state). */
const sessions = new Map();

function getActiveSessions() {
  return sessions;
}

function registerSession(socket, initial = {}) {
  sessions.set(socket, {
    imei: null,
    protocolId: null,
    buffer: Buffer.alloc(0),
    ...initial,
  });
}

function unregisterSession(socket) {
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

module.exports = {
  getActiveSessions,
  registerSession,
  unregisterSession,
  getSession,
  findSocketsForDevice,
};
