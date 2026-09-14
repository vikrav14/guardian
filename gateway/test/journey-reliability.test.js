'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JourneyJournal, restoreDates } = require('../src/journey-journal');
const { createJourneyReliability } = require('../src/journey-reliability');
const { recoverGpsHistory, pointsFromJourney, saveRecoveredJourney } = require('../src/journey-history-recovery');
const cache = require('../src/live-cache');

const imei = '123456789012345';
const base = Date.parse('2026-09-01T10:00:00Z');
const gps = (minute, lat = -20.25 + minute * 0.001) => ({ lat, lng: 57.5, source: 'gps', gpsValid: true,
  speedKmh: 5, recordedAt: new Date(base + minute * 60000) });
const route = () => [gps(0), gps(1, -20.248), gps(2, -20.244), gps(3, -20.245), gps(4, -20.248), gps(5, -20.25)];
const zones = [{ id: 'home', center: { lat: -20.25, lng: 57.5 }, radiusMeters: 50 }];
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-journal-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; }

function database() {
  const records = new Map(), writes = [];
  const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => records.get(ref.path) });
  function collection(prefix, filters = []) {
    return { doc: id => reference(`${prefix}/${id}`),
      where: (field, op, expected) => collection(prefix, [...filters, [field, op, expected]]),
      get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(prefix + '/') &&
        key.slice(prefix.length + 1).indexOf('/') < 0 && filters.every(([f, op, v]) => {
          const actual = records.get(key)[f]; return op === '==' ? actual === v : op === '>=' ? actual >= v : actual < v;
        })).map(key => snapshot(reference(key))) }) };
  }
  function reference(p) { return { path: p, id: p.split('/').at(-1), get: async () => snapshot(reference(p)),
    collection: name => collection(`${p}/${name}`) }; }
  const db = { collection, runTransaction: async fn => {
    const pending = [];
    const result = await fn({ get: ref => ref.get(), set: (ref, value) => pending.push([ref.path, value]),
      delete: ref => pending.push([ref.path, null]) });
    for (const [p,v] of pending) { writes.push(p); if (v) records.set(p,v); else records.delete(p); }
    return result;
  } };
  records.set('geofences/home', { ...zones[0], imei, active: true });
  return { db, records, writes };
}

test('delayed and duplicate GPS recover one truthful route using original observation times', () => {
  const points = route();
  const recovered = recoverGpsHistory([...points.slice().reverse(), points[2]], { zones });
  assert.equal(recovered.journeys.length, 1);
  const journey = recovered.journeys[0];
  assert.equal(journey.pointCount, 6);
  assert.equal(+journey.startAt, base);
  assert.equal(+journey.endAt, base + 300000);
  assert.deepEqual(journey.events, []);
  assert.equal(journey.closeReason, 'delayed_gps_recovery');
  assert.equal(journey.returnAt, undefined);
  assert.ok(journey.distanceKm > 1);
  assert.deepEqual(pointsFromJourney(journey).map(p => +p.recordedAt), points.map(p => +p.recordedAt));
});

test('network estimates, stationary Home noise, timestamps and isolated jumps cannot manufacture trips', () => {
  for (const points of [route().map(p => ({ ...p, gpsValid: false, source: 'wifi' })),
    [gps(0), gps(1, -20.2501), gps(2, -20.2499)], [gps(0), { ...gps(1), recordedAt: undefined }],
    [gps(0), gps(1, -21.3), gps(2)], route().map(p => ({ ...p, recordedAt: new Date(Date.now() + 86400000) }))]) {
    assert.equal(recoverGpsHistory(points, { zones }).journeys.length, 0);
  }
  const conflict = recoverGpsHistory([gps(0), gps(1), gps(1, -20.5)], { zones });
  assert.equal(conflict.journeys.length, 0);
  assert.equal(conflict.rejectedPoints, 1);
});

