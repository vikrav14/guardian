'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifySafetyCandidate,
  normalizeFeedItem,
} = require('../src/context/defiMediaRssProvider');
const {
  isActionableNewsItem,
} = require('../src/context/defiMediaPolicy');
const {
  bearingDegrees,
  evaluateDeviceExposure,
  evaluateNewsExposure,
  selectCurrentExposureLocation,
} = require('../src/context/defiMediaExposureMatcher');
const {
  persistChangedNewsEvents,
} = require('../src/context/defiMediaEventStore');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeDb(seed = {}) {
  const stores = new Map();
  for (const [name, values] of Object.entries(seed)) {
    stores.set(name, new Map(Object.entries(values).map(([id, value]) => [id, clone(value)])));
  }
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const snapshot = (id, data) => ({
    id,
    exists: data != null,
    data: () => data == null ? undefined : clone(data),
  });
  const collection = (name) => {
    const store = storeFor(name);
    const allDocs = () => [...store.entries()].map(([id, data]) => snapshot(id, data));
    return {
      doc(id) {
        return {
          async get() { return snapshot(id, store.get(id)); },
          async set(value, options = {}) {
            const next = options.merge && store.has(id)
              ? { ...store.get(id), ...clone(value) }
              : clone(value);
            store.set(id, next);
          },
          async create(value) {
            if (store.has(id)) {
              const error = new Error('already exists');
              error.code = 6;
              throw error;
            }
            store.set(id, clone(value));
          },
        };
      },
      async get() { return { docs: allDocs() }; },
      limit(limit) {
        return { async get() { return { docs: allDocs().slice(0, limit) }; } };
      },
      where(field, operator, expected) {
        assert.equal(operator, 'array-contains');
        return {
          async get() {
            return {
              docs: allDocs().filter((doc) => {
                const value = doc.data()?.[field];
                return Array.isArray(value) && value.includes(expected);
              }),
            };
          },
        };
      },
    };
  };
  return { collection, stores };
}

function event(overrides = {}) {
  return {
    id: 'mu-defimedia-rss:event-one',
    documentId: 'event-one',
    contentHash: 'hash-one',
    eventType: 'road_disruption',
    title: 'Collision a Grand Baie',
    publishedAt: '2026-08-21T08:00:00.000Z',
    actionableUntil: '2026-08-21T11:00:00.000Z',
    actionable: true,
    placeMentions: ['Grand Baie'],
    ...overrides,
  };
}

function deviceLocation({ lat, lng, at, speedKmh = null, course = null, source = 'gps' }) {
  return {
    lastLocationObservation: {
      lat,
      lng,
      recordedAt: at,
      source,
      gpsValid: source === 'gps',
      ...(source === 'gps' ? {} : { accuracyMeters: 500 }),
    },
    speedKmh,
    course,
  };
}

test('gunshots at La Rosa become a time-limited Mauritius public-safety candidate', () => {
  const classification = classifySafetyCandidate({
    title: 'Coups de feu a La Rosa apres une altercation',
    description: '',
    categories: ['Actualites'],
  });
  assert.equal(classification.safetyCandidate, true);
  assert.equal(classification.eventType, 'public_safety');
  assert.deepEqual(classification.placeMentions, ['La Rosa']);

  const normalized = normalizeFeedItem({
    title: 'Coups de feu a La Rosa apres une altercation',
    description: '',
    categories: ['Actualites'],
    link: 'https://defimedia.info/coups-de-feu-la-rosa',
    guid: 'gunshots-la-rosa',
    publishedAt: '2026-08-21T08:00:00.000Z',
  }, { now: new Date('2026-08-21T08:30:00.000Z') });
  assert.equal(normalized.actionableUntil, '2026-08-21T09:30:00.000Z');
  assert.equal(normalized.actionable, true);
  assert.equal(
    isActionableNewsItem(normalized, new Date('2026-08-21T09:31:00.000Z')),
    false,
  );
});

test('Firestore event hashes suppress restart duplicates but retain material updates', async () => {
  const db = fakeDb();
  const first = await persistChangedNewsEvents(
    db,
    [event()],
    new Date('2026-08-21T08:05:00.000Z'),
  );
  const restarted = await persistChangedNewsEvents(
    db,
    [event()],
    new Date('2026-08-21T08:20:00.000Z'),
  );
  const updated = await persistChangedNewsEvents(
    db,
    [event({ contentHash: 'hash-two', title: 'Road now closed' })],
    new Date('2026-08-21T08:35:00.000Z'),
  );

  assert.equal(first.created.length, 1);
  assert.equal(restarted.unchanged.length, 1);
  assert.equal(restarted.writes, 0);
  assert.equal(updated.updated.length, 1);
  assert.equal(updated.writes, 1);
});

