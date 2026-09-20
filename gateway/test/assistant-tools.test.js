const test = require('node:test');
const assert = require('node:assert/strict');
const { encodePolyline } = require('../src/polyline');
const sourceCases = require('../../docs/testing/journey-source-evidence.json').cases;

// Synthetic northbound GPS route: 0.002 latitude degrees is about 222 m.
function gpsRouteEvidence() {
  return {
    evidenceVersion: 3,
    pointCount: 3,
    polyline: encodePolyline([0, 0.001, 0.002].map(offset => ({
      lat: -20.25 + offset, lng: 57.5,
    }))),
    pointEvidence: [0, 60000, 120000].map(offsetMs => ({
      offsetMs, source: 'gps', gpsValid: true,
    })),
  };
}

const {
  deviceLabel,
  getLastLocation,
  getDeviceIntelligence,
  getRecentJourneys,
  getDailySummary,
  getWellbeingReadings,
  getActivitySummary,
} = require('../src/assistant/tools');

test('deviceLabel prefers nickname, then relationship', () => {
  assert.equal(
    deviceLabel({
      nickname: 'Mimi',
      relationship: 'Mum',
      name: "Mum's pendant",
    }),
    'Mimi',
  );
  assert.equal(
    deviceLabel({ relationship: 'Dad', name: "Dad's pendant" }),
    'Dad',
  );
});

test('deviceLabel removes hardware wording from legacy names', () => {
  assert.equal(deviceLabel({ name: "Mum's pendant" }), 'Mum');
  assert.equal(deviceLabel({ name: 'Device 1234' }), 'Loved one');
  assert.equal(deviceLabel({}), 'Loved one');
});

test('getDeviceIntelligence returns topInsight facts only', async () => {
  const ctx = {
    devices: [
      {
        imei: '000000000000001',
        nickname: 'Mimi',
        online: true,
        intelligence: {
          updatedAt: '2026-07-22T12:00:00Z',
          topInsight: {
            id: 'low_battery',
            facts: ['Battery at 18%'],
            inference: 'Battery is low',
            confidence: 85,
            level: 'warning',
          },
          insights: [{ id: 'low_battery' }],
        },
      },
    ],
  };

  const result = await getDeviceIntelligence(ctx, { device_name: 'Mimi' });
  assert.equal(result.name, 'Mimi');
  assert.equal(result.topInsight.id, 'low_battery');
  assert.deepEqual(result.topInsight.facts, ['Battery at 18%']);
  assert.equal(result.insightCount, 1);
});

test('getLastLocation discloses a retained satellite fix and newer indoor observation', async () => {
  const satelliteAt = new Date('2026-08-14T19:42:33.000Z');
  const approximateAt = new Date('2026-08-14T19:47:33.000Z');
  const result = await getLastLocation(
    {
      devices: [{
        imei: 'A',
        nickname: 'Jesh',
        lastHeartbeatAt: new Date(),
        accuracySource: 'wifi',
        lastLocationObservation: {
          lat: -20.028,
          lng: 57.596,
          source: 'wifi',
          accuracyMeters: 308.701,
          recordedAt: approximateAt,
        },
        lastSatelliteLocation: {
          lat: -20.029278,
          lng: 57.5960427,
          source: 'gps',
          gpsValid: true,
          accuracyMeters: null,
          recordedAt: satelliteAt,
        },
      }],
    },
    { imei: 'A' }
  );

  assert.equal(result.accuracySource, 'gps');
  assert.equal(result.accuracyMeters, null);
  assert.equal(result.retainedSatellite, true);
  assert.equal(result.latestObservationSource, 'wifi');
  assert.match(result.locationDisclosure, /last satellite fix/);
});

