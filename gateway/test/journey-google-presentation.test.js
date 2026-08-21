const test = require('node:test');
const assert = require('node:assert/strict');

const { encodePolyline } = require('../src/polyline');
const {
  PRESENTATION_TTL_MS,
  buildJourneyGooglePresentation,
} = require('../src/journey-google-presentation');

function sampleJourney() {
  const points = [
    { lat: -20.0100, lng: 57.5900 },
    { lat: -20.0105, lng: 57.5905 },
    { lat: -20.0170, lng: 57.5970 },
    { lat: -20.0250, lng: 57.6050 },
    { lat: -20.0255, lng: 57.6055 },
  ];
  return {
    startAt: new Date('2026-08-21T10:00:00.000Z'),
    polyline: encodePolyline(points),
    pointEvidence: [
      { offsetMs: 0, source: 'gps', gpsValid: true },
      { offsetMs: 60_000, source: 'gps', gpsValid: true },
      { offsetMs: 180_000, source: 'wifi', gpsValid: false },
      { offsetMs: 360_000, source: 'gps', gpsValid: true },
      { offsetMs: 420_000, source: 'gps', gpsValid: true },
    ],
    stops: [{
      id: 'stop-1',
      centerLat: -20.017,
      centerLng: 57.597,
      pointStartIndex: 2,
      pointEndIndex: 2,
      placeName: 'Grand Baie',
    }],
  };
}

test('presentation combines grounded GPS, plausible Google geometry and a landmark', async () => {
  const journey = sampleJourney();
  const rawBefore = JSON.stringify(journey);
  const routePolyline = encodePolyline([
    { lat: -20.0105, lng: 57.5905 },
    { lat: -20.0170, lng: 57.5970 },
    { lat: -20.0250, lng: 57.6050 },
  ]);
  let roadsCall = 0;
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://roads.googleapis.com/')) {
      roadsCall += 1;
      const points = roadsCall === 1
        ? [
            { latitude: -20.0100, longitude: 57.5900 },
            { latitude: -20.0105, longitude: 57.5905 },
          ]
        : [
            { latitude: -20.0250, longitude: 57.6050 },
            { latitude: -20.0255, longitude: 57.6055 },
          ];
      return {
        ok: true,
        json: async () => ({
          snappedPoints: points.map((location, originalIndex) => ({
            location,
            originalIndex,
          })),
        }),
      };
    }
    if (url === 'https://routes.googleapis.com/directions/v2:computeRoutes') {
      return {
        ok: true,
        json: async () => ({
          routes: [{
            duration: '240s',
            distanceMeters: 2400,
            routeLabels: ['DEFAULT_ROUTE'],
            polyline: { encodedPolyline: routePolyline },
          }],
        }),
      };
    }
    if (url === 'https://places.googleapis.com/v1/places:searchNearby') {
      return {
        ok: true,
        json: async () => ({
          places: [{
            id: 'super-u-grand-baie',
            displayName: { text: 'Super U Grand Baie' },
            primaryType: 'supermarket',
            location: { latitude: -20.0171, longitude: 57.5971 },
          }],
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const now = new Date('2026-08-21T12:00:00.000Z');

  const presentation = await buildJourneyGooglePresentation(journey, {
    roadsApiKey: 'roads',
    routesApiKey: 'routes',
    placesApiKey: 'places',
    fetchImpl,
    now,
  });

  assert.equal(JSON.stringify(journey), rawBefore);
  assert.equal(presentation.coverage.gpsSegmentCount, 2);
  assert.equal(presentation.coverage.googleSegmentCount, 1);
  assert.deepEqual(
    presentation.segments.map((segment) => segment.source),
    ['gps', 'google', 'gps']
  );
  assert.equal(presentation.stopPlaces[0].label, 'Near Super U Grand Baie');
  assert.equal(presentation.stopPlaces[0].placeId, 'super-u-grand-baie');
  assert.equal(
    presentation.expiresAt.getTime() - presentation.generatedAt.getTime(),
    PRESENTATION_TTL_MS
  );
});

test('presentation degrades to raw GPS when Google providers fail', async () => {
  const journey = sampleJourney();
  const presentation = await buildJourneyGooglePresentation(journey, {
    roadsApiKey: 'roads-secret',
    routesApiKey: 'routes-secret',
    placesApiKey: 'places-secret',
    fetchImpl: async () => {
      throw new Error('provider unavailable');
    },
  });

  assert.ok(presentation);
  assert.ok(presentation.segments.every((segment) => segment.source === 'gps'));
  assert.equal(presentation.stopPlaces.length, 0);
});
