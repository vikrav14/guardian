const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildJourneyDocumentId,
  timestampKey,
} = require('../src/journey-id');

function sampleJourney(overrides = {}) {
  return {
    startAt: new Date('2026-08-11T10:00:00Z'),
    endAt: new Date('2026-08-11T10:30:00Z'),
    polyline: 'abc123',
    pointCount: 28,
    ...overrides,
  };
}

test('same completed outing always gets the same Firestore document id', () => {
  const a = buildJourneyDocumentId('861397052547492', sampleJourney());
  const b = buildJourneyDocumentId('861397052547492', sampleJourney());

  assert.equal(a, b);
  assert.match(a, /^journey_[a-f0-9]{32}$/);
});

test('Date, ISO string, and Firestore-style timestamp normalize consistently', () => {
  const iso = '2026-08-11T10:00:00.000Z';

  assert.equal(timestampKey(new Date(iso)), iso);
  assert.equal(timestampKey(iso), iso);
  assert.equal(
    timestampKey({ seconds: 1786442400, nanoseconds: 0 }),
    iso
  );
});

test('changing route identity changes the Firestore document id', () => {
  const original = buildJourneyDocumentId(
    '861397052547492',
    sampleJourney()
  );
  const changed = buildJourneyDocumentId(
    '861397052547492',
    sampleJourney({ polyline: 'different-route' })
  );

  assert.notEqual(original, changed);
});

test('different devices cannot collide for the same route and timestamps', () => {
  const journey = sampleJourney();

  const first = buildJourneyDocumentId('DEVICE-A', journey);
  const second = buildJourneyDocumentId('DEVICE-B', journey);

  assert.notEqual(first, second);
});