test('historical Home radio has priority only at its original valid time; route gaps stay gaps', () => {
  const points = route();
  const home = { version: 4, policy: 'enrolled_home_radio_v4', pilot: true, source: 'home_wifi', state: 'matched',
    anchor: { geofenceId: 'home', lat: -20.25, lng: 57.5, radiusMeters: 50 },
    observedAt: new Date(base).toISOString(), expiresAt: new Date(base + 120000).toISOString() };
  const result = recoverGpsHistory(points, { zones, homeIntervals: [home] });
  assert.equal(+result.journeys[0].startAt, base + 120000);
  const gap = recoverGpsHistory([gps(0), gps(1), gps(10), gps(11)]).journeys[0];
  assert.equal(gap.routeGaps.length, 1);
  assert.ok(gap.distanceKm < 0.3, 'unobserved gap distance must not be counted');
});

test('journal replays committed GPS, checkpoint and outbox after crash, ignoring an incomplete last append', t => {
  const directory = temporary(t), j = new JourneyJournal(directory);
  const point = gps(0), id = j.record(imei, point, new Date());
  const trip = recoverGpsHistory(route(), { zones }).journeys[0];
  j.checkpoint(imei, { currentJourney: { points: [point], startAt: point.recordedAt } }, [trip]);
  fs.appendFileSync(j.filename(imei) + '.wal', '{"interrupted":');
  const restored = new JourneyJournal(directory);
  assert.equal(restored.read(imei).points[id].status, 'recorded');
  assert.equal(restored.read(imei).checkpoint.currentJourney.points.length, 1);
  assert.equal(Object.keys(restored.read(imei).outbox).length, 1);
  restored.mark(imei, [id], 'live');
  assert.equal(new JourneyJournal(directory).read(imei).points[id].status, 'live');
  assert.ok(restoreDates(Object.values(restored.read(imei).outbox)[0]).startAt instanceof Date);
});

test('journal checksums and capacity fail explicitly, and only one runtime can own a directory', t => {
  const directory = temporary(t), j = new JourneyJournal(directory, { maxPoints: 1 });
  j.acquire();
  assert.throws(() => new JourneyJournal(directory).acquire(), /already_running/);
  j.release();
  j.record(imei, gps(0), new Date());
  assert.throws(() => j.record(imei, gps(1), new Date()), /capacity/);
  const wal = j.filename(imei) + '.wal';
  fs.writeFileSync(wal, fs.readFileSync(wal, 'utf8').replace('"status":"recorded"', '"status":"live"'));
  assert.throws(() => new JourneyJournal(directory).read(imei), /checksum/);
});

test('snapshot compaction preserves the latest state across restart', t => {
  const directory = temporary(t), j = new JourneyJournal(directory);
  const id = j.record(imei, gps(0), new Date());
  for (let i = 0; i < 515; i++) j.mark(imei, [id], i % 2 ? 'live' : 'home');
  assert.deepEqual(new JourneyJournal(directory).read(imei), j.read(imei));
  assert.ok(fs.statSync(j.filename(imei) + '.wal').size < 3000);
});

test('active live journey survives process restart and closes into the durable outbox at Home', t => {
  const directory = temporary(t);
  cache.resetCacheForTests();
  t.after(() => cache.resetCacheForTests());
  cache.configureJourneyPersistence(new JourneyJournal(directory));
  cache.trackPointForJourney(imei, gps(0), gps(0).recordedAt);
  cache.trackPointForJourney(imei, gps(1), gps(1).recordedAt);
  cache.resetCacheForTests();
  const j = new JourneyJournal(directory);
  cache.configureJourneyPersistence(j);
  assert.equal(cache.isJourneyActive(imei), true);
  cache.trackPointForJourney(imei, gps(2), gps(2).recordedAt);
  const closed = cache.suspendTrackingForHome(imei, gps(3).recordedAt);
  assert.equal(closed[0].pointCount, 3);
  assert.equal(Object.keys(new JourneyJournal(directory).read(imei).outbox).length, 1);
  assert.equal(new JourneyJournal(directory).read(imei).checkpoint.currentJourney, null);
});

