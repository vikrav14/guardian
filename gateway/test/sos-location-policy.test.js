const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOS_FRESH_LOCATION_MAX_SECONDS,
  hasTrustworthyCoordinates,
  classifySosLocation,
  formatLocationAge,
} = require('../src/sos-location-policy');

const now = new Date('2026-08-13T00:00:00.000Z');

test('fresh fix at 2 minutes is classified fresh', () => {
  const result = classifySosLocation({
    device: {
      location: {
        lat: -20.16,
        lng: 57.50,
        recordedAt: new Date('2026-08-12T23:58:00.000Z'),
      },
    },
    now,
  });

  assert.equal(result.state, 'fresh');
  assert.equal(result.ageSeconds, 120);
});

test('10-minute boundary is still fresh', () => {
  const result = classifySosLocation({
    device: {
      location: {
        lat: -20.16,
        lng: 57.50,
        recordedAt: new Date(
          now.getTime() - SOS_FRESH_LOCATION_MAX_SECONDS * 1000
        ),
      },
    },
    now,
  });

  assert.equal(result.state, 'fresh');
});

test('38-minute trustworthy fix becomes last-known', () => {
  const result = classifySosLocation({
    device: {
      location: {
        lat: -20.16,
        lng: 57.50,
        recordedAt: new Date('2026-08-12T23:22:00.000Z'),
      },
    },
    now,
  });

  assert.equal(result.state, 'last_known');
  assert.equal(result.ageSeconds, 38 * 60);
});

test('valid coordinates with no timestamp are last-known, never fresh', () => {
  const result = classifySosLocation({
    device: {
      location: {
        lat: -20.16,
        lng: 57.50,
      },
    },
    now,
  });

  assert.equal(result.state, 'last_known');
  assert.equal(result.reason, 'timestamp_missing');
});

test('no coordinates are unavailable', () => {
  const result = classifySosLocation({
    device: { location: null },
    now,
  });

  assert.equal(result.state, 'unavailable');
});

test('0,0 is never used as an SOS location', () => {
  assert.equal(hasTrustworthyCoordinates({ lat: 0, lng: 0 }), false);

  const result = classifySosLocation({
    device: {
      location: {
        lat: 0,
        lng: 0,
        recordedAt: now,
      },
    },
    now,
  });

  assert.equal(result.state, 'unavailable');
});

test('out-of-range coordinates are unavailable', () => {
  assert.equal(
    hasTrustworthyCoordinates({ lat: 120, lng: 57.50 }),
    false
  );
});

test('materially future timestamp is never treated as current', () => {
  const result = classifySosLocation({
    device: {
      location: {
        lat: -20.16,
        lng: 57.50,
        recordedAt: new Date('2026-08-13T00:10:00.000Z'),
      },
    },
    now,
  });

  assert.equal(result.state, 'last_known');
  assert.equal(result.reason, 'timestamp_future_skew');
});

test('formatLocationAge is explicit and compact', () => {
  assert.equal(formatLocationAge(120), '2 mins ago');
  assert.equal(formatLocationAge(38 * 60), '38 mins ago');
  assert.equal(formatLocationAge((4 * 60 + 18) * 60), '4h 18m ago');
  assert.equal(formatLocationAge(null), 'time unavailable');
});
