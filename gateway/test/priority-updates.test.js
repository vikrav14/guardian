'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPriorityUpdates, mediaCandidate, priorityLocation } = require('../src/context/priorityUpdates');
const { DefiMediaRssProvider } = require('../src/context/defiMediaRssProvider');
const { refreshTemporalState } = require('../src/context/capAlertProvider');
const { startPriorityUpdateScheduler } = require('../src/context/priorityUpdateScheduler');
const now = Date.parse('2026-10-07T12:00:00Z');
const iso = offset => new Date(now + offset * 60000).toISOString();
const location = { lat: -20.028, lng: 57.596, source: 'gps', recordedAt: iso(-2) };
const device = { lastLocationObservation: location };
const report = (overrides = {}) => ({ id: 'news-1', title: 'Grand Baie : fusillade en cours',
  sourceUrl: 'https://defimedia.info/current-report', publishedAt: iso(-10), ...overrides });
const media = items => ({ items, lastSuccessAt: iso(-1), lastPollAt: iso(-1), lastError: null });
const official = (overrides = {}) => ({ id: 'cap-1', headline: 'Heavy rain warning', active: true,
  status: 'actual', scope: 'public', messageType: 'alert', certainty: 'likely', urgency: 'expected',
  severity: 'severe', sentAt: iso(-5), effectiveAt: iso(-5), expiresAt: iso(60),
  sourceUrl: 'https://cap-sources.s3.amazonaws.com/mu-mms-en/warning.xml',
  areas: [{ description: 'Mauritius', polygons: [], circles: [] }], ...overrides });
const cap = alerts => ({ activeAlerts: alerts, lastSuccessAt: iso(-1), lastPollAt: iso(-1) });
const build = overrides => buildPriorityUpdates({ device, media: media([report()]),
  resolvePlace: async () => location, now, ...overrides });

test('only explicit current local events qualify; historical, vague and negated crime does not', () => {
  for (const title of ['Grand Baie : fusillade en cours', 'The Vale : incendie toujours en cours',
    'Grand-Baie : road closed until further notice', 'Lower Vale : power outage ongoing']) {
    assert.ok(mediaCandidate(report({ title }), now), title);
  }
  for (const title of ['Grand Baie : enquête en cours après une fusillade',
    'Grand Baie : fusillade hier, route toujours bloquée', 'Grand Baie : fusillade en cours ?',
    'Grand Baie : aucune fusillade actuellement', 'Grand Baie : rumeur de fusillade en cours',
    'Grand Baie : incendie maîtrisé, pompiers toujours présents', 'Grand Baie : un homme arrêté',
    'Un habitant de Grand Baie raconte une fusillade en cours', 'Grand Baie : fusillade en cours à Moka',
    'Pamplemousses district : fusillade en cours', 'Grand Baie : concert en cours',
    'Grand Baie : fusillade', 'Maurice : fusillade en cours']) {
    assert.equal(mediaCandidate(report({ title }), now), null, title);
  }
  for (const overrides of [{ publishedAt: iso(-90) }, { publishedAt: iso(2) },
    { publishedAt: null }, { sourceUrl: 'https://defimedia.info.evil.test/a' },
    { priorityPublishedAt: iso(-120) }]) {
    assert.equal(mediaCandidate(report(overrides), now), null);
  }
});

test('report requires precise, recent watch area, not district membership or a stale GPS', async () => {
  const value = await build();
  assert.equal(value.items.length, 1);
  assert.match(value.items[0].matchReason, /exact position is not supplied/);
  assert.equal(value.items[0].expiresAt, iso(13));
  for (const fix of [{ ...location, recordedAt: iso(-15) }, { ...location, recordedAt: iso(2) },
    { ...location, lat: -20.10 }, { ...location, source: 'lbs', accuracyMeters: 1001 },
    { ...location, source: 'wifi' }, { ...location, lat: 0, lng: 0 }, { ...location, lat: 95 }]) {
    assert.deepEqual((await build({ device: { lastLocationObservation: fix } })).items, []);
  }
  assert.equal((await build({ resolvePlace: async () => { throw Error('unresolved'); } })).items.length, 0);
  assert.equal((await build({ resolvePlace: async () => ({ lat: location.lat + .007, lng: location.lng }),
    device: { lastLocationObservation: { ...location, source: 'wifi', accuracyMeters: 900 } } })).items.length, 0);
});

