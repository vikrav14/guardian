const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessRoadAlignment,
  chunkWithOverlap,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
} = require('../src/journey-road-alignment');

test('selectTrustedGpsPoints excludes approximate and invalid GPS evidence', () => {
  const selected = selectTrustedGpsPoints([
    { lat: -20.01, lng: 57.60 },
    { lat: -20.02, lng: 57.61 },
    { lat: -20.03, lng: 57.62 },
  ], [
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

test('road alignment accepts a fully grounded low-correction section', () => {
  const original = [
    { lat: -20.0000, lng: 57.5000 },
    { lat: -20.0005, lng: 57.5005 },
    { lat: -20.0010, lng: 57.5010 },
  ];
  const snapped = original.map((point, originalIndex) => ({
    ...point,
    originalIndex,
  }));

  const assessment = assessRoadAlignment(original, snapped);

  assert.equal(assessment.eligibleForDisplay, true);
  assert.equal(assessment.coveragePercent, 100);
  assert.equal(assessment.p95CorrectionMeters, 0);
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

  assert.equal(assessment.eligibleForDisplay, false);
  assert.equal(assessment.adjacentPairsOver300Meters, 2);
  assert.ok(assessment.medianCorrectionMeters > 150);
});

test('Roads errors redact the server key', async () => {
  await assert.rejects(
    snapJourneyToRoads([
      { lat: -20, lng: 57.5 },
      { lat: -20.001, lng: 57.501 },
    ], {
      apiKey: 'never-print-me',
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'bad never-print-me' } }),
      }),
    }),
    (error) => {
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /never-print-me/);
      return true;
    }
  );
});
