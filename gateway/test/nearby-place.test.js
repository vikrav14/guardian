const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNearbyPlaceLabel,
  findNearbyLandmark,
  searchNearbyPlaces,
  selectNearbyLandmark,
} = require('../src/geolocate/nearby-place');

test('nearby place search keeps the server key in a header', async () => {
  let request;
  const places = await searchNearbyPlaces(-20.01, 57.59, {
    apiKey: 'server-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          places: [{
            id: 'super-u',
            displayName: { text: 'Super U Grand Baie' },
            primaryType: 'supermarket',
            location: { latitude: -20.0101, longitude: 57.5901 },
          }],
        }),
      };
    },
  });

  assert.equal(
    request.url,
    'https://places.googleapis.com/v1/places:searchNearby'
  );
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'server-secret');
  assert.doesNotMatch(request.options.body, /server-secret/);
  assert.equal(places[0].displayName, 'Super U Grand Baie');
});

test('a recognizable supermarket can outrank an adjacent parking result', () => {
  const selected = selectNearbyLandmark([
    {
      placeId: 'parking',
      displayName: 'Super U Parking',
      primaryType: 'parking',
      distanceMeters: 18,
      popularityRank: 0,
    },
    {
      placeId: 'super-u',
      displayName: 'Super U Grand Baie',
      primaryType: 'supermarket',
      distanceMeters: 150,
      popularityRank: 1,
    },
  ]);

  assert.equal(selected.placeId, 'super-u');
});

test('nearby labels are conservative and include useful locality context', () => {
  assert.equal(
    buildNearbyPlaceLabel('Super U', 'Grand Baie · Vingt Pieds Road'),
    'Near Super U, Grand Baie'
  );
  assert.equal(
    buildNearbyPlaceLabel('Super U Grand Baie', 'Grand Baie'),
    'Near Super U Grand Baie'
  );
});

test('findNearbyLandmark returns a label and a storable place id', async () => {
  const place = await findNearbyLandmark(-20.01, 57.59, {
    apiKey: 'secret',
    areaName: 'Grand Baie',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        places: [{
          id: 'super-u',
          displayName: { text: 'Super U Grand Baie' },
          primaryType: 'supermarket',
          location: { latitude: -20.0101, longitude: 57.5901 },
        }],
      }),
    }),
  });

  assert.equal(place.placeId, 'super-u');
  assert.equal(place.label, 'Near Super U Grand Baie');
  assert.equal(place.provider, 'google_places');
});
