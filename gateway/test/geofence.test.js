const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineMeters,
  evaluateGeofenceTransitions,
  getGeofencePresence,
  resetGeofenceStateForTests,
} = require('../src/geofence');

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
test('approximate boundary drift does not emit a false Home exit', async () => {
  resetGeofenceStateForTests();

  const db = fakeDb([
    {
      id: 'home-drift',
      data: {
        imei: 'DRIFT1',
        active: true,
        center: { lat: -20.2642, lng: 57.4791 },
        radiusMeters: 100,
        name: 'Home',
      },
    },
  ]);

  await evaluateGeofenceTransitions(db, 'DRIFT1', {
    lat: -20.2642,
    lng: 57.4791,
    accuracyMeters: 80,
  });

  // Roughly 120m from center: raw coordinates are outside a 100m circle, but
  // an 80m approximate fix overlaps the boundary, so remain inside.
  const jitterEvents = await evaluateGeofenceTransitions(db, 'DRIFT1', {
    lat: -20.26312,
    lng: 57.4791,
    accuracyMeters: 80,
  });

  assert.deepEqual(jitterEvents, []);

  const presence = getGeofencePresence('DRIFT1');
  assert.equal(presence.hasActiveZones, true);
  assert.equal(presence.insideAny, true);
  assert.deepEqual(presence.insideZoneIds, ['home-drift']);
});

test('clearly outside fix still emits Home exit after boundary protection', async () => {
  resetGeofenceStateForTests();

  const db = fakeDb([
    {
      id: 'home-real-exit',
      data: {
        imei: 'EXIT2',
        active: true,
        center: { lat: -20.2642, lng: 57.4791 },
        radiusMeters: 100,
        name: 'Home',
      },
    },
  ]);

  await evaluateGeofenceTransitions(db, 'EXIT2', {
    lat: -20.2642,
    lng: 57.4791,
    accuracyMeters: 80,
  });

  // ~220m from center, beyond radius + capped uncertainty (100 + 50).
  const events = await evaluateGeofenceTransitions(db, 'EXIT2', {
    lat: -20.26222,
    lng: 57.4791,
    accuracyMeters: 80,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'geofence_exit');

  const presence = getGeofencePresence('EXIT2');
  assert.equal(presence.hasActiveZones, true);
  assert.equal(presence.insideAny, false);
});

test('real V52 supermarket WiFi uncertainty cannot manufacture a Home exit', async () => {
  resetGeofenceStateForTests();

  const home = { lat: -20.029234, lng: 57.5957028 };
  const db = fakeDb([
    {
      id: 'home-real-device',
      data: {
        imei: 'REALV52',
        active: true,
        center: home,
        radiusMeters: 150,
        name: 'Home',
      },
    },
  ]);

  await evaluateGeofenceTransitions(db, 'REALV52', {
    ...home,
    source: 'gps',
    gpsValid: true,
    satellites: 10,
  });

  const events = await evaluateGeofenceTransitions(db, 'REALV52', {
    lat: -20.0242989,
    lng: 57.5912873,
    source: 'wifi',
    gpsValid: false,
    accuracyMeters: 581.672,
    satellites: 0,
    recordedAt: new Date('2026-08-17T08:10:00.000Z'),
  });

  assert.deepEqual(events, []);
  const presence = getGeofencePresence('REALV52');
  assert.equal(presence.insideAny, true);
  assert.equal(presence.hasUncertainZones, true);
  assert.deepEqual(presence.uncertainZoneIds, ['home-real-device']);
});

test('approximate fix without an accuracy radius remains unknown and cannot seed departure', async () => {
  resetGeofenceStateForTests();

  const db = fakeDb([
    {
      id: 'home-no-radius',
      data: {
        imei: 'NOACCURACY',
        active: true,
        center: { lat: -20.2642, lng: 57.4791 },
        radiusMeters: 150,
        name: 'Home',
      },
    },
  ]);

  const events = await evaluateGeofenceTransitions(db, 'NOACCURACY', {
    lat: -20.25,
    lng: 57.49,
    source: 'lbs',
    gpsValid: false,
  });

  assert.deepEqual(events, []);
  const presence = getGeofencePresence('NOACCURACY');
  assert.equal(presence.hasActiveZones, true);
  assert.equal(presence.insideAny, false);
  assert.equal(presence.hasUncertainZones, true);
});

test('explicitly invalid GPS without accuracy remains uncertain', async () => {
  resetGeofenceStateForTests();
  const db = fakeDb([
    {
      id: 'home-invalid-gps',
      data: {
        imei: 'INVALIDGPS',
        active: true,
        center: { lat: -20.0292, lng: 57.5959 },
        radiusMeters: 150,
        name: 'Home',
      },
    },
  ]);

  await evaluateGeofenceTransitions(db, 'INVALIDGPS', {
    lat: -20.0292,
    lng: 57.5959,
    source: 'gps',
    gpsValid: false,
  });

  const presence = getGeofencePresence('INVALIDGPS');
  assert.equal(presence.insideAny, false);
  assert.equal(presence.hasUncertainZones, true);
});

test('transition payload retains the location evidence used for the decision', async () => {
  resetGeofenceStateForTests();

  const db = fakeDb([
    {
      id: 'evidence-zone',
      data: {
        imei: 'EVIDENCE1',
        active: true,
        center: { lat: -20.2642, lng: 57.4791 },
        radiusMeters: 100,
        name: 'Home',
      },
    },
  ]);

  await evaluateGeofenceTransitions(db, 'EVIDENCE1', {
    lat: -20.2642,
    lng: 57.4791,
    source: 'gps',
    gpsValid: true,
    satellites: 8,
  });

  const events = await evaluateGeofenceTransitions(db, 'EVIDENCE1', {
    lat: -20.261,
    lng: 57.4791,
    source: 'gps',
    gpsValid: true,
    satellites: 7,
    recordedAt: new Date('2026-08-17T08:20:00.000Z'),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'geofence_exit');
  assert.equal(events[0].payload.observationEvidence.source, 'gps');
  assert.equal(events[0].payload.observationEvidence.gpsValid, true);
  assert.equal(events[0].payload.observationEvidence.satellites, 7);
  assert.equal(
    events[0].payload.observationEvidence.recordedAt.toISOString(),
    '2026-08-17T08:20:00.000Z'
  );
});
