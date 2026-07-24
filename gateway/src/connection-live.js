/** Persisted packets on one TCP session before Firestore promotes to live. */
const SESSION_LIVE_PACKETS = 2;

/** While TCP is live, refresh presence at least this often even if write-gate skips. */
const PRESENCE_TOUCH_MS = 60_000;

function shouldForceSessionPersist(session) {
  if (!session) return false;
  return (session.persistCount || 0) < SESSION_LIVE_PACKETS;
}

function sessionIsLive(session) {
  return Boolean(session && (session.persistCount || 0) >= SESSION_LIVE_PACKETS);
}

/**
 * Keep Firestore in `connecting` until the pendant has sent enough packets on
 * this TCP session — avoids "everyone is safe" on a single blip during network search.
 */
function buildSessionPersistPatch(session, patch) {
  if (!session) {
    return { ...patch, online: true, connectionState: 'live' };
  }
  session.persistCount = (session.persistCount || 0) + 1;
  if (session.persistCount < SESSION_LIVE_PACKETS) {
    return {
      ...patch,
      online: false,
      connectionState: 'connecting',
    };
  }
  return {
    ...patch,
    online: true,
    connectionState: 'live',
  };
}

/**
 * Network session open ⇒ stay Online. When write-gate skips a full persist,
 * still refresh lastHeartbeatAt so the app does not flash Offline between packets.
 */
function buildPresenceTouchPatch(session, now = Date.now()) {
  if (!sessionIsLive(session)) return null;
  const last = session.lastPresenceAt || 0;
  if (now - last < PRESENCE_TOUCH_MS) return null;
  session.lastPresenceAt = now;
  return {
    online: true,
    connectionState: 'live',
    lastHeartbeatAt: new Date(now),
  };
}

module.exports = {
  buildSessionPersistPatch,
  shouldForceSessionPersist,
  sessionIsLive,
  buildPresenceTouchPatch,
  SESSION_LIVE_PACKETS,
  PRESENCE_TOUCH_MS,
};