test('journal read failure blocks journey changes while live alarm telemetry remains available', t => {
  cache.resetCacheForTests(); t.after(() => cache.resetCacheForTests());
  cache.configureJourneyPersistence({ read: () => { throw new Error('fixture unreadable journal'); } });
  assert.doesNotThrow(() => cache.getLiveDeviceState(imei));
  assert.doesNotThrow(() => cache.updateLiveState(imei, { location: gps(0), batteryPercent: 50 }));
  assert.equal(cache.getLiveDeviceState(imei).batteryPercent, 50);
  assert.throws(() => cache.trackPointForJourney(imei, gps(1)), /unreadable journal/);
  assert.throws(() => cache.suspendTrackingForHome(imei), /unreadable journal/);
});

test('outbox retains a failed Firestore write across restart and retries with real Date values', async t => {
  const directory = temporary(t), j = new JourneyJournal(directory);
  const trip = recoverGpsHistory(route(), { zones }).journeys[0];
  j.queue(imei, trip);
  const errors = [];
  const failed = createJourneyReliability({ journal: j, getDb: () => ({}),
    appendJourney: async () => { throw new Error('unavailable'); }, onError: e => errors.push(e) });
  await failed.flush();
  assert.equal(Object.keys(j.read(imei).outbox).length, 1);
  const saved = [];
  const retry = createJourneyReliability({ directory, getDb: () => ({}), report: () => {},
    appendJourney: async (_device, doc) => saved.push(doc) });
  await retry.flush(); await retry.flush();
  assert.equal(saved.length, 1);
  assert.ok(saved[0].startAt instanceof Date);
  assert.equal(+saved[0].startAt, base);
  assert.equal(Object.keys(retry.journal.read(imei).outbox).length, 0);
  assert.equal(errors.length, 1);
});

test('late GPS is durable before processing; current map routing and alarms remain separate', t => {
  const current = base + 3600000;
  const runtime = createJourneyReliability({ directory: temporary(t), now: () => current });
  const event = point => ({ imei, type: 'location', gpsValid: true, accuracySource: 'gps', location: point });
  const old = event(gps(1));
  runtime.capture(old, new Date(current));
  assert.equal(Object.values(runtime.journal.read(imei).points)[0].status, 'recorded');
  assert.equal(runtime.route(old, new Date(current)).live, false);
  assert.equal(runtime.route({ type: 'alarm', alarmType: 'sos', imei }).live, true);
  const fresh = event({ ...gps(2), recordedAt: new Date(current - 1000) });
  const selected = runtime.route(fresh, new Date(current));
  assert.equal(selected.live, true);
  runtime.processed(imei, selected.id);
  assert.equal(runtime.route(fresh, new Date(current)).reason, 'duplicate_record');
  assert.equal(runtime.route(event({ ...gps(3), recordedAt: new Date(current - 2000) }), new Date(current)).live, false);
  assert.equal(runtime.route(event({ ...gps(4), recordedAt: new Date(current + 1000) }), new Date(current)).live, false);
});

test('read-only preview and transactional retries never create duplicate journeys or late alerts', async () => {
  const { db, writes, records } = database();
  const trip = recoverGpsHistory(route(), { zones }).journeys[0];
  const preview = await saveRecoveredJourney(db, imei, trip);
  assert.equal(preview.outcome, 'preview'); assert.equal(writes.length, 0);
  assert.equal((await saveRecoveredJourney(db, imei, trip, { apply: true })).outcome, 'recovered');
  assert.equal((await saveRecoveredJourney(db, imei, trip, { apply: true })).outcome, 'already_recorded');
  assert.equal([...records.keys()].filter(p => p.includes('/journeys/')).length, 1);
  assert.ok(writes.every(p => p.includes('/journeys/') || p.startsWith('journeyRecoveryLocks/')));
});

