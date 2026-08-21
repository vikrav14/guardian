const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessRoadAlignment,
  chunkWithOverlap,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
} = require('../src/journey-road-alignment');
const {
  buildComparisonHtml,
} = require('../scripts/inspect-journey-road-alignment');

test('selectTrustedGpsPoints excludes WiFi and invalid GPS evidence', () => {
  const points = [
    { lat: -20.01, lng: 57.60 },
    { lat: -20.02, lng: 57.61 },
    { lat: -20.03, lng: 57.62 },
  ];
  const selected = selectTrustedGpsPoints(points, [
    { source: 'gps', gpsValid: true, satellites: 7 },
    { source: 'wifi', gpsValid: false },
    { source: 'gps', gpsValid: false },
  ]);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].originalJourneyIndex, 0);
  assert.equal(selected[0].satellites, 7);
});

test('chunkWithOverlap respects the Roads API 100-point limit', () => {
  const points = Array.from({ length: 205 }, (_, index) => ({ index }));
  const chunks = chunkWithOverlap(points);

  assert.deepEqual(chunks.map((chunk) => chunk.points.length), [100, 100, 7]);
  assert.equal(chunks[1].points[0].index, 99);
  assert.equal(chunks[2].points[0].index, 198);
});

test('snapJourneyToRoads adjusts original indexes across chunks', async () => {
  const points = Array.from({ length: 101 }, (_, index) => ({
    lat: -20 + (index * 0.00001),
    lng: 57.5,
  }));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.match(url, /key=secret/);
    return {
      ok: true,
      json: async () => ({
        snappedPoints: calls === 1
          ? [
              { location: { latitude: -20, longitude: 57.5 }, originalIndex: 0 },
              { location: { latitude: -19.99901, longitude: 57.5 }, originalIndex: 99 },
            ]
          : [
              { location: { latitude: -19.99901, longitude: 57.5 }, originalIndex: 0 },
              { location: { latitude: -19.999, longitude: 57.5 }, originalIndex: 1 },
            ],
      }),
    };
  };

  const snapped = await snapJourneyToRoads(points, {
    apiKey: 'secret',
    fetchImpl,
  });

  assert.equal(calls, 2);
  assert.deepEqual(snapped.map((point) => point.originalIndex), [0, 99, 100]);
});

test('road alignment rejects sparse or heavily corrected proposals', () => {
  const original = [
    { lat: -20.0000, lng: 57.5000 },
    { lat: -20.0100, lng: 57.5000 },
    { lat: -20.0200, lng: 57.5000 },
  ];
  const snapped = original.map((point, originalIndex) => ({
    lat: point.lat,
    lng: point.lng + 0.002,
    originalIndex,
  }));

  const assessment = assessRoadAlignment(original, snapped);

  assert.equal(assessment.eligibleForDisplayExperiment, false);
  assert.equal(assessment.adjacentPairsOver300Meters, 2);
  assert.ok(assessment.medianCorrectionMeters > 150);
  assert.ok(assessment.warnings.length >= 2);
});

test('comparison HTML contains route layers but never an API key', () => {
  const html = buildComparisonHtml({
    imei: '123',
    journeyId: 'journey-1',
    allPoints: [{ lat: -20.01, lng: 57.6 }],
    gpsPoints: [{ lat: -20.01, lng: 57.6 }],
    snappedPoints: [{ lat: -20.01, lng: 57.6 }],
    assessment: {
      eligibleForDisplayExperiment: true,
      matchedGpsPointCount: 1,
      originalGpsPointCount: 1,
      medianCorrectionMeters: 0,
      p95CorrectionMeters: 0,
      adjacentPairsOver300Meters: 0,
      warnings: [],
    },
  });

  assert.match(html, /Complete stored evidence/);
  assert.match(html, /Google road-aligned proposal/);
  assert.doesNotMatch(html, /GOOGLE_ROADS_API_KEY|secret|key=/);
});
