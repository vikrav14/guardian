/**
 * Writes a short-lived `connecting` phase to Firestore when a pendant opens TCP
 * and sends its first packet. The mobile app shows "Linking up" + satellite UI
 * until the gateway persists a live heartbeat/location.
 */
async function maybeAnnounceConnecting(session, imei, devicePatch, upsertDevice, onDeviceConnect, cancelPendingOffline) {
  if (!session || !imei || session.handshakeAnnounced) return false;
  session.handshakeAnnounced = true;
  if (cancelPendingOffline) cancelPendingOffline(imei);
  onDeviceConnect(imei);
  await upsertDevice(imei, {
    ...devicePatch,
    online: false,
    connectionState: 'connecting',
    connectingAt: new Date(),
  });
  return true;
}

module.exports = { maybeAnnounceConnecting };
