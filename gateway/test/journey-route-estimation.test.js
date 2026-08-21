const test = require('node:test');
const assert = require('node:assert/strict');

const { encodePolyline } = require('../src/polyline');
const {
  estimateRouteGaps,
  fetchGoogleRouteCandidates,
  findEstimatedRouteGaps,
  partitionGpsSegments,
  selectLikelyGoogleRoute,
} = require('../src/journey-route-estimation');

function point(lat, lng, minute, originalJourneyIndex, extra = {}) {
  return {
    lat,
    lng,
    recordedAt: new Date(Date.UTC(2026, 7, 21, 10, minute)).toISOString(),
    originalJourneyIndex,
    ...extra,
  };
}

test('sparse GPS pairs become gaps while approximate evidence only corroborates', () => {
  const allPoints = [
    point(-20.00, 57.50, 0, 0, { source: 'gps', gpsValid: true }),
    point(-20.0005, 57.5005, 1, 1, { source: 'wifi', gpsValid: false }),
    point(-20.001, 57.501, 1, 2, { source: 'gps', gpsValid: true }),
    point(-20.010, 57.510, 5, 3, { source: 'lbs', gpsValid: false }),
    point(-20.020, 57.520, 10, 4, { source: 'gps', gpsValid: true }),
  ];
  const gpsPoints = [allPoints[0], allPoints[2], allPoints[4]];

  const gaps = findEstimatedRouteGaps(gpsPoints, allPoints);

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].fromGpsIndex, 1);
  assert.deepEqual(gaps[0].reasons, [
    'spatially_sparse',
    'temporally_sparse',
    'approximate_between_gps',
  ]);
  assert.equal(gaps[0].approximatePoints.length, 1);
  assert.deepEqual(
    partitionGpsSegments(gpsPoints, gaps).map((segment) => segment.length),
    [2, 1]
  );
});

test('Google Routes candidates keep the key in a header and parse alternatives', async () => {
  const encoded = encodePolyline([
    { lat: -20.0, lng: 57.5 },
    { lat: -20.01, lng: 57.51 },
  ]);
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        routes: [{
          duration: '180s',
          distanceMeters: 2100,
          routeLabels: ['DEFAULT_ROUTE'],
          polyline: { encodedPolyline: encoded },
        }],
      }),
    };
  };
  const gap = {
    from: point(-20.0, 57.5, 0, 0),
    to: point(-20.01, 57.51, 5, 1),
  };

  const candidates = await fetchGoogleRouteCandidates(gap, {
    apiKey: 'server-secret',
    fetchImpl,
  });

  assert.equal(request.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'server-secret');
  assert.doesNotMatch(request.options.body, /server-secret/);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isDefault, true);
  assert.equal(candidates[0].durationSeconds, 180);
  assert.equal(candidates[0].points.length, 2);
});

test('approximate observations can select the better Google route candidate', () => {
  const gap = {
    from: point(-20.0, 57.5, 0, 0),
    to: point(-20.02, 57.52, 10, 3),
    durationSeconds: 600,
    directDistanceMeters: 3100,
    approximatePoints: [point(-20.01, 57.51, 5, 1, { source: 'wifi' })],
  };
  const candidates = [
    {
      candidateIndex: 0,
      points: [gap.from, { lat: -20.01, lng: 57.56 }, gap.to],
      distanceMeters: 6000,
      durationSeconds: 480,
      isDefault: true,
    },
    {
      candidateIndex: 1,
      points: [gap.from, { lat: -20.01, lng: 57.51 }, gap.to],
      distanceMeters: 3400,
      durationSeconds: 420,
      isDefault: false,
    },
  ];

  const decision = selectLikelyGoogleRoute(gap, candidates);

  assert.equal(decision.accepted, true);
  assert.equal(decision.selected.candidate.candidateIndex, 1);
  assert.equal(decision.confidence, 'supported_estimate');
});

test('a route that cannot fit the recorded interval remains unresolved', () => {
  const gap = {
    from: point(-20.0, 57.5, 0, 0),
    to: point(-20.01, 57.51, 5, 1),
    durationSeconds: 300,
    directDistanceMeters: 1500,
    approximatePoints: [],
  };
  const decision = selectLikelyGoogleRoute(gap, [{
    candidateIndex: 0,
    points: [gap.from, gap.to],
    distanceMeters: 2000,
    durationSeconds: 5000,
    isDefault: true,
  }]);

  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, 'google_routes_failed_basic_sanity_checks');
  assert.deepEqual(decision.evaluated[0].reasons, [
    'route_longer_than_recorded_time_allows',
  ]);
});

test('failed gap requests redact the Routes API key', async () => {
  const gap = {
    id: 'gap-1',
    from: point(-20.0, 57.5, 0, 0),
    to: point(-20.01, 57.51, 5, 1),
    durationSeconds: 300,
    directDistanceMeters: 1500,
    approximatePoints: [],
  };
  const result = await estimateRouteGaps([gap], {
    apiKey: 'never-print-me',
    fetchImpl: async () => {
      throw new Error('provider failed for never-print-me');
    },
  });

  assert.equal(result[0].accepted, false);
  assert.match(result[0].error, /\[redacted\]/);
  assert.doesNotMatch(result[0].error, /never-print-me/);
});
