'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../src/predictive-pilot/models');
const o = require('../src/predictive-pilot/observer');
const { atomicJson, lock, reportText } = require('../scripts/predictive-pilot');
const { MINUTE, HOUR, DAY } = m;
const now = Date.parse('2026-10-08T06:00:00Z'); // Thursday, 10:00 Mauritius.
const imei = '000000000000001';
const home = { id: 'home', center: { lat: -20, lng: 57 }, radiusMeters: 150 };
const device = () => ({ batteryPercent: 45, batteryUpdatedAt: now, lastHeartbeatAt: now,
  lastSatelliteLocation: { lat: -20.1, lng: 57.1, source: 'gps', gpsValid: true, recordedAt: now } });
function journey(at = now - DAY + 4 * HOUR, extra = {}) {
  return { departureAt: at - HOUR, returnAt: at, originGeofenceId: 'home', closeReason: 'return_to_origin',
    evidenceVersion: 3, pointCount: 10, routeStartAnchored: true,
    departureEvidence: { classification: 'outside', source: 'gps', gpsValid: true, recordedAt: at - HOUR },
    returnEvidence: { classification: 'inside', source: 'gps', gpsValid: true, recordedAt: at }, ...extra };
}
function history() {
  const rows = [];
  for (let i = 1; i <= 12; i++) if (m.dayKind(now - i * DAY) === 'weekday') rows.push(journey(now - i * DAY + 4 * HOUR));
  return rows;
}
function arrival(extra = {}) { return m.arrivalForecast({ returns: m.homeReturns(history(), home, now), home, device: device(), now, ...extra }); }
function samples(end = now, endPercent = 45) { return [0, 1, 2, 3].map(i => ({ at: end - (3 - i) * 30 * MINUTE, percent: endPercent + (3 - i) * 5 })); }

test('return labels exclude approximate, incomplete, future and unanchored histories', () => {
  const at = now - DAY + 4 * HOUR;
  const invalid = [{ evidenceVersion: undefined }, { pointCount: undefined }, { closeReason: 'idle' }, { routeStartAnchored: false },
    { originGeofenceId: 'school' }, { returnAt: now + HOUR }, { returnEvidence: { classification: 'inside', source: 'wifi', gpsValid: false, recordedAt: at } },
    { returnEvidence: { classification: 'inside', source: 'gps', gpsValid: true, viaWifi: true, recordedAt: at } }];
  assert.equal(m.homeReturns(invalid.map(extra => journey(at, extra)), home, now).length, 0);
  assert.equal(m.homeReturns([journey(at), journey(at + HOUR)], home, now)[0].at, at);
  assert.equal(m.homeReturns([journey(at)], { ...home, updatedAt: at + 1 }, now).length, 0);
});
test('arrival learns only distinct prior comparable days, with prospective lead time', () => {
  const prediction = arrival();
  assert.equal(prediction.status, 'forecast');
  assert(prediction.evidenceThrough < m.dayStart(now));
  assert(prediction.lowerAt > now + 30 * MINUTE);
  assert.equal(m.localMinute(prediction.midpointAt), 14 * 60);
  const one = m.homeReturns([history()[0]], home, now)[0];
  assert.equal(arrival({ returns: Array(8).fill(one) }).reason, 'need_six_comparable_days');
  assert.equal(arrival({ returns: [...m.homeReturns(history(), home, now), { day: m.localDay(now), at: now, kind: 'weekday', minute: 600 }] }).reason, 'afternoon_return_already_recorded');
});
test('Mauritius dates and weekend grouping do not use the host timezone', () => {
  const fridayEveningUtc = Date.parse('2026-10-09T21:00:00Z');
  assert.equal(m.localDay(fridayEveningUtc), '2026-10-10');
  assert.equal(m.dayKind(fridayEveningUtc), 'weekend');
  assert.equal(m.localMinute(fridayEveningUtc), 60);
});
test('arrival withholds on stale GPS/connection, Home presence, late or incomplete evidence', () => {
  const stale = device(); stale.lastSatelliteLocation.recordedAt = now - 21 * MINUTE;
  assert.equal(arrival({ device: stale }).reason, 'fresh_gps_required');
  const future = device(); future.lastHeartbeatAt = now + 1;
  assert.equal(arrival({ device: future }).reason, 'watch_connection_stale');
  const inside = device(); Object.assign(inside.lastSatelliteLocation, home.center);
  assert.equal(arrival({ device: inside }).reason, 'departure_not_established');
  assert.equal(arrival({ historyComplete: false }).reason, 'history_query_truncated');
  assert.equal(arrival({ now: now + 4 * HOUR }).reason, 'too_late_for_prospective_forecast');
  assert.equal(arrival({ returns: [] }).reason, 'need_six_comparable_days');
});
test('battery requires its own fresh timestamp and a real discharge segment', () => {
  assert.equal(m.batterySample({ batteryPercent: 50, lastHeartbeatAt: now, updatedAt: now }, now), null);
  assert.equal(m.batterySample({ batteryPercent: 50, batteryUpdatedAt: now + 1 }, now), null);
  const p = m.batteryForecast({ samples: samples(), device: device(), now });
  assert.equal(p.status, 'forecast'); assert(p.lowerAt > now); assert(p.upperAt < now + 12 * HOUR);
  assert.equal(m.batteryForecast({ samples: Array(10).fill(samples()[0]), device: device(), now }).status, 'withheld');
  const charged = [...samples(), { at: now + 10 * MINUTE, percent: 80 }];
  assert.equal(m.dischargeSegment(charged, now + 10 * MINUTE).length, 1);
  assert.equal(m.dischargeSegment([...samples(), { at: now + HOUR, percent: 44 }], now + HOUR).length, 1);
});
test('battery rejects flat, distant and stale discharge predictions', () => {
  const flat = samples().map(s => ({ ...s, percent: 45 }));
  assert.equal(m.batteryForecast({ samples: flat, device: device(), now }).reason, 'need_stable_discharge_history');
  assert.equal(m.batteryForecast({ samples: samples(), device: { ...device(), batteryUpdatedAt: now - HOUR }, now }).reason, 'fresh_battery_and_connection_required');
  assert.equal(m.batteryForecast({ samples: samples(now, 15), device: { ...device(), batteryPercent: 15 }, now }).reason, 'already_at_reserve_threshold');
});
test('battery scoring brackets crossings and invalidates charging and observation gaps', () => {
  const p = { kind: 'battery', issuedAt: now, evidenceThrough: now, startingPercent: 20, lowerAt: now + 10 * MINUTE, upperAt: now + 40 * MINUTE };
  const score = rows => m.evaluate(p, { samples: rows, now: now + HOUR });
  assert.equal(score([{ at: now, percent: 20 }, { at: now + 20 * MINUTE, percent: 18 }, { at: now + 30 * MINUTE, percent: 15 }]).withinWindow, true);
  assert.equal(score([{ at: now, percent: 20 }, { at: now + 20 * MINUTE, percent: 15 }]).status, 'inconclusive');
  assert.equal(score([{ at: now, percent: 20 }, { at: now + 5 * MINUTE, percent: 15 }]).withinWindow, false);
  assert.equal(score([{ at: now, percent: 20 }, { at: now + 5 * MINUTE, percent: 40 }]).reason, 'possible_charging_or_rebound');
  assert.equal(score([{ at: now, percent: 20 }, { at: now + HOUR, percent: 15 }]).reason, 'battery_observation_gap');
  assert.equal(score([]).reason, 'baseline_observation_missing');
});
test('arrival scores subsequent facts without fabricating a missing return', () => {
  const p = arrival();
  assert.equal(m.evaluate(p, { returns: [{ day: p.day, at: p.midpointAt }], now: p.upperAt, samples: [] }).withinWindow, true);
  assert.equal(m.evaluate(p, { returns: [], now: now + 2 * DAY, samples: [] }).status, 'inconclusive');
});