test('getRecentJourneys omits legacy drift and the reported network trip, then backfills GPS', async () => {
  const docs = [
    { id: 'reported-network-trip', data: () => sourceCases[0].journey },
    {
      id: 'drift',
      data: () => ({
        startAt: new Date('2026-08-11T03:03:00Z'),
        endAt: new Date('2026-08-11T20:01:00Z'),
        distanceKm: 0.5,
        pointCount: 14,
        events: [],
        closeReason: 'idle',
      }),
    },
    {
      id: 'real',
      data: () => ({
        startAt: new Date('2026-08-10T16:50:00Z'),
        endAt: new Date('2026-08-10T17:36:00Z'),
        distanceKm: 21.9,
        ...gpsRouteEvidence(),
        events: [],
        closeReason: 'idle',
      }),
    },
  ];
  const query = {
    orderBy() { return this; },
    limit() { return this; },
    async get() { return { docs }; },
  };
  const db = {
    collection(name) {
      assert.equal(name, 'devices');
      return {
        doc(imei) {
          assert.equal(imei, 'A');
          return { collection: () => query };
        },
      };
    },
  };
  const result = await getRecentJourneys(
    db,
    { devices: [{ imei: 'A', nickname: 'Jesh' }] },
    { limit: 1, imei: 'A' },
  );
  assert.equal(result.omittedLowQualityCount, 2);
  assert.deepEqual(result.journeys.map((journey) => journey.id), ['real']);
  assert.equal(result.journeys[0].distanceKm, 0.222);
});

test('getRecentJourneys filters an explicitly requested Mauritius day', async () => {
  const docs = [
    {
      id: 'today',
      data: () => ({
        startAt: new Date('2026-08-18T05:00:00Z'),
        endAt: new Date('2026-08-18T05:30:00Z'),
        distanceKm: 4.2,
        ...gpsRouteEvidence(),
      }),
    },
    {
      id: 'yesterday',
      data: () => ({
        startAt: new Date('2026-08-17T13:00:00Z'),
        endAt: new Date('2026-08-17T13:30:00Z'),
        distanceKm: 6.3,
        ...gpsRouteEvidence(),
      }),
    },
  ];
  const query = {
    orderBy() { return this; },
    limit() { return this; },
    async get() { return { docs }; },
  };
  const db = {
    collection() {
      return { doc: () => ({ collection: () => query }) };
    },
  };
  const result = await getRecentJourneys(
    db,
    { devices: [{ imei: 'A', nickname: 'Jesh' }] },
    {
      imei: 'A',
      start_at: '2026-08-17T20:00:00.000Z',
      end_at: '2026-08-18T20:00:00.000Z',
      period_label: 'today',
    },
  );
  assert.equal(result.periodLabel, 'today');
  assert.deepEqual(result.journeys.map((journey) => journey.id), ['today']);
});

test('assistant recomputes old mixed-source distance and suppresses approximate stops', async () => {
  const raw = {
    ...gpsRouteEvidence(),
    startAt: new Date('2026-09-06T18:00:00Z'),
    endAt: new Date('2026-09-06T18:03:00Z'),
    pointCount: 4, distanceKm: 99, stopCount: 2,
    polyline: encodePolyline([0, 0.001, 0.05, 0.08].map(offset => ({
      lat: -20.25 + offset, lng: 57.5,
    }))),
    pointEvidence: ['gps', 'gps', 'wifi', 'lbs'].map((source, i) => ({
      source, gpsValid: source === 'gps', offsetMs: i * 60000,
    })),
  };
  const query = {
    orderBy() { return this; }, limit() { return this; },
    async get() { return { docs: [{ id: 'mixed', data: () => raw }] }; },
  };
  const db = { collection: () => ({ doc: () => ({ collection: () => query }) }) };
  const result = await getRecentJourneys(db, { devices: [{ imei: 'A' }] }, { imei: 'A' });
  assert.equal(result.journeys.length, 1);
  assert.equal(result.journeys[0].distanceKm, 0.111);
  assert.equal(result.journeys[0].stopCount, 0);
  assert.equal(raw.distanceKm, 99);
  assert.equal(raw.stopCount, 2);
});

