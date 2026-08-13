const test = require('node:test');
const assert = require('node:assert/strict');
const { formatJourneyReply } = require('../src/journey-reply');

test('journey reply renders stored facts deterministically', () => {
  const reply = formatJourneyReply({
    name: 'Jesh',
    journeys: [{
      startAt: '2026-08-13T15:00:00.000Z',
      endAt: '2026-08-13T15:30:00.000Z',
      distanceKm: 2.43,
      originGeofenceName: 'Home',
    }],
  });
  assert.match(reply, /Recent journeys for Jesh/);
  assert.match(reply, /2\.4 km/);
  assert.match(reply, /30 min/);
  assert.match(reply, /from Home/);
});

test('journey reply is explicit when no confirmed journey exists', () => {
  assert.equal(
    formatJourneyReply({ name: 'Jesh', journeys: [] }),
    'No confirmed journeys are available for Jesh yet.',
  );
});

test('journey reply fails without claiming journey data', () => {
  assert.doesNotMatch(formatJourneyReply({ error: 'offline' }), /\bkm\b/i);
});
