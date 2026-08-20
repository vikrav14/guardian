'use strict';

const {
  normalizeLocationSource,
  selectLocationForDisplay,
} = require('../src/location-provenance');

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function asIso(value) {
  if (!value) return null;
  const date = value?.toDate?.() || value;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function summarizeLocation(location, fallbackSource = null) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null;
  }
  return {
    source: normalizeLocationSource(location.source || fallbackSource),
    gpsValid: location.gpsValid === true,
    latitude: location.lat,
    longitude: location.lng,
    accuracyMeters: location.accuracyMeters ?? null,
    recordedAt: asIso(location.recordedAt),
    placeLabel: location.placeLabel || null,
  };
}

function inspectDeviceLocation(device) {
  const latest = device.lastLocationObservation || device.location || null;
  const latestSource = latest?.source || device.accuracySource || null;
  const selected = selectLocationForDisplay(device);
  const issues = [];

  if (normalizeLocationSource(latestSource) === 'gps' &&
      latest?.accuracyMeters != null) {
    issues.push(
      'Satellite packet inherited an accuracy radius. A fresh A packet after this release should clear it.'
    );
  }
  if (device.lastSatelliteLocation?.accuracyMeters != null) {
    issues.push('lastSatelliteLocation must not contain a WiFi/LBS radius.');
  }
  if (device.lastSatelliteLocation &&
      normalizeLocationSource(device.lastSatelliteLocation.source) !== 'gps') {
    issues.push('lastSatelliteLocation is not labelled gps.');
  }

  return {
    ok: issues.length === 0,
    watchOnline: device.online === true,
    lastHeartbeatAt: asIso(device.lastHeartbeatAt),
    latestObservation: summarizeLocation(latest, device.accuracySource),
    lastSatelliteLocation: summarizeLocation(
      device.lastSatelliteLocation,
      'gps'
    ),
    lastApproximateLocation: summarizeLocation(
      device.lastApproximateLocation
    ),
    displaySelection: {
      source: selected.source,
      retainedSatellite: selected.retainedSatellite,
      location: summarizeLocation(selected.location, selected.source),
    },
    precisionVerdict: device.lastSatelliteLocation
      ? 'Satellite validity is proven by gps=A. Metre-level precision is not proven because this V52 packet does not report a dependable accuracy radius.'
      : 'No retained satellite fix is available yet.',
    issues,
  };
}

async function main() {
  const imei = String(readArgument('imei') || '').trim();
  if (!/^\d{10,20}$/.test(imei)) {
    throw new Error('Usage: node scripts/inspect-location-provenance.js --imei <digits>');
  }

  // Lazy import keeps the pure inspection functions unit-testable without
  // initializing Firebase or loading credentials.
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');

  const snapshot = await db.collection('devices').doc(imei).get();
  if (!snapshot.exists) throw new Error(`devices/${imei} was not found.`);

  console.log(JSON.stringify({ imei, ...inspectDeviceLocation(snapshot.data() || {}) }, null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`ERROR: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  inspectDeviceLocation,
  summarizeLocation,
};