test('getDailySummary aggregates only the requested authorised wearer and period', async () => {
  const chain = (docs) => ({
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    async get() { return { docs }; },
  });
  const journeyDocs = [{
    id: 'today-trip',
    data: () => ({
      startAt: new Date('2026-08-14T05:00:00Z'),
      endAt: new Date('2026-08-14T05:30:00Z'),
      distanceKm: 4.2,
      ...gpsRouteEvidence(),
    }),
  }, {
    id: 'network-drift',
    data: () => ({
      ...sourceCases[0].journey,
      startAt: new Date('2026-08-14T06:00:00Z'),
      endAt: new Date('2026-08-14T06:25:00Z'),
    }),
  }];
  const alertDocs = [{
    id: 'home-enter',
    data: () => ({
      imei: 'A',
      type: 'geofence_enter',
      createdAt: { toDate: () => new Date('2026-08-14T06:00:00Z') },
    }),
  }];
  const db = {
    collection(name) {
      if (name === 'alerts') return chain(alertDocs);
      assert.equal(name, 'devices');
      return {
        doc(imei) {
          assert.equal(imei, 'A');
          return { collection: () => chain(journeyDocs) };
        },
      };
    },
  };
  const result = await getDailySummary(
    db,
    {
      devices: [{
        imei: 'A',
        nickname: 'Jesh',
        batteryPercent: 70,
        lastHeartbeatAt: new Date(),
      }],
    },
    {
      imei: 'A',
      start_at: '2026-08-13T20:00:00Z',
      end_at: '2026-08-14T20:00:00Z',
      period_label: 'today',
    },
  );
  assert.equal(result.name, 'Jesh');
  assert.equal(result.journeyCount, 1);
  assert.equal(result.distanceKm, 0.222);
  assert.equal(result.omittedLowQualityCount, 1);
  assert.equal(result.safeZoneEventCount, 1);
  assert.equal(result.criticalAlertCount, 0);
  assert.equal(result.batteryPercent, 70);
});

test('getWellbeingReadings queries only displayable readings for the selected watch', async () => {
  const calls = [];
  const query = {
    where(field, operator, value) {
      calls.push(['where', field, operator, value]);
      return this;
    },
    orderBy(field, direction) {
      calls.push(['orderBy', field, direction]);
      return this;
    },
    limit(value) {
      calls.push(['limit', value]);
      return this;
    },
    async get() {
      return {
        docs: [{
          id: 'reading-1',
          data: () => ({
            metricSet: 'spo2',
            displayable: true,
            values: { spo2Percent: 98 },
            quality: 'device_accepted',
            observedAt: { toDate: () => new Date(Date.now() - 1000) },
          }),
        }],
      };
    },
  };
  const db = {
    collection(name) {
      if (name === 'wellbeingConsents') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ version: 1, status: 'granted', managedBy: 'guardian_admin', wearerAcknowledgedAt: new Date(0) }) }) }) };
      assert.equal(name, 'devices');
      return {
        doc(imei) {
          assert.equal(imei, 'A');
          return {
            collection(name) {
              assert.equal(name, 'wellbeingReadings');
              return query;
            },
          };
        },
      };
    },
  };

  const result = await getWellbeingReadings(
    db,
    { devices: [{ imei: 'A', nickname: 'Jesh' }], entitlements: { serviceActive: true, plan: 'care' } },
    { imei: 'A', limit: 6 },
  );
  assert.equal(result.name, 'Jesh');
  assert.equal(result.readings[0].values.spo2Percent, 98);
  assert.deepEqual(calls[0], ['where', 'displayable', '==', true]);
  assert.equal(calls.filter(call => call[0] === 'where' && call[1] === 'observedAt').length, 2);
});

test('getActivitySummary returns only accepted displayable step records', async () => {
  const docs = [
    {
      id: '2026-08-23',
      data: () => ({
        localDate: '2026-08-23',
        displayable: true,
        reportedSteps: 4321,
        lastObservedAt: new Date(Date.now() - 1000),
      }),
    },
    {
      id: '2026-08-22',
      data: () => ({
        localDate: '2026-08-22',
        displayable: false,
        observedDeltaSteps: 300,
      }),
    },
  ];
  const query = {
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    async get() { return { docs }; },
  };
  const db = {
    collection() {
      return { doc: () => ({ collection: () => query }) };
    },
  };
  const result = await getActivitySummary(
    db,
    { devices: [{ imei: 'A', nickname: 'Jesh' }], entitlements: { serviceActive: true, plan: 'family' } },
    { imei: 'A', days: 7 },
  );
  assert.equal(result.name, 'Jesh');
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].steps, 4321);
  assert.equal(result.medicalUse, false);
});