test('recovery extends its own partial trace, invalidates presentation, and preserves confirmed boundaries', async () => {
  const { db, records, writes } = database();
  const points = route();
  const partial = recoverGpsHistory(points.slice(0, 3), { zones }).journeys[0];
  const first = await saveRecoveredJourney(db, imei, partial, { apply: true });
  const full = recoverGpsHistory(points, { zones }).journeys[0];
  const second = await saveRecoveredJourney(db, imei, full, { apply: true });
  assert.equal(first.id, second.id); assert.equal(second.points, 6);
  assert.ok(writes.some(p => p.endsWith('/presentations/google_v1')));
  const key = `devices/${imei}/journeys/${first.id}`;
  records.set(key, { ...partial, closeReason: 'return_to_origin', events: [{ type: 'outing_return' }], recovery: undefined });
  assert.equal((await saveRecoveredJourney(db, imei, full, { apply: true })).outcome, 'confirmed_boundary_requires_review');
  assert.equal(records.get(key).events[0].type, 'outing_return');
});

test('quiet delayed batch recovers automatically and restart/replay does not repeat it', async t => {
  const { db, records } = database(), directory = temporary(t), clock = base + 3600000;
  let now = clock;
  const runtime = createJourneyReliability({ directory, getDb: () => db, now: () => now,
    appendJourney: async () => {}, report: () => {}, onError: error => { throw new Error(error); } });
  for (const location of route()) runtime.route({ imei, type: 'location', gpsValid: true, location }, new Date(clock));
  await runtime.flush();
  assert.equal([...records.keys()].filter(p => p.includes('/journeys/')).length, 0);
  now += 61000;
  await runtime.flush(); await runtime.flush();
  assert.equal([...records.keys()].filter(p => p.includes('/journeys/')).length, 1);
  assert.ok(Object.values(new JourneyJournal(directory).read(imei).points).every(p => p.status === 'recovered'));
});

test('a restored live fragment joins delayed GPS after fresh Home, without needing another GPS packet', async t => {
  const { db, records } = database(), directory = temporary(t), clock = base + 3600000;
  const j = new JourneyJournal(directory, { now: () => clock + 61000 }), points = route();
  const partial = recoverGpsHistory(points.slice(0, 3), { zones }).journeys[0];
  const home = { version: 4, state: 'matched' };
  let closed = false;
  const runtime = createJourneyReliability({ journal: j, getDb: () => db, now: () => clock + 61000,
    readHomeEvidence: () => home, closeAtHome: () => {
      if (closed) return []; closed = true;
      j.checkpoint(imei, { currentJourney: null }, [partial]); return [partial];
    }, appendJourney: async (_imei, trip) => {
      records.set(`devices/${imei}/journeys/partial`, { ...trip, recovery: undefined, closeReason: 'home_wifi_detected' });
    }, report: () => {}, onError: error => { throw new Error(error); } });
  j.checkpoint(imei, { currentJourney: { startAt: points[0].recordedAt, points: points.slice(0, 3) } });
  for (const point of points.slice(0, 3)) { const id = j.record(imei, point, new Date(base)); j.mark(imei, [id], 'live'); }
  for (const location of points.slice(3)) runtime.route({ imei, type: 'location', gpsValid: true, location }, new Date(clock));
  await runtime.flush();
  const trips = [...records.entries()].filter(([p]) => p.includes('/journeys/'));
  assert.equal(trips.length, 1, JSON.stringify(trips));
  assert.equal(trips[0][1].pointCount, 6);
  assert.equal(j.read(imei).checkpoint.currentJourney, null);
});

test('a previously recorded baseline before a long idle does not inflate an outing at Home', () => {
  const points = [gps(0), gps(15, -20.25), gps(17, -20.248), gps(18, -20.244),
    gps(20, -20.242), gps(44, -20.242), gps(47, -20.246), gps(50, -20.25)];
  const result = recoverGpsHistory(points, { zones });
  assert.equal(result.journeys.length, 1);
  assert.equal(+result.journeys[0].startAt, base + 15 * 60000);
  assert.equal(result.journeys[0].routeGaps[0].durationSeconds, 24 * 60);
});
