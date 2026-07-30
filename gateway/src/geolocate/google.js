const crypto = require('crypto');

const config = require('../config');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const REVERSE_GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** @type {Map<string, { result: object, expiresAt: number }>} */
const cache = new Map();

/** @type {Map<string, { result: string, expiresAt: number }>} */
const reverseGeocodeCache = new Map();

function cacheKey({ wifiAccessPoints = [], cellTowers = [] }) {
  const payload = JSON.stringify({
    w: wifiAccessPoints.map((w) => [w.macAddress, w.signalStrength ?? '']),
    c: cellTowers.map((c) => [
      c.mobileCountryCode,
      c.mobileNetworkCode,
      c.locationAreaCode,
      c.cellId,
    ]),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizeMac(raw) {
  return String(raw).trim().toLowerCase().replace(/-/g, ':');
}

function isMacAddress(field) {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(field || '').trim());
}

function isUsableMac(field) {
  if (!isMacAddress(field)) return false;
  const mac = normalizeMac(field);
  return mac !== '00:00:00:00:00:00' && mac !== 'ff:ff:ff:ff:ff:ff';
}

/** Scan pre-WiFi fields for MCC/MNC/LAC/cellId (V28C buries them after status bytes). */
function findCellBlockStart(fields) {
  for (let i = 0; i + 3 < fields.length; i++) {
    const mcc = parseInt(fields[i], 10);
    const mnc = parseInt(fields[i + 1], 10);
    const lac = parseInt(fields[i + 2], 10);
    const cellId = parseInt(fields[i + 3], 10);
    if (isValidMcc(mcc) && !Number.isNaN(mnc) && !Number.isNaN(lac) && !Number.isNaN(cellId)) {
      return i;
    }
  }
  return -1;
}

function isValidMcc(value) {
  return Number.isInteger(value) && value >= 200 && value <= 999;
}

function parseSignal(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n > 0 || n < -120) return null;
  return n;
}

function parseLteExtras(extras) {
  const wifiAccessPoints = [];
  const cellTowers = [];

  for (let i = 0; i < extras.length; i++) {
    const field = extras[i]?.trim();
    if (!field || !isUsableMac(field)) continue;

    const ap = { macAddress: normalizeMac(field) };
    const next = extras[i + 1]?.trim();
    if (next) {
      const rssi = parseSignal(next);
      if (rssi != null) {
        ap.signalStrength = rssi;
        i += 1;
      }
    }
    wifiAccessPoints.push(ap);
  }

  const firstMacIdx = extras.findIndex((f) => isUsableMac(f?.trim()));
  let cellFields = (firstMacIdx >= 0 ? extras.slice(0, firstMacIdx) : extras)
    .map((f) => f?.trim())
    .filter(Boolean);

  if (cellFields.length > 0) {
    const last = parseInt(cellFields[cellFields.length - 1], 10);
    if (
      !Number.isNaN(last) &&
      last >= 1 &&
      last <= 20 &&
      (wifiAccessPoints.length === 0 || last === wifiAccessPoints.length)
    ) {
      cellFields = cellFields.slice(0, -1);
    }
  }

  const cellStart = findCellBlockStart(cellFields);
  if (cellStart >= 0 && cellStart + 3 < cellFields.length) {
    const mcc = parseInt(cellFields[cellStart], 10);
    const mnc = parseInt(cellFields[cellStart + 1], 10);
    const lac = parseInt(cellFields[cellStart + 2], 10);
    const cellId = parseInt(cellFields[cellStart + 3], 10);

    const primary = {
      mobileCountryCode: mcc,
      mobileNetworkCode: mnc,
      locationAreaCode: lac,
      cellId,
    };
    let idx = cellStart + 4;

    const primarySignal = cellFields[idx] ? parseSignal(cellFields[idx]) : null;
    if (primarySignal != null) {
      primary.signalStrength = primarySignal;
      idx += 1;
    } else if (cellFields[idx]) {
      const maybeCount = parseInt(cellFields[idx], 10);
      if (!Number.isNaN(maybeCount) && maybeCount >= 1 && maybeCount <= 10) {
        idx += 1;
      }
    }

    cellTowers.push(primary);

    while (idx + 2 <= cellFields.length) {
      const nLac = parseInt(cellFields[idx], 10);
      const nCellId = parseInt(cellFields[idx + 1], 10);
      if (Number.isNaN(nLac) || Number.isNaN(nCellId) || nCellId < 1000) break;

      const neighbor = {
        mobileCountryCode: mcc,
        mobileNetworkCode: mnc,
        locationAreaCode: nLac,
        cellId: nCellId,
      };
      idx += 2;

      if (cellFields[idx]) {
        const nSig = parseSignal(cellFields[idx]);
        if (nSig != null) {
          neighbor.signalStrength = nSig;
          idx += 1;
        }
      }
      cellTowers.push(neighbor);
    }
  }

  return { wifiAccessPoints, cellTowers };
}

const FACTORY_LAT = 22.68;
const FACTORY_LNG = 113.99;

function isPlaceholderCoords(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return true;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return true;
  if (Math.abs(lat - FACTORY_LAT) < 0.05 && Math.abs(lng - FACTORY_LNG) < 0.05) return true;
  return false;
}

/**
 * Resolve lat/lng from WiFi MAC + LBS cell data via Google Geolocation API.
 * @returns {Promise<{ lat: number, lng: number, accuracyMeters: number|null }|null>}
 */
async function geolocateFromV({ wifiAccessPoints = [], cellTowers = [] } = {}, options = {}) {
  const apiKey = config.googleGeolocationApiKey;
  if (!apiKey) {
    console.log('[geolocate] skip — GOOGLE_GEOLOCATION_API_KEY not set');
    return null;
  }

  if (config.firestoreDisabled && options.respectFirestoreDisabled !== false) {
    console.log('[geolocate] skip — FIRESTORE_DISABLED (no API call)');
    return null;
  }

  if (wifiAccessPoints.length === 0 && cellTowers.length === 0) {
    return null;
  }

  const hash = cacheKey({ wifiAccessPoints, cellTowers });
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const body = {};
  if (cellTowers.length > 0) {
    body.cellTowers = cellTowers.map((tower) => ({
      mobileCountryCode: tower.mobileCountryCode,
      mobileNetworkCode: tower.mobileNetworkCode,
      locationAreaCode: tower.locationAreaCode,
      cellId: tower.cellId,
      ...(tower.signalStrength != null ? { signalStrength: tower.signalStrength } : {}),
    }));
    body.homeMobileCountryCode = cellTowers[0].mobileCountryCode;
    body.homeMobileNetworkCode = cellTowers[0].mobileNetworkCode;
    body.radioType = 'lte';
  }
  if (wifiAccessPoints.length > 0) {
    body.wifiAccessPoints = wifiAccessPoints.map((ap) => ({
      macAddress: ap.macAddress,
      ...(ap.signalStrength != null ? { signalStrength: ap.signalStrength } : {}),
    }));
  }

  try {
    const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[geolocate] API error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    if (typeof data.location?.lat !== 'number' || typeof data.location?.lng !== 'number') {
      return null;
    }

    const result = {
      lat: data.location.lat,
      lng: data.location.lng,
      accuracyMeters: typeof data.accuracy === 'number' ? data.accuracy : null,
    };

    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    cache.set(hash, { result, expiresAt: Date.now() + ttlMs });
    return result;
  } catch (err) {
    console.warn('[geolocate] request failed:', err.message);
    return null;
  }
}

function clearGeolocationCache() {
  cache.clear();
  reverseGeocodeCache.clear();
}

function reverseGeocodeCacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Reverse geocode lat/lng to a place name via Google Maps API.
 * Returns the best human-readable location name (address, locality, or administrative area).
 * Results are cached to ensure consistent place names for the same coordinates.
 *
 * @returns {Promise<string|null>} Place name or null if lookup fails / API unavailable
 */
async function reverseGeocodeToPlaceName(lat, lng, options = {}) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const cacheKey = reverseGeocodeCacheKey(lat, lng);
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const apiKey = config.googleGeolocationApiKey;
  if (!apiKey) {
    return null; // API key not configured
  }

  if (config.firestoreDisabled && options.respectFirestoreDisabled !== false) {
    return null;
  }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?` +
      `latlng=${lat},${lng}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[reverse-geocode] API error ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    // Extract the best place name with priority on specific neighborhoods/areas
    // Priority order: neighborhood > sublocality > locality > administrative_area_level_1
    const firstResult = data.results[0];
    let placeName = null;

    // Look for the most specific location type first
    for (const component of firstResult.address_components || []) {
      if (component.types.includes('neighborhood')) {
        placeName = component.long_name;
        break;
      }
    }

    if (!placeName) {
      for (const component of firstResult.address_components || []) {
        if (component.types.includes('sublocality')) {
          placeName = component.long_name;
          break;
        }
      }
    }

    if (!placeName) {
      for (const component of firstResult.address_components || []) {
        if (component.types.includes('locality')) {
          placeName = component.long_name;
          break;
        }
      }
    }

    if (!placeName) {
      for (const component of firstResult.address_components || []) {
        if (component.types.includes('administrative_area_level_1')) {
          placeName = component.long_name;
          break;
        }
      }
    }

    if (placeName) {
      reverseGeocodeCache.set(cacheKey, {
        result: placeName,
        expiresAt: Date.now() + REVERSE_GEOCODE_CACHE_TTL_MS,
      });
    }

    return placeName;
  } catch (err) {
    console.warn('[reverse-geocode] request failed:', err.message);
    return null;
  }
}

function setCachedPlaceName(lat, lng, placeName) {
  const cacheKey = reverseGeocodeCacheKey(lat, lng);
  reverseGeocodeCache.set(cacheKey, {
    result: placeName,
    expiresAt: Date.now() + REVERSE_GEOCODE_CACHE_TTL_MS,
  });
}

module.exports = {
  geolocateFromV,
  parseLteExtras,
  normalizeMac,
  isMacAddress,
  isPlaceholderCoords,
  cacheKey,
  clearGeolocationCache,
  reverseGeocodeToPlaceName,
  setCachedPlaceName,
};
