'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enrichJourneyStopPlaceNames,
  enrichJourneyPointPlaceNames,
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
