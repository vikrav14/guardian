'use strict';

const { readFirstSnapshot } = require('./firestore-first-snapshot');
const { evaluateGeofenceSnapshot, getGeofencePresence, seedHomeWifiGeofencePresence } = require('./geofence');
const { selectHomeWifiTracking } = require('./wifi-home-tracking');
const { trackPointForJourney, isJourneyActive } = require('./live-cache');

async function recoverHomeWifiWalk({ db, imei, points, batch, current, signal,
  createAlert, flushJourneys, read = readFirstSnapshot, now = Date.now }) {
  if (!db || !current() || isJourneyActive(imei)) return { recovered: false };
  const snapshot = await read(db.collection('geofences').where('imei', '==', imei)
    .where('active', '==', true), signal);
  if (!current() || isJourneyActive(imei)) return { recovered: false };
  const homes = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))
    .filter(zone => zone.active === true && zone.imei === imei &&
      typeof zone.name === 'string' && zone.name.trim().toLowerCase() === 'home');
  const home = homes[0];
  if (homes.length !== 1 || JSON.stringify([home.id, home.center?.lat, home.center?.lng,
    home.radiusMeters ?? 150, home.createdBy]) !== batch.key) return { recovered: false };
  const clock = new Date(now());
  if (selectHomeWifiTracking(imei, points[0], null, clock).hold) return { recovered: false };

  // The binding and generation are checked after the cancellable read. All
  // in-memory route/zone mutations below are synchronous, before external I/O.
  seedHomeWifiGeofencePresence(imei, { anchor: batch.anchor });
  const alerts = [], flushes = [];
  for (const point of points) {
    const transitions = evaluateGeofenceSnapshot(snapshot, imei, point, { now: +clock });
    const presence = getGeofencePresence(imei);
    const exit = transitions.find(event => event.type === 'geofence_exit');
    const enter = transitions.find(event => event.type === 'geofence_enter');
    const transition = isJourneyActive(imei) ? (enter || exit) : (exit || enter);
    const result = trackPointForJourney(imei, point, clock, {
      geofenceTransition: Boolean(transition), transitionType: transition?.type,
      geofenceId: transition?.payload?.geofenceId, geofenceName: transition?.payload?.geofenceName,
      transitionEvidence: transition?.payload?.observationEvidence,
      hasActiveSafeZones: presence.hasActiveZones, insideAnySafeZone: presence.insideAny,
      insideSafeZoneIds: presence.insideZoneIds, hasUncertainSafeZones: presence.hasUncertainZones,
    });
    alerts.push(...transitions); flushes.push(...result.flushes);
  }
  // Preserve original event/source times. Do not replay raw writes, heartbeats,
  // dwell, intelligence, SOS dispatch or reporting commands for old packets.
  const recovered = isJourneyActive(imei) || flushes.length > 0;
  const delivery = Promise.allSettled([
    flushJourneys(imei, flushes),
    ...alerts.map(alert => createAlert(imei, alert)),
  ]);
  // Firestore writes can remain pending while offline. Tracking is committed;
  // delivery must not keep the pilot's next candidate behind this old batch.
  return { recovered, delivery };
}

module.exports = { recoverHomeWifiWalk };
