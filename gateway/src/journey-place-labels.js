'use strict';

const { decodePolyline } = require('./polyline');

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

  // Keep provider pressure predictable. The geocoder itself caches nearby
  // repeated coordinates, while sequential lookups avoid a burst at journey
  // completion time.
  const enriched = [];
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const existing = String(item?.placeName || '').trim();
    if (existing) {
      enriched.push({ ...item, placeName: existing });
      continue;
    }

    try {
      const placeName = String(
        (await reverseGeocode(points[index].lat, points[index].lng)) || ''
      ).trim();
      enriched.push(placeName ? { ...item, placeName } : { ...item });
    } catch (_) {
      enriched.push({ ...item });
    }
  }
  return enriched;
}

module.exports = {
  enrichJourneyStopPlaceNames,
  enrichJourneyPointPlaceNames,
};
