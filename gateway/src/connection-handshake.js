/**
 * Writes a short-lived `connecting` phase to Firestore when a pendant opens TCP
 * and sends its first packet. The mobile app shows "Linking up" + satellite UI
 * until the gateway persists a live heartbeat/location.
 */
async function maybeAnnounceConnecting(
  session,
  imei,
  devicePatch,
  upsertDevice,
  onDeviceConnect,
  cancelPendingOffline,
  getDeviceDocument,
  seedLastKnownLocation
) {
  if (!session || !imei || session.handshakeAnnounced) return false;
  session.handshakeAnnounced = true;
  if (cancelPendingOffline) cancelPendingOffline(imei);
  onDeviceConnect(imei);
  if (getDeviceDocument && seedLastKnownLocation) {
    try {
      const existing = await getDeviceDocument(imei);
      if (existing?.location) seedLastKnownLocation(imei, existing.location);
    } catch (err) {
      console.warn(`[handshake] could not seed last-known location for ${imei}:`, err.message);
    }
  }
  await upsertDevice(imei, {
    ...devicePatch,
    online: false,
    connectionState: 'connecting',
    connectingAt: new Date(),
  });
  return true;
}

module.exports = { maybeAnnounceConnecting };
