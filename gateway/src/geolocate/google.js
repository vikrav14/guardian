const crypto = require('crypto');

const config = require('../config');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { result: object, expiresAt: number }>} */
const cache = new Map();

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
    if (!field || !isMacAddress(field)) continue;

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

  const firstMacIdx = extras.findIndex((f) => isMacAddress(f?.trim()));
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

  if (cellFields.length >= 4) {
    const mcc = parseInt(cellFields[0], 10);
    const mnc = parseInt(cellFields[1], 10);
    const lac = parseInt(cellFields[2], 10);
    const cellId = parseInt(cellFields[3], 10);

    if (isValidMcc(mcc) && !Number.isNaN(mnc) && !Number.isNaN(lac) && !Number.isNaN(cellId)) {
      const primary = {
        mobileCountryCode: mcc,
        mobileNetworkCode: mnc,
        locationAreaCode: lac,
        cellId,
      };
      let idx = 4;

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
        if (Number.isNaN(nLac) || Number.isNaN(nCellId)) break;

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
}

module.exports = {
  geolocateFromV,
  parseLteExtras,
  normalizeMac,
  isMacAddress,
  isPlaceholderCoords,
  cacheKey,
  clearGeolocationCache,
};
