/** Aligns with mobile [deviceLiveContactThreshold] (6 minutes). */
function connectionStaleMinutes(config) {
  return Number(config.connectionStaleMinutes || 3);
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minutesSinceHeartbeat(device, now = new Date()) {
  const heartbeat = asDate(device?.lastHeartbeatAt);
  if (!heartbeat) return null;
  return (now.getTime() - heartbeat.getTime()) / 60_000;
}

function isHeartbeatStale(device, staleMinutes, now = new Date()) {
  const minutes = minutesSinceHeartbeat(device, now);
  if (minutes == null) return true;
  return minutes >= staleMinutes;
}

/**
 * A device is offline when TCP is gone OR no heartbeat within the stale window.
 * Open TCP alone is not enough — ngrok/carrier can keep sockets alive after power-off.
 */
function shouldMarkDeviceOffline(device, { tcpConnected, staleMinutes, now = new Date() }) {
  if (!tcpConnected) return true;
  return isHeartbeatStale(device, staleMinutes, now);
}

/**
 * Intelligence reconcile: only clear stale heartbeats. TCP loss is handled by
 * the disconnect debounce so brief network blips do not flash offline.
 */
function shouldReconcileStaleOnline(device, { staleMinutes, now = new Date() }) {
  return isHeartbeatStale(device, staleMinutes, now);
}

module.exports = {
  connectionStaleMinutes,
  asDate,
  minutesSinceHeartbeat,
  isHeartbeatStale,
  shouldMarkDeviceOffline,
  shouldReconcileStaleOnline,
};
