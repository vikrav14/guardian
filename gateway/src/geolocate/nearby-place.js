'use strict';

const { haversineMeters } = require('../geofence');

const DEFAULT_RADIUS_METRES = 350;
const MAX_LABEL_DISTANCE_METRES = 250;
const DEFAULT_TIMEOUT_MS = 8_000;

const TYPE_BONUS = new Map([
  // Major destinations receive enough weight to beat a nearby car park or
  // small tenant when the stop centroid falls within the destination site.
  ['supermarket', 230],
  ['shopping_mall', 215],
  ['department_store', 200],
  ['hospital', 125],
  ['university', 120],
  ['school', 115],
  ['tourist_attraction', 110],
  ['park', 105],
  ['museum', 100],
  ['stadium', 100],
  ['church', 95],
  ['mosque', 95],
  ['hindu_temple', 95],
  ['restaurant', 75],
  ['cafe', 70],
  ['store', 65],
  ['gas_station', 55],
  ['parking', 10],
]);

function cleanText(value, maxLength = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text && text.length <= maxLength ? text : null;
}

function localityPart(areaName) {
  const area = cleanText(areaName);
  if (!area) return null;
  return cleanText(area.split('·')[0].replace(/^near\s+/i, ''));
}

function includesText(haystack, needle) {
  return String(haystack || '').localeCompare(String(needle || ''), undefined, {
    sensitivity: 'base',
    usage: 'search',
  }) === 0 || String(haystack || '').toLocaleLowerCase()
    .includes(String(needle || '').toLocaleLowerCase());
}

function buildNearbyPlaceLabel(displayName, areaName) {
  const name = cleanText(displayName);
  if (!name) return null;
  const area = localityPart(areaName);
  if (!area || includesText(name, area)) return `Near ${name}`;
  return `Near ${name}, ${area}`;
}

function nearbySearchRequestBody(lat, lng, radiusMetres = DEFAULT_RADIUS_METRES) {
  return {
    maxResultCount: 10,
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMetres,
      },
    },
  };
}

async function searchNearbyPlaces(
  lat,
  lng,
  {
    apiKey,
    fetchImpl = fetch,
    radiusMetres = DEFAULT_RADIUS_METRES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}
) {
  const key = String(apiKey || '').trim();
  if (!key) return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.location',
            'places.primaryType',
          ].join(','),
        },
        body: JSON.stringify(nearbySearchRequestBody(lat, lng, radiusMetres)),
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Google Places request timed out after ${timeoutMs} ms.`);
    }
    throw new Error(`Google Places request failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(body?.error?.message || `HTTP ${response.status}`)
      .replaceAll(key, '[redacted]');
    throw new Error(`Google Places rejected the request: ${message}`);
  }

  return (Array.isArray(body.places) ? body.places : []).flatMap((place, index) => {
    const placeLat = Number(place?.location?.latitude);
    const placeLng = Number(place?.location?.longitude);
    const displayName = cleanText(place?.displayName?.text);
    const placeId = cleanText(place?.id, 300);
    if (!displayName || !placeId || !Number.isFinite(placeLat) || !Number.isFinite(placeLng)) {
      return [];
    }
    return [{
      placeId,
      displayName,
      primaryType: cleanText(place?.primaryType, 80),
      lat: placeLat,
      lng: placeLng,
      popularityRank: index,
      distanceMeters: Math.round(
        haversineMeters(lat, lng, placeLat, placeLng)
      ),
    }];
  });
}

function selectNearbyLandmark(candidates, { maxDistanceMetres = MAX_LABEL_DISTANCE_METRES } = {}) {
  const scored = (candidates || []).filter((candidate) =>
    candidate?.placeId &&
    candidate?.displayName &&
    Number.isFinite(Number(candidate.distanceMeters)) &&
    Number(candidate.distanceMeters) <= maxDistanceMetres
  ).map((candidate) => {
    const type = String(candidate.primaryType || '').toLowerCase();
    const typeBonus = TYPE_BONUS.get(type) || 35;
    return {
      ...candidate,
      score:
        Number(candidate.distanceMeters) -
        typeBonus +
        (Number(candidate.popularityRank || 0) * 7),
    };
  }).sort((left, right) => left.score - right.score);

  return scored[0] || null;
}

async function findNearbyLandmark(
  lat,
  lng,
  { areaName, ...options } = {}
) {
  const candidates = await searchNearbyPlaces(lat, lng, options);
  const selected = selectNearbyLandmark(candidates);
  if (!selected) return null;
  return {
    placeId: selected.placeId,
    displayName: selected.displayName,
    label: buildNearbyPlaceLabel(selected.displayName, areaName),
    primaryType: selected.primaryType,
    distanceMeters: selected.distanceMeters,
    provider: 'google_places',
  };
}

module.exports = {
  DEFAULT_RADIUS_METRES,
  MAX_LABEL_DISTANCE_METRES,
  buildNearbyPlaceLabel,
  findNearbyLandmark,
  nearbySearchRequestBody,
  searchNearbyPlaces,
  selectNearbyLandmark,
};
