const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../docs/testing/sos-location-snapshot-reader.json');
const { readSosLocationSnapshot } = require('../src/sos-location-snapshot');

// Run the same reader contract in Flutter. Displaying a historical incident
// must not quietly select different coordinates from the WhatsApp alert.
for (const fixture of fixtures) {
  test(`app/gateway incident reader: ${fixture.name}`, () => {
    const actual = readSosLocationSnapshot({ sosLocationSnapshot: fixture.snapshot });
    const expected = fixture.expected;
    if (expected === null) {
      assert.equal(actual, null);
      return;
    }
    assert.ok(actual);
    assert.equal(actual.state, expected.state);
    assert.equal(actual.ageSeconds, expected.ageSeconds);
    assert.equal(actual.retainedSatellite, expected.retainedSatellite);
    assert.deepEqual(actual.location ? [actual.location.lat, actual.location.lng] : null,
      expected.coordinates);
    const network = actual.retainedSatellite &&
      ['wifi', 'lbs'].includes(actual.latestObservation?.source)
      ? actual.latestObservation.source : null;
    assert.equal(network, expected.secondarySource);
  });
}