test('exposure location fails closed for stale or overly broad approximate fixes', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');
  assert.equal(selectCurrentExposureLocation(deviceLocation({
    lat: -20.02,
    lng: 57.58,
    at: '2026-08-21T08:40:00.000Z',
  }), { now }), null);

  const broad = deviceLocation({
    lat: -20.02,
    lng: 57.58,
    at: '2026-08-21T08:55:00.000Z',
    source: 'lbs',
  });
  broad.lastLocationObservation.accuracyMeters = 2500;
  assert.equal(selectCurrentExposureLocation(broad, { now }), null);
});

test('approximate uncertainty must fit inside the impact radius', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');
  const incident = { lat: -20.008, lng: 57.58, placeName: 'Grand Baie' };
  const uncertain = deviceLocation({
    lat: -20.02,
    lng: 57.58,
    at: '2026-08-21T08:57:00.000Z',
    source: 'lbs',
  });
  uncertain.lastLocationObservation.accuracyMeters = 900;

  assert.equal(evaluateDeviceExposure({
    event: event(),
    resolvedPlaces: [incident],
    device: uncertain,
    imei: 'A',
    outingActive: false,
    now,
  }), null);
});

test('home elsewhere is ignored, while a genuinely approaching active journey matches', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');
  const incident = { lat: -20.008, lng: 57.58, placeName: 'Grand Baie' };
  const home = { lat: -20.035, lng: 57.61 };
  const direction = bearingDegrees(home, incident);
  const wearer = deviceLocation({
    ...home,
    at: '2026-08-21T08:57:00.000Z',
    speedKmh: 35,
    course: direction,
  });

  assert.equal(evaluateDeviceExposure({
    event: event(),
    resolvedPlaces: [incident],
    device: wearer,
    imei: 'A',
    outingActive: false,
    now,
  }), null);

  const approaching = evaluateDeviceExposure({
    event: event(),
    resolvedPlaces: [incident],
    device: wearer,
    imei: 'A',
    outingActive: true,
    now,
  });
  assert.equal(approaching.matchReason, 'active_journey_approach');
  assert.ok(approaching.distanceMeters > 1500);
});

test('an active outing without measured speed and course is not guessed to be approaching', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');
  const match = evaluateDeviceExposure({
    event: event(),
    resolvedPlaces: [{ lat: -20.008, lng: 57.58, placeName: 'Grand Baie' }],
    device: deviceLocation({
      lat: -20.035,
      lng: 57.61,
      at: '2026-08-21T08:57:00.000Z',
    }),
    imei: 'A',
    outingActive: true,
    now,
  });
  assert.equal(match, null);
});

test('approximate positioning never supplies an active-journey approach match', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');
  const incident = { lat: -20.008, lng: 57.58, placeName: 'Grand Baie' };
  const start = { lat: -20.06, lng: 57.63 };
  const match = evaluateDeviceExposure({
    event: event(),
    resolvedPlaces: [incident],
    device: deviceLocation({
      ...start,
      at: '2026-08-21T08:57:00.000Z',
      speedKmh: 35,
      course: bearingDegrees(start, incident),
      source: 'lbs',
    }),
    imei: 'A',
    outingActive: true,
    now,
  });
  assert.equal(match, null);
});

test('two watches in one service family create one restart-safe shadow match', async () => {
  const observedAt = '2026-08-21T08:58:00.000Z';
  const db = fakeDb({
    devices: {
      A: deviceLocation({ lat: -20.0085, lng: 57.5802, at: observedAt }),
      B: deviceLocation({ lat: -20.009, lng: 57.5805, at: observedAt }),
    },
    users: {
      owner: { linkedImeis: ['A', 'B'], serviceOwnerUid: 'owner' },
      member: { linkedImeis: ['A'], serviceOwnerUid: 'owner' },
    },
  });
  const options = {
    db,
    candidates: [event()],
    now: new Date('2026-08-21T09:00:00.000Z'),
    resolvePlace: async () => ({ lat: -20.008, lng: 57.58 }),
    journeyActive: () => false,
  };
  const first = await evaluateNewsExposure(options);
  const repeated = await evaluateNewsExposure(options);

  assert.equal(first.deviceMatches, 2);
  assert.equal(first.familyMatches, 1);
  assert.equal(first.newFamilyMatches, 1);
  assert.deepEqual(first.matches[0].impactedImeis.sort(), ['A', 'B']);
  assert.equal(repeated.newFamilyMatches, 0);
  assert.equal(repeated.duplicateFamilyMatches, 1);
});
