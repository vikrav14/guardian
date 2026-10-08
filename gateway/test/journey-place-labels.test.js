'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enrichJourneyStopPlaceNames,
  enrichJourneyPointPlaceNames,
  enrichStoredJourneyPlaceNames,
  MAX_JOURNEY_PLACE_LOOKUPS,
} = require('../src/journey-place-labels');
const { encodePolyline } = require('../src/polyline');

test('journey stops receive neutral reverse-geocoded area names', async () => {
  const stops = [{ id: 'stop_1', centerLat: -20.01, centerLng: 57.58, placeName: null }];
  const enriched = await enrichJourneyStopPlaceNames(
    stops,
    async () => 'Grand Baie'
  );

  assert.equal(enriched[0].placeName, 'Grand Baie');
  assert.equal(stops[0].placeName, null);
});

test('existing stop names are preserved and failed lookups stay unlabeled', async () => {
  const stops = [
    { id: 'known', centerLat: -20.01, centerLng: 57.58, placeName: 'School' },
    { id: 'unknown', centerLat: -20.02, centerLng: 57.59, placeName: null },
  ];
  const enriched = await enrichJourneyStopPlaceNames(stops, async (lat) => {
    if (lat === -20.02) throw new Error('offline');
    return 'Wrong';
  });

  assert.equal(enriched[0].placeName, 'School');
  assert.equal(enriched[1].placeName, null);
});

test('journey point evidence receives a factual area name for every coordinate', async () => {
  const journey = {
    polyline: encodePolyline([
      { lat: -20.01, lng: 57.58 },
      { lat: -20.02, lng: 57.59 },
    ]),
    pointEvidence: [
      { offsetMs: 0, placeName: 'Home' },
      { offsetMs: 60_000 },
    ],
  };
  const lookups = [];
  const enriched = await enrichJourneyPointPlaceNames(
    journey,
    async (lat, lng) => {
      lookups.push([lat, lng]);
      return 'Petite Julie';
    }
  );

  assert.equal(enriched[0].placeName, 'Home');
  assert.equal(enriched[1].placeName, 'Petite Julie');
  assert.deepEqual(lookups, [[-20.02, 57.59]]);
  assert.equal(journey.pointEvidence[1].placeName, undefined);
});

test('point enrichment leaves mismatched evidence unchanged', async () => {
  const evidence = [{ offsetMs: 0 }];
  const enriched = await enrichJourneyPointPlaceNames(
    {
      polyline: encodePolyline([
        { lat: -20.01, lng: 57.58 },
        { lat: -20.02, lng: 57.59 },
      ]),
      pointEvidence: evidence,
    },
    async () => 'Should not be used'
  );

  assert.deepEqual(enriched, evidence);
  assert.notEqual(enriched[0], evidence[0]);
});

test('dense journeys bound lookups and prioritize endpoints and gap boundaries', async () => {
  const points = Array.from({ length: 200 }, (_, i) => ({ lat: -20 + i * 0.002, lng: 57.5 }));
  const lookups = [];
  const journey = { polyline: encodePolyline(points),
    pointEvidence: points.map((_, i) => ({ offsetMs: i * 60000 })),
    routeGaps: [{ fromPointIndex: 30, toPointIndex: 31 }] };
  const enriched = await enrichJourneyPointPlaceNames(journey, async (lat) => {
    lookups.push(lat); return `Area ${lat}`;
  });
  assert.equal(lookups.length, MAX_JOURNEY_PLACE_LOOKUPS);
  for (const i of [0, 199, 30, 31]) assert.ok(enriched[i].placeName);
  assert.ok(enriched.some(p => !p.placeName), 'distant coordinates must not inherit unrelated names');
});

test('nearby points reuse an existing name without another provider request', async () => {
  const journey = { polyline: encodePolyline([
    { lat: -20, lng: 57.5 }, { lat: -20.0001, lng: 57.5 }, { lat: -20.01, lng: 57.5 },
  ]), pointEvidence: [{ offsetMs: 0, placeName: 'Home' }, { offsetMs: 60000 }, { offsetMs: 120000 }] };
  let calls = 0;
  const enriched = await enrichJourneyPointPlaceNames(journey, async () => { calls++; return 'Town'; });
  assert.equal(calls, 1);
  assert.deepEqual(enriched.map(p => p.placeName), ['Home', 'Home', 'Town']);
});

test('stored enrichment preserves current metadata and rejects a changed route', async () => {
  const initial = { polyline: encodePolyline([{ lat: -20, lng: 57.5 }, { lat: -20.01, lng: 57.5 }]),
    pointEvidence: [{ offsetMs: 0 }, { offsetMs: 60000 }] };
  for (const changed of [false, true]) {
    let value = structuredClone(initial), written = null;
    const ref = { get: async () => ({ exists: true, data: () => structuredClone(value) }) };
    const db = { runTransaction: async fn => {
      value.pointEvidence[0].accuracyMeters = 7;
      value.pointEvidence[1].placeName = 'Concurrent label';
      if (changed) value.polyline += '?';
      return fn({ get: ref => ref.get(), set: (_ref, fields, options) => {
        assert.equal(options.merge, true); written = fields;
      } });
    } };
    const added = await enrichStoredJourneyPlaceNames(db, ref, async () => 'Area');
    if (changed) { assert.equal(added, 0); assert.equal(written, null); }
    else {
      assert.equal(added, 1);
      assert.equal(written.pointEvidence[0].accuracyMeters, 7);
      assert.deepEqual(written.pointEvidence.map(p => p.placeName), ['Area', 'Concurrent label']);
    }
  }
});
