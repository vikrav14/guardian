'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichJourneyStopPlaceNames } = require('../src/journey-place-labels');

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