test('qualified Home wins; expiration cannot resurrect the earlier trip', () => {
  const home = { version: 4, policy: 'enrolled_home_radio_v4', pilot: true, state: 'matched',
    source: 'home_wifi', observedAt: iso(-.5), expiresAt: iso(1.5),
    anchor: { geofenceId: 'home', label: 'Home', lat: -20.05, lng: 57.59, radiusMeters: 100 } };
  const remembered = { ...home, version: 1, policy: 'last_detected_home_v1',
    qualifiedUntil: home.expiresAt, bindingHash: 'a'.repeat(64) };
  const d = { ...device, homeWifiPresence: home, lastHomeWifiDetection: remembered };
  assert.equal(priorityLocation(d, now).source, 'home_wifi');
  assert.equal(priorityLocation(d, now).expiresAt, home.expiresAt);
  assert.equal(priorityLocation(d, now + 120000), null);
  assert.equal(priorityLocation({ lastHomeWifiDetection: remembered }, now), null);
  assert.equal(priorityLocation({ ...d, lastLocationObservation: { ...location, recordedAt: iso(2) } }, now + 120000).source, 'gps');
});

test('source health, event expiry, source lease and rank remain independent', async () => {
  assert.equal((await build({ media: { ...media([report()]), lastError: 'offline' } })).items.length, 0);
  assert.equal((await build({ media: { ...media([report()]), lastSuccessAt: iso(-30) } })).items.length, 0);
  const value = await build({ cap: cap([official()]) });
  assert.equal(value.items[0].kind, 'official_warning');
  assert.equal(value.items[0].expiresAt, iso(9));
  const ordered = await build({ cap: cap([official({ severity: 'moderate' })]) });
  assert.equal(ordered.items[0].kind, 'local_report');
  const duplicates = await build({ media: media([report(), report({ id: 'copy' })]) });
  assert.equal(duplicates.items.length, 1);
});

test('CAP must be actual, public, current, geographically applicable and sufficiently certain', async () => {
  for (const changes of [{ status: 'test' }, { active: false }, { scope: 'private' },
    { messageType: 'cancel' }, { certainty: 'possible' }, { severity: 'minor' }, { urgency: 'past' },
    { effectiveAt: iso(5) }, { expiresAt: iso(-1) }, { sourceUrl: 'https://example.com/alert' },
    { areas: [{ description: 'Rodrigues', polygons: [], circles: [] }] },
    { areas: [{ description: 'Open sea', polygons: [], circles: [] }] }]) {
    const result = await build({ media: null, cap: cap([official(changes)]) });
    assert.equal(result.items.length, 0, JSON.stringify(changes));
  }
  const nearEdge = official({ areas: [{ description: 'Warning area', polygons: [], circles: ['-20.028,57.596 0.5'] }] });
  assert.equal((await build({ media: null, cap: cap([nearEdge]), device: {
    lastLocationObservation: { ...location, source: 'wifi', accuracyMeters: 900 } } })).items.length, 0);
  for (const inactiveReason of ['cancelled_by_reference', 'superseded_by_update', 'removed_from_authoritative_feed']) {
    assert.equal(refreshTemporalState({ ...official(), active: false, inactiveReason }, new Date(now)).active, false);
  }
});

test('RSS current snapshot excludes withdrawals, keeps 304, and does not re-date repeated headlines', async () => {
  const title = 'Grand Baie : fusillade en cours';
  const rss = (id, date = iso(-10)) => `<rss><channel><title>Défi Media</title>${id ? `<item><title>${title}</title><guid>${id}</guid><link>https://defimedia.info/${id}</link><pubDate>${date}</pubDate></item>` : ''}</channel></rss>`;
  let response = { statusCode: 200, body: rss('one'), headers: {} };
  const provider = new DefiMediaRssProvider({}, { fetchText: async () => response });
  await provider.poll({ now: new Date(now) });
  const original = provider.getPrioritySnapshot().items[0].publishedAt;
  response = { statusCode: 304 };
  await provider.poll({ now: new Date(now + 60000) });
  assert.equal(provider.getPrioritySnapshot().items.length, 1);
  response = { statusCode: 200, body: rss('two', iso(1)), headers: {} };
  await provider.poll({ now: new Date(now + 60000) });
  assert.equal(provider.getPrioritySnapshot().items[0].priorityPublishedAt, original);
  response = { statusCode: 200, body: rss(null), headers: {} };
  await provider.poll({ now: new Date(now + 120000) });
  assert.equal(provider.getPrioritySnapshot().items.length, 0);
  response = { statusCode: 200, body: '<broken/>', headers: { etag: 'bad-snapshot' } };
  assert.equal((await provider.poll({ now: new Date(now + 180000) })).ok, false);
  assert.equal(provider.etag, null);
});

