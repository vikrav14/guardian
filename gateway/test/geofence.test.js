const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineMeters, evaluateGeofenceTransitions } = require('../src/geofence');

// Mimics real Firestore's where()-clause filtering (evaluateGeofenceTransitions
// relies on the query itself to exclude inactive/other-device zones, it does
// not re-check those fields in-process).
function fakeDb(geofenceDocs) {
  return {
    collection(name) {
      assert.equal(name, 'geofences');
      const filters = [];
      const query = {
        where(field, op, value) {
          assert.equal(op, '==');
          filters.push((d) => d.data[field] === value);
          return query;
        },
        async get() {
          const matched = geofenceDocs.filter((d) => filters.every((f) => f(d)));
          return { docs: matched.map((d) => ({ id: d.id, data: () => d.data })) };
        },
      };
      return query;
    },
  };
}

test('haversineMeters returns ~0 for identical points and a sane distance otherwise', () => {
  assert.ok(haversineMeters(-20.2642, 57.4791, -20.2642, 57.4791) < 1);
  // Port Louis to Grand Baie is roughly 20-25km.
  const d = haversineMeters(-20.1609, 57.5012, -20.0181, 57.5806);
  assert.ok(d > 15000 && d < 30000, `expected ~15-30km, got ${d}`);
});

// Each test uses its own IMEI + geofence id: evaluateGeofenceTransitions keeps
// in-memory inside/outside + cooldown state at module scope, so reusing a key
// across tests would leak state between them.

test('evaluateGeofenceTransitions seeds state on the first sample without alerting', async () => {
  const db = fakeDb([
    { id: 'seed-zone', data: { imei: 'SEED1', active: true, center: { lat: -20.2642, lng: 57.4791 }, radiusMeters: 100, name: 'Home' } },
  ]);
  const events = await evaluateGeofenceTransitions(db, 'SEED1', { lat: -20.2642, lng: 57.4791 });
  assert.deepEqual(events, []);
});

test('evaluateGeofenceTransitions emits geofence_exit when moving outside the radius', async () => {
  const db = fakeDb([
    { id: 'exit-zone', data: { imei: 'EXIT1', active: true, center: { lat: -20.2642, lng: 57.4791 }, radiusMeters: 100, name: 'Home' } },
  ]);
  await evaluateGeofenceTransitions(db, 'EXIT1', { lat: -20.2642, lng: 57.4791 }); // seed inside
  const events = await evaluateGeofenceTransitions(db, 'EXIT1', { lat: -20.30, lng: 57.50 }); // far outside
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'geofence_exit');
  assert.equal(events[0].payload.geofenceId, 'exit-zone');
});

test('evaluateGeofenceTransitions emits geofence_enter when a matching WiFi SSID is reported', async () => {
  const db = fakeDb([
    { id: 'wifi-zone', data: { imei: 'WIFI1', active: true, center: { lat: 0, lng: 0 }, radiusMeters: 50, name: 'Home', wifiSsid: 'Home WiFi' } },
  ]);
  await evaluateGeofenceTransitions(db, 'WIFI1', { lat: 10, lng: 10 }); // seed far away, outside
  const events = await evaluateGeofenceTransitions(db, 'WIFI1', { lat: 10, lng: 10, wifiSsid: 'home wifi' }); // still far by GPS, but SSID matches (case-insensitive)
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'geofence_enter');
  assert.equal(events[0].payload.viaWifi, true);
});

test('evaluateGeofenceTransitions ignores inactive zones and non-finite centers', async () => {
  const db = fakeDb([
    { id: 'inactive-zone', data: { imei: 'SKIP1', active: false, center: { lat: 0, lng: 0 }, radiusMeters: 50 } },
    { id: 'bad-center-zone', data: { imei: 'SKIP1', active: true, center: { lat: 'not-a-number', lng: 0 }, radiusMeters: 50 } },
  ]);
  const events = await evaluateGeofenceTransitions(db, 'SKIP1', { lat: 0, lng: 0 });
  assert.deepEqual(events, []);
});
