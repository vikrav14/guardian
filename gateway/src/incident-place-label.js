'use strict';

const PLACE_LOOKUP_TIMEOUT_MS = 1500;
const sameCoordinates = (a, b) => Boolean(a && b &&
  Number.isFinite(a.lat) && Number.isFinite(a.lng) && a.lat === b.lat && a.lng === b.lng);
const label = value => typeof value === 'string' ? value.trim() || null : null;

/** Enrich the already selected point, never reselect a location after awaiting.
 * A name describes coordinates, not a new position observation. Reuse a stored
 * name only at identical coordinates; never borrow a previous town or Home.
 * Lookup failure must not hold an emergency behind the normal eight-second
 * persistence lookup or allow a late response to rewrite the frozen alert. */
async function enrichIncidentPlaceLabel(snapshot, { device = {}, reverseGeocode,
  timeoutMs = PLACE_LOOKUP_TIMEOUT_MS } = {}) {
  const point = snapshot?.location;
  if (snapshot?.state !== 'fresh' || !point || point.source === 'home_wifi' || label(point.placeLabel)) return snapshot;
  const candidates = [device.location, device.lastLocationObservation,
    device.lastApproximateLocation, device.lastSatelliteLocation];
  let placeLabel = label(candidates.find(candidate =>
    sameCoordinates(point, candidate) && label(candidate.placeLabel))?.placeLabel);
  if (!placeLabel && typeof reverseGeocode === 'function') {
    const controller = new AbortController();
    let timer;
    try {
      placeLabel = label(await Promise.race([
        Promise.resolve().then(() => reverseGeocode(point.lat, point.lng, { signal: controller.signal })),
        new Promise(resolve => { timer = setTimeout(() => { resolve(null); controller.abort(); }, timeoutMs); }),
      ]));
    } catch {
      // A place name is optional metadata; preserve the actual evidence.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  if (!placeLabel) return snapshot;
  return { ...snapshot, location: { ...point, placeLabel },
    latestObservation: sameCoordinates(point, snapshot.latestObservation)
      ? { ...snapshot.latestObservation, placeLabel } : snapshot.latestObservation };
}

module.exports = { PLACE_LOOKUP_TIMEOUT_MS, sameCoordinates, enrichIncidentPlaceLabel };