function harness(extraConfig = {}) {
  const c = o.validateConfig({ imei, uid: 'owner', ownerUid: 'owner', homeZoneId: 'home', projectId: 'guardian-test',
    outputDirectory: path.join(os.tmpdir(), 'guardian-pilot-test'), startedAt: now - HOUR, endsAt: now + 13 * DAY, ...extraConfig });
  const service = { ownerUid: 'owner', subscription: { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' }, members: { owner: { status: 'active' } } };
  const rows = new Map([[`familyServices/${imei}`, service], [`devices/${imei}`, device()], ['geofences/home', { ...home, imei, active: true }]]);
  let reads = 0, saved, onRead = () => {}, journeys = history(), queries = 0;
  const trace = [];
  function ref(key, query = false) {
    return { doc: id => ref(key + '/' + id), collection: name => ref(key + '/' + name, true),
      where: (...v) => { trace.push(['where', ...v]); return ref(key, true); },
      orderBy: (...v) => { trace.push(['orderBy', ...v]); return ref(key, true); },
      limit: n => { assert.equal(n, 121); return ref(key, true); },
      select: (...fields) => { assert(!fields.includes('polyline')); return ref(key, true); },
      get: async () => {
        reads++; assert(saved, 'reservation must be persisted before reads'); onRead(key, reads);
        if (query) { queries++; return { docs: journeys.map(data => ({ data: () => data })) }; }
        return { data: () => rows.get(key) };
      } };
  }
  // No set/update/delete, batch, transaction, watches, messaging or provider API.
  const db = { collection: name => ref(name) };
  const h = { c, rows, trace, db, state: o.initialState(c), save: value => { saved = JSON.parse(JSON.stringify(value)); },
    run: async (at = now) => o.poll({ db, config: c, state: h.state, save: h.save, now: at }),
    reads: () => reads, queries: () => queries, saved: () => saved,
    onRead: fn => { onRead = fn; }, journeys: value => { journeys = value; } };
  return h;
}
test('observer reserves reads, stays local, freezes forecasts, and deduplicates evidence across restarts', async () => {
  const h = harness(); await h.run();
  assert.equal(h.state.status, 'observing'); assert.equal(h.state.budget[m.localDay(now)], 125);
  assert.equal(h.state.forecasts.length, 1); assert.equal(h.state.samples.length, 1);
  const original = { ...h.state.forecasts[0] }; delete original.outcome;
  h.state = JSON.parse(JSON.stringify(h.saved())); await h.run(now + 10 * MINUTE);
  assert.equal(h.queries(), 1); assert.equal(h.state.samples.length, 1); assert.equal(h.state.forecasts.length, 1);
  const after = { ...h.state.forecasts[0] }; delete after.outcome; assert.deepEqual(after, original);
  const text = reportText(o.report(h.state, h.c, now));
  assert(text.includes('Paid AI calls: 0')); assert(!text.includes(imei)); assert(!JSON.stringify(h.state).includes(imei));
});
test('access revocation before collection prevents device/history reads and purges local evidence', async () => {
  const h = harness(); await h.run(); h.rows.get(`familyServices/${imei}`).members.owner.status = 'revoked';
  const before = h.reads(); await h.run(now + 10 * MINUTE);
  assert.equal(h.reads() - before, 1); assert.equal(h.state.status, 'access_not_shared');
  assert.deepEqual(h.state.forecasts, []); assert.deepEqual(h.state.samples, []); assert.equal(h.state.history, null);
});
test('revocation during collection discards newly fetched data', async () => {
  const h = harness(); h.onRead((key, n) => { if (n === 5) h.rows.get(`familyServices/${imei}`).members.owner.status = 'revoked'; });
  await h.run(); assert.equal(h.state.status, 'access_not_shared'); assert.equal(h.state.history, null); assert.equal(h.state.samples.length, 0);
});
test('access expiry during a slow poll is rechecked against the current clock', async () => {
  const h = harness(); h.rows.get(`familyServices/${imei}`).members.owner.untilMs = now + MINUTE;
  let checks = 0;
  await o.poll({ db: h.db, config: h.c, state: h.state, save: h.save, now, accessNow: () => now + (++checks === 1 ? 0 : 2 * MINUTE) });
  assert.equal(h.state.status, 'access_not_shared'); assert.equal(h.state.samples.length, 0);
});
test('expired membership, changed owner and inactive service fail closed', async () => {
  for (const change of [s => { s.members.owner.untilMs = now; }, s => { s.ownerUid = 'different'; }, s => { s.subscription.status = 'expired'; }]) {
    const h = harness(); change(h.rows.get(`familyServices/${imei}`)); await h.run();
    assert.notEqual(h.state.status, 'observing'); assert.equal(h.reads(), 1);
  }
});
test('query truncation withholds arrival and invalidates pending arrival scoring', async () => {
  const h = harness(); h.journeys(Array(121).fill(history()[0])); await h.run();
  assert.equal(h.state.decisions.arrival.reason, 'history_query_truncated'); assert.equal(h.state.forecasts.length, 0);
});
test('Home changes discard old forecasts and cached labels', async () => {
  const h = harness(); await h.run(); h.rows.get('geofences/home').updatedAt = now + MINUTE;
  await h.run(now + 10 * MINUTE); assert.equal(h.queries(), 2); assert.equal(h.state.forecasts.length, 0);
  assert.equal(h.state.history.returns.length, 0);
});
test('persistent read cap covers failures, and no query is attempted without its full reservation', async () => {
  const h = harness(); h.state.budget[m.localDay(now)] = 796; await h.run();
  assert.equal(h.state.status, 'daily_read_cap_reached'); assert.equal(h.queries(), 0); assert.equal(h.reads(), 3);
  h.state = h.saved(); await h.run(now + 10 * MINUTE); assert.equal(h.state.budget[m.localDay(now)], 800);
  const reads = h.reads(); await h.run(now + 20 * MINUTE); assert.equal(h.reads(), reads);
  const failing = harness(); failing.onRead(() => { throw new Error('private network error'); }); await failing.run();
  assert.equal(failing.state.budget[m.localDay(now)], 1); assert.equal(failing.state.status, 'read_failed');
});
test('budget resets at Mauritius midnight; ended pilots read nothing; invalid configs/state fail closed', async () => {
  const h = harness(); h.state.budget[m.localDay(now)] = 800; await h.run(now + DAY);
  assert.equal(h.state.budget[m.localDay(now + DAY)], 125);
  const reads = h.reads(); await h.run(h.c.endsAt); assert.equal(h.state.status, 'complete'); assert.equal(h.reads(), reads);
  assert.throws(() => harness({ endsAt: now + 15 * DAY }), /duration/);
  assert.throws(() => harness({ uid: 'someone-else' }), /config/);
  h.state.budget[m.localDay(now)] = -1; assert.throws(() => o.checkState(h.state, h.c), /state_mismatch/);
});
test('atomic checkpoint and exclusive process lock preserve restart state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-pilot-'));
  try {
    const release = lock(dir); assert.throws(() => lock(dir), /already_running/);
    const file = path.join(dir, 'state.json'); atomicJson(file, { count: 1 }); atomicJson(file, { count: 2 });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 2); release();
    assert(!fs.existsSync(path.join(dir, 'observer.lock')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