test('scheduler is opt-in, pilot bounded, idempotent, and clears projections when source fails', async () => {
  const writes = [];
  let reads = 0, snapshot = media([report()]);
  const db = { collection: name => { assert.equal(name, 'devices'); return { doc: id => ({
    get: async () => { ++reads; return { id, exists: true, data: () => device }; },
    collection: name => { assert.equal(name, 'localUpdates'); return { doc: key => ({
      set: async value => { assert.equal(key, 'current'); writes.push({ id, value }); },
    }) }; },
  }) }; } };
  assert.equal(startPriorityUpdateScheduler({ db }).active, false);
  assert.equal(startPriorityUpdateScheduler({ db, config: { priorityUpdatesEnabled: true,
    priorityUpdateImeis: ['bad'] }, onError: () => {} }).active, false);
  const config = { priorityUpdatesEnabled: true, priorityUpdateImeis: ['359633100123456'], contextDefiMediaEnabled: true };
  const scheduler = startPriorityUpdateScheduler({ db, config, now: () => now,
    mediaProvider: { getPrioritySnapshot: () => snapshot }, resolvePlace: async () => location });
  try {
    await scheduler.runNow();
    await scheduler.runNow();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].value.items.length, 1);
    snapshot = { ...snapshot, lastError: 'offline' };
    await scheduler.runNow();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].value.items, []);
    const priorReads = reads;
    await scheduler.runNow();
    assert.equal(reads, priorReads);
    assert.equal(writes.length, 2);
  } finally { scheduler.stop(); }
});

test('source change during asynchronous geocoding cannot publish an old incident', async () => {
  let snapshot = media([report()]), writes = 0;
  const db = { collection: () => ({ doc: id => ({ get: async () => ({ id, exists: true, data: () => device }),
    collection: () => ({ doc: () => ({ set: async () => { ++writes; } }) }) }) }) };
  const scheduler = startPriorityUpdateScheduler({ db,
    config: { priorityUpdatesEnabled: true, priorityUpdateImeis: ['359633100123456'], contextDefiMediaEnabled: true },
    now: () => now, mediaProvider: { getPrioritySnapshot: () => snapshot }, resolvePlace: async () => {
      snapshot = { ...snapshot, lastError: 'source unavailable' }; return location;
    } });
  try { await scheduler.runNow(); assert.equal(writes, 0); } finally { scheduler.stop(); }
});

test('unresolved locality is cached across watches and later passes', async () => {
  let lookups = 0;
  const db = { collection: () => ({ doc: id => ({ get: async () => ({ id, exists: true, data: () => device }) }) }) };
  const scheduler = startPriorityUpdateScheduler({ db,
    config: { priorityUpdatesEnabled: true, priorityUpdateImeis: ['359633100123456', '359633100123457'], contextDefiMediaEnabled: true },
    now: () => now, mediaProvider: { getPrioritySnapshot: () => media([report()]) },
    resolvePlace: async () => { ++lookups; throw Error('no geocoder'); } });
  try {
    await scheduler.runNow(); await scheduler.runNow();
    assert.equal(lookups, 1);
  } finally { scheduler.stop(); }
});

test('200-watch fleet processes bounded pages without a blank third pass', async () => {
  let queries = 0;
  const ids = Array.from({ length: 200 }, (_, i) => String(359633100123400 + i));
  const written = [];
  const query = after => ({ limit: () => query(after), startAfter: id => query(id), get: async () => {
    ++queries;
    return { docs: ids.filter(id => !after || id > after).slice(0, 100)
      .map(id => ({ id, exists: true, data: () => device })) };
  } });
  const db = { collection: () => ({ orderBy: () => query(null),
    doc: id => ({ collection: () => ({ doc: () => ({ set: async () => written.push(id) }) }) }) }) };
  const scheduler = startPriorityUpdateScheduler({ db,
    config: { priorityUpdatesEnabled: true, contextDefiMediaEnabled: true }, now: () => now,
    mediaProvider: { getPrioritySnapshot: () => media([report()]) }, resolvePlace: async () => location });
  try {
    await scheduler.runNow(); assert.equal(written.length, 100);
    await scheduler.runNow(); assert.equal(written.length, 200);
    await scheduler.runNow(); assert.equal(queries, 4);
    assert.equal(new Set(written).size, 200);
    assert.equal(written.length, 200); // unchanged watches are not rewritten
  } finally { scheduler.stop(); }
});
