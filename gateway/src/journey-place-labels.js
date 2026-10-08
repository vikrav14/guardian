'use strict';

const { decodePolyline } = require('./polyline');
const { haversineMeters } = require('./geofence');

const MAX_JOURNEY_PLACE_LOOKUPS = 24;

async function enrichJourneyStopPlaceNames(stops, reverseGeocode) {
  if (!Array.isArray(stops) || stops.length === 0) return [];
  if (typeof reverseGeocode !== 'function') return stops.map((stop) => ({ ...stop }));

  return Promise.all(
    stops.map(async (stop) => {
      const existing = String(stop?.placeName || '').trim();
      if (existing) return { ...stop, placeName: existing };

      const lat = Number(stop?.centerLat);
      const lng = Number(stop?.centerLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ...stop };

      try {
        const placeName = String((await reverseGeocode(lat, lng)) || '').trim();
        return placeName ? { ...stop, placeName } : { ...stop };
      } catch (_) {
        return { ...stop };
      }
    })
  );
}

async function enrichJourneyPointPlaceNames(journey, reverseGeocode) {
  const evidence = Array.isArray(journey?.pointEvidence)
    ? journey.pointEvidence
    : [];
  const points = decodePolyline(journey?.polyline);
  if (
    evidence.length === 0 ||
    evidence.length !== points.length ||
    typeof reverseGeocode !== 'function'
  ) {
    return evidence.map((point) => ({ ...point }));
  }

  const enriched = evidence.map(point => ({ ...point }));
  // Name the endpoints, recorded stops and both sides of sparse intervals
  // first. Bound provider work independently of GPS density and reuse nearby
  // lookups, without assigning a remote area's name to an unlabelled point.
  const priority = new Set([0, evidence.length - 1]);
  for (const stop of journey.stops || []) priority.add(stop.pointStartIndex);
  for (const gap of journey.routeGaps || []) {
    priority.add(gap.fromPointIndex); priority.add(gap.toPointIndex);
  }
  for (let slot = 0; slot < MAX_JOURNEY_PLACE_LOOKUPS; slot++) {
    priority.add(Math.round(slot * (evidence.length - 1) / (MAX_JOURNEY_PLACE_LOOKUPS - 1)));
  }
  const resolved = enriched.flatMap((point, i) => String(point.placeName || '').trim()
    ? [{ ...points[i], placeName: point.placeName }] : []);
  let lookups = 0;
  for (const index of priority) {
    if (!Number.isInteger(index) || index < 0 || index >= evidence.length ||
        String(enriched[index].placeName || '').trim()) continue;
    const point = points[index];
    const nearby = resolved.find(p => haversineMeters(p.lat, p.lng, point.lat, point.lng) <= 75);
    if (nearby) { enriched[index].placeName = nearby.placeName; continue; }
    if (lookups >= MAX_JOURNEY_PLACE_LOOKUPS) continue;
    lookups++;
    try {
      const placeName = String(
        (await reverseGeocode(point.lat, point.lng)) || ''
      ).trim();
      if (placeName) {
        enriched[index].placeName = placeName;
        resolved.push({ ...point, placeName });
      }
    } catch (_) { /* Keep the recorded coordinate even when naming is unavailable. */ }
  }
  for (let index = 0; index < enriched.length; index++) {
    if (String(enriched[index].placeName || '').trim()) continue;
    const nearby = resolved.find(p => haversineMeters(p.lat, p.lng, points[index].lat, points[index].lng) <= 75);
    if (nearby) enriched[index].placeName = nearby.placeName;
  }
  return enriched;
}

async function enrichStoredJourneyPlaceNames(db, ref, reverseGeocode) {
  const snapshot = await ref.get();
  if (!snapshot.exists) return 0;
  const journey = snapshot.data();
  const evidence = await enrichJourneyPointPlaceNames(journey, reverseGeocode);
  const added = evidence.filter((p, i) => p.placeName && !journey.pointEvidence[i].placeName).length;
  if (!added) return 0;
  // A recovery may replace the polyline while the provider is responding. Never
  // attach old indexes to that new route or overwrite labels written meanwhile.
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const data = current.data();
    if (!current.exists || data.polyline !== journey.polyline ||
        data.pointEvidence?.length !== evidence.length ||
        data.pointEvidence.some((p, i) => p.offsetMs !== evidence[i].offsetMs)) return 0;
    const pointEvidence = data.pointEvidence.map((p, i) => p.placeName || !evidence[i].placeName
      ? p : { ...p, placeName: evidence[i].placeName });
    tx.set(ref, { pointEvidence }, { merge: true });
    return pointEvidence.filter((p, i) => p.placeName && !data.pointEvidence[i].placeName).length;
  });
}

module.exports = {
  enrichJourneyStopPlaceNames,
  enrichJourneyPointPlaceNames,
  enrichStoredJourneyPlaceNames,
  MAX_JOURNEY_PLACE_LOOKUPS,
};
