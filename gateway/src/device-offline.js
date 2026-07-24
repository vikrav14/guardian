/** Debounce brief TCP drops so reconnects do not flash offline in the app. */
const { asDate } = require('./device-presence');

const pendingOfflineTimers = new Map();
const CONNECTING_GRACE_MS = 3 * 60 * 1000;

function shouldSkipOfflineWrite(device) {
  if (!device) return false;
  if (device.connectionState === 'connecting') return true;
  const connectingAt = asDate(device.connectingAt);
  if (connectingAt && Date.now() - connectingAt.getTime() < CONNECTING_GRACE_MS) {
    return true;
  }
  return false;
}

function scheduleDeviceOffline(imei, upsertDevice, debounceMs = 15_000, getDevice = null) {
  cancelPendingOffline(imei);
  const timer = setTimeout(async () => {
    pendingOfflineTimers.delete(imei);
    try {
      if (getDevice) {
        const device = await getDevice(imei);
        if (shouldSkipOfflineWrite(device)) return;
      }
      await upsertDevice(imei, { online: false, connectionState: 'offline' });
    } catch (err) {
      console.error('[gateway] debounced offline update failed', err.message);
    }
  }, debounceMs);
  pendingOfflineTimers.set(imei, timer);
}

function cancelPendingOffline(imei) {
  const timer = pendingOfflineTimers.get(imei);
  if (timer) clearTimeout(timer);
  pendingOfflineTimers.delete(imei);
}

function clearOfflineTimersForTests() {
  for (const timer of pendingOfflineTimers.values()) clearTimeout(timer);
  pendingOfflineTimers.clear();
}

function hasPendingOffline(imei) {
  return pendingOfflineTimers.has(imei);
}

module.exports = {
  scheduleDeviceOffline,
  cancelPendingOffline,
  clearOfflineTimersForTests,
  hasPendingOffline,
  shouldSkipOfflineWrite,
};
