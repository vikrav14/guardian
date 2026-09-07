const test = require('node:test');
const assert = require('node:assert/strict');
const { hasJourneyGpsEvidence, isJourneyGps } = require('../src/journey-source-evidence');
const { analyzeJourney } = require('../src/journey-diagnostics');
const fixture = require('../../docs/testing/journey-source-evidence.json');

for (const scenario of fixture.cases) {
  test(`journey source contract: ${scenario.name}`, () => {
    assert.equal(hasJourneyGpsEvidence(scenario.journey), scenario.eligible);
  });
}

test('the reported 25-minute 4.039km record is no longer assessed as OK', () => {
  const journey = fixture.cases[0].journey;
  assert.equal(journey.pointCount, 44);
  assert.equal(journey.pointEvidence.filter(isJourneyGps).length, 0);
  assert.equal(journey.pointEvidence.filter(p => p.speedKmh >= 1).length, 0);
  const result = analyzeJourney(journey);
  assert.equal(result.startTrigger.type, 'generic_movement');
  assert.equal(result.assessment, 'unconfirmed_source_evidence');
  assert.match(result.reasons.join(' '), /network estimates cannot confirm travel/);
});
