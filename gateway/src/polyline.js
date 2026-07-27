/**
 * Minimal Google encoded polyline (precision 5).
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

function encodeSigned(value) {
  let v = value << 1;
  if (value < 0) v = ~v;
  let encoded = '';
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

function decodeSigned(value, index) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = value.charCodeAt(index++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);
  return { value: result & 1 ? ~(result >> 1) : result >> 1, index };
}

/**
 * @param {Array<{ lat: number, lng: number }>} points
 * @returns {string}
 */
function encodePolyline(points) {
  if (!Array.isArray(points) || points.length === 0) return '';

  let lastLat = 0;
  let lastLng = 0;
  let encoded = '';

  for (const point of points) {
    const lat = Math.round(Number(point.lat) * 1e5);
    const lng = Math.round(Number(point.lng) * 1e5);
    encoded += encodeSigned(lat - lastLat);
    encoded += encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return encoded;
}

/**
 * @param {string} encoded
 * @returns {Array<{ lat: number, lng: number }>}
 */
function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];

  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];

  while (index < encoded.length) {
    const latPart = decodeSigned(encoded, index);
    lat += latPart.value;
    index = latPart.index;

    const lngPart = decodeSigned(encoded, index);
    lng += lngPart.value;
    index = lngPart.index;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

module.exports = {
  encodePolyline,
  decodePolyline,
};
