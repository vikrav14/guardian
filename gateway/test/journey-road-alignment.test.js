const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  assessRoadAlignment,
  chunkWithOverlap,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
} = require('../src/journey-road-alignment');

test('journey road-alignment inspector loads gateway .env before reading its key', () => {
  const source = readFileSync(
    join(__dirname, '..', 'scripts', 'inspect-journey-road-alignment.js'),
    'utf8'
  );
  const dotenvLoad = source.indexOf("require('dotenv').config");
  const keyRead = source.indexOf('process.env.GOOGLE_ROADS_API_KEY');
  const routesKeyRead = source.indexOf('process.env.GOOGLE_ROUTES_API_KEY');

  assert.ok(dotenvLoad >= 0);
  assert.ok(keyRead > dotenvLoad);
  assert.ok(routesKeyRead > dotenvLoad);
});
const {
  alignGpsSegments,
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
    journeyId: 'journey-1',
    allPoints: [
      { lat: -20.01, lng: 57.6, source: 'gps', gpsValid: true },
      { lat: -20.02, lng: 57.61, source: 'wifi', gpsValid: false },
    ],
    gpsPoints: [{ lat: -20.01, lng: 57.6 }],
    roadSections: [{
      accepted: true,
      snappedPoints: [{ lat: -20.01, lng: 57.6 }, { lat: -20.015, lng: 57.605 }],
    }],
    estimatedGaps: [{
      accepted: true,
      gap: {
        from: { lat: -20.015, lng: 57.605, recordedAt: '2026-08-21T10:00:00Z' },
        to: { lat: -20.02, lng: 57.61, recordedAt: '2026-08-21T10:05:00Z' },
      },
      selected: {
        candidate: {
          points: [{ lat: -20.015, lng: 57.605 }, { lat: -20.02, lng: 57.61 }],
        },
      },
    }],
  });

  assert.match(html, /Guardian Journey Lab/);
  assert.match(html, /source-pill[^>]*>.*GPS/);
  assert.match(html, /source-pill[^>]*>.*Google/);
  assert.match(html, /Show source evidence/);
  assert.doesNotMatch(html, /not recorded|Route confidence/);
  assert.doesNotMatch(html, /GOOGLE_ROADS_API_KEY|secret|key=/);
});

test('alignGpsSegments isolates a rejected section without failing the report', async () => {
  const dense = [
    { lat: -20, lng: 57.5 },
    { lat: -20.0001, lng: 57.5001 },
  ];
  const result = await alignGpsSegments([dense, [dense[1]]], {
    apiKey: 'secret',
    snapImpl: async () => {
      throw new Error('Google rejected secret');
    },
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].accepted, false);
  assert.equal(result[0].reason, 'google_roads_request_failed');
  assert.equal(result[0].error, 'Google rejected [redacted]');
  assert.equal(result[1].reason, 'single_gps_sample');
});
