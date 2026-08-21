const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefiMediaReview,
  formatDefiMediaReview,
} = require('../scripts/inspect-context-sources');

function item(overrides = {}) {
  return {
    title: 'General headline',
    publishedAt: '2026-08-20T12:00:00.000Z',
    categories: ['Actualites'],
    safetyCandidate: false,
    fresh: true,
    matchedEventTypes: [],
    placeMentions: [],
    reason: 'no_safety_signal',
    sourceUrl: 'https://defimedia.info/general-headline',
    ...overrides,
  };
}

test('human review groups every RSS item without dropping ordinary news', () => {
  const review = buildDefiMediaReview([
    item({
      title: 'Incendie a Bel Air',
      safetyCandidate: true,
      eventType: 'fire',
      matchedEventTypes: ['fire'],
      placeMentions: ['Bel Air Riviere Seche'],
    }),
    item({
      title: 'Epidemie en RDC',
      matchedEventTypes: ['health_hazard'],
      reason: 'no_mauritius_location_signal',
    }),
    item(),
  ]);

  assert.equal(review.candidates.length, 1);
  assert.equal(review.safetyExcluded.length, 1);
  assert.equal(review.otherNews.length, 1);
});

test('human report explains decisions and uses Mauritius time', () => {
  const report = formatDefiMediaReview([
    item({
      title: 'Collision a Bel Etang',
      safetyCandidate: true,
      eventType: 'road_disruption',
      matchedEventTypes: ['road_disruption'],
      placeMentions: ['Bel Etang'],
    }),
    item({
      title: 'Foreign health report',
      matchedEventTypes: ['health_hazard'],
      reason: 'no_mauritius_location_signal',
    }),
  ]);

  assert.match(report, /Total: 2 \| Guardian candidates: 1/);
  assert.match(report, /20 Aug 2026, 16:00 MUT/);
  assert.match(report, /recognised place: Bel Etang/);
  assert.match(report, /no Mauritius place or Mauritius-wide scope/);
});

test('human review separates an expired safety report from an actionable candidate', () => {
  const review = buildDefiMediaReview([
    item({
      title: 'Recent fire',
      safetyCandidate: true,
      actionable: true,
      eventType: 'fire',
      matchedEventTypes: ['fire'],
      placeMentions: ['Grand Baie'],
    }),
    item({
      title: 'Old collision',
      safetyCandidate: true,
      actionable: false,
      eventType: 'road_disruption',
      matchedEventTypes: ['road_disruption'],
      placeMentions: ['Bel Etang'],
    }),
  ]);
  assert.equal(review.candidates.length, 1);
  assert.equal(review.safetyExcluded.length, 1);
});
