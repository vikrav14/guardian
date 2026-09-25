'use strict';

// Bounded frame/structure decoder, shared by offline tools and live ingress.
// Live ingress additionally performs full pixel decoding and authorization.
// See docs/testing/photo-reference-capture.md: 24 September Jesh img capture.
const ESCAPES = new Map([[1, 0x7d], [2, 0x5b], [3, 0x5d], [4, 0x2c], [5, 0x2a]]);
const RESERVED = new Set([0x5b, 0x5d, 0x2c, 0x2a]);
const MAX_FRAME_BYTES = 65556;
const MAX_DIMENSION = 1024;
// Observed after JPEG EOI: 1/2/6 in fully decoded reference samples, and 5 in
// the 25 September 17:47 MUT Guardian rejection diagnostics. Live ingress
// still requires full pixel decoding. Do not infer general padding semantics.
const OBSERVED_ZERO_TRAILER_LENGTHS = new Set([1, 2, 5, 6]);

class PhotoDecodeError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}
function fail(code, details) { throw new PhotoDecodeError(code, details); }

function unescapeMedia(bytes) {
  const decoded = Buffer.alloc(bytes.length);
  let written = 0, escapeCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x7d) {
      const mapped = ESCAPES.get(bytes[++i]);
      if (mapped === undefined) fail('invalid_media_escape');
      decoded[written++] = mapped;
      escapeCount++;
    } else {
      if (RESERVED.has(bytes[i])) fail('unescaped_media_delimiter');
      decoded[written++] = bytes[i];
    }
  }
  return { bytes: decoded.subarray(0, written), escapeCount };
}

function inspectJpegStructure(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('jpeg_soi_missing');
  let offset = 2, width, height, components, scanSeen = false;
  let quantizationSeen = false, huffmanSeen = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail('jpeg_marker_expected');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scanSeen || !width || !quantizationSeen || !huffmanSeen) fail('jpeg_incomplete');
      return { width, height, components, jpegEnd: offset };
    }
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) fail('unsupported_jpeg_marker');
    if (offset + 2 > bytes.length) fail('jpeg_segment_truncated');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail('jpeg_segment_truncated');
    if (marker === 0xdb) quantizationSeen = true;
    if (marker === 0xc4) huffmanSeen = true;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (marker !== 0xc0 || width || length < 8 || bytes[offset + 2] !== 8) fail('unsupported_jpeg_frame');
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      components = bytes[offset + 7];
      if (![1, 3].includes(components) || length !== 8 + components * 3) fail('unsupported_jpeg_components');
      if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) fail('jpeg_dimensions_out_of_bounds');
    }
    if (marker === 0xda) {
      if (!width || scanSeen || !quantizationSeen || !huffmanSeen) fail('unsupported_jpeg_scan');
      if (length < 6 || bytes[offset + 2] !== components || length !== 6 + 2 * components) fail('unsupported_jpeg_scan');
      scanSeen = true;
      offset += length;
      const scanStart = offset;
      // Skip byte stuffing and restart markers; lengths apply to marker
      // segments, never to arbitrary FF/EOI-looking bytes inside APP metadata.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { offset = next + 1; continue; }
        break;
      }
      if (offset === scanStart) fail('jpeg_scan_empty');
      continue;
    }
    offset += length;
  }
  fail('jpeg_eoi_missing');
}

function decodeV52PhotoFrame(frame, expectedProtocolId) {
  if (!/^\d{10}$/.test(expectedProtocolId || '')) fail('expected_protocol_id_required');
  if (!Buffer.isBuffer(frame) || frame.length < 21 || frame.length > MAX_FRAME_BYTES) fail('frame_size_invalid');
  const header = /^\[3G\*(\d{10})\*([0-9a-fA-F]{4})\*$/.exec(frame.subarray(0, 20).toString('latin1'));
  if (!header || frame.at(-1) !== 0x5d) fail('unsupported_photo_frame');
  if (header[1] !== expectedProtocolId) fail('photo_identity_mismatch');
  const payload = frame.subarray(20, -1);
  if (parseInt(header[2], 16) !== payload.length) fail('photo_length_mismatch');
  let comma = -1;
  for (let i = 0; i < 3; i++) {
    comma = payload.indexOf(0x2c, comma + 1);
    if (comma < 0 || comma > 64) fail('unsupported_img_header');
  }
  const fields = /^img,([0-9]{1,3}),([0-9]{12}),$/.exec(payload.subarray(0, comma + 1).toString('latin1'));
  if (!fields) fail('unsupported_img_header');
  const encoded = payload.subarray(comma + 1);
  const decoded = unescapeMedia(encoded);
  const dimensions = inspectJpegStructure(decoded.bytes);
  const trailer = decoded.bytes.subarray(dimensions.jpegEnd);
  // Preserve only observed all-zero trailers after the structurally parsed
  // EOI; embedded EOI bytes and nonzero/unobserved trailers remain rejected.
  if (!OBSERVED_ZERO_TRAILER_LENGTHS.has(trailer.length) || trailer.some(byte => byte !== 0)) {
    fail('unsupported_image_trailer', {
      jpegBytes: dimensions.jpegEnd, width: dimensions.width, height: dimensions.height,
      trailerBytes: trailer.length, trailerAllZero: trailer.every(byte => byte === 0),
    });
  }
  return {
    jpeg: Buffer.from(decoded.bytes.subarray(0, dimensions.jpegEnd)),
    metadata: {
      protocolId: header[1], command: 'img', prefix: '3G', lengthField: header[2],
      payloadBytes: payload.length, imageFieldRaw: fields[1], deviceTimestampRaw: fields[2],
      escapedMediaBytes: encoded.length, escapeCount: decoded.escapeCount,
      jpegBytes: dimensions.jpegEnd, trailingBytesHex: trailer.toString('hex'),
      width: dimensions.width, height: dimensions.height, components: dimensions.components,
      mimeType: 'image/jpeg', validation: 'jpeg_structure_only',
      requestCorrelationVerified: false, appliedStateVerified: false,
    },
  };
}

module.exports = { decodeV52PhotoFrame, unescapeMedia, inspectJpegStructure, MAX_FRAME_BYTES, PhotoDecodeError };
