const test = require('node:test');
const assert = require('node:assert/strict');
const { encodePolyline, decodePolyline } = require('../src/polyline');

test('encodePolyline and decodePolyline round-trip', () => {
  const points = [
    { lat: -20.2642, lng: 57.4791 },
    { lat: -20.265, lng: 57.48 },
    { lat: -20.266, lng: 57.4815 },
  ];

  const encoded = encodePolyline(points);
  assert.ok(encoded.length > 0);

  const decoded = decodePolyline(encoded);
  assert.equal(decoded.length, points.length);
  for (let i = 0; i < points.length; i += 1) {
    assert.ok(Math.abs(decoded[i].lat - points[i].lat) < 0.00001);
    assert.ok(Math.abs(decoded[i].lng - points[i].lng) < 0.00001);
  }
});

test('decodePolyline returns empty for invalid input', () => {
  assert.deepEqual(decodePolyline(''), []);
  assert.deepEqual(decodePolyline(null), []);
});
