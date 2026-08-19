'use strict';

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

module.exports = { enrichJourneyStopPlaceNames };
