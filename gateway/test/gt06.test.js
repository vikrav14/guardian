const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFrames, decodeFrame, handlePacket, buildAck, PROTO } = require('../src/protocol/gt06');
const { crc16Itu, appendCrc } = require('../src/protocol/crc');

function buildFrame(protocol, info, serial) {
  const body = Buffer.concat([
    Buffer.from([protocol]),
    info,
    Buffer.from([(serial >> 8) & 0xff, serial & 0xff]),
  ]);
  const length = body.length + 2; // + crc
  const withLength = Buffer.concat([Buffer.from([length]), body]);
  const withCrc = appendCrc(withLength);
  return Buffer.concat([Buffer.from([0x78, 0x78]), withCrc, Buffer.from([0x0d, 0x0a])]);
}

test('extractFrames pulls a complete 0x7878 frame and leaves the rest untouched', () => {
  const loginInfo = Buffer.from('0102030405060708', 'hex');
  const frame = buildFrame(PROTO.LOGIN, loginInfo, 1);
  const extra = Buffer.from([0x01, 0x02]);

  const { frames, rest } = extractFrames(Buffer.concat([frame, extra]));

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], frame);
  assert.deepEqual(rest, extra);
});

test('extractFrames waits for more data on a truncated frame', () => {
  const loginInfo = Buffer.from('0102030405060708', 'hex');
  const frame = buildFrame(PROTO.LOGIN, loginInfo, 1);
  const truncated = frame.subarray(0, frame.length - 3);

  const { frames, rest } = extractFrames(truncated);

  assert.equal(frames.length, 0);
  assert.deepEqual(rest, truncated);
});

test('decodeFrame reports crcOk=true for a well-formed frame and false when corrupted', () => {
  const loginInfo = Buffer.from('0102030405060708', 'hex');
  const frame = buildFrame(PROTO.LOGIN, loginInfo, 1);

  const good = decodeFrame(frame);
  assert.equal(good.crcOk, true);
  assert.equal(good.protocol, PROTO.LOGIN);

  const corrupted = Buffer.from(frame);
  corrupted[5] ^= 0xff; // flip a byte inside the CRC-covered range
  const bad = decodeFrame(corrupted);
  assert.equal(bad.crcOk, false);
});

test('handlePacket parses a LOGIN packet into an imei and sets session.imei', () => {
  const loginInfo = Buffer.from('0035963310012345', 'hex'); // -> bcd-decodes toward 359633100123456-ish
  const frame = buildFrame(PROTO.LOGIN, loginInfo, 7);
  const decoded = decodeFrame(frame);
  const session = { imei: null };

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'login');
  assert.equal(session.imei, events[0].imei);
  assert.equal(acks.length, 1);
});

test('handlePacket parses a LOCATION packet with a valid lat/lng', () => {
  // datetime(6) + sats(1) + lat(4) + lng(4) + speed(1) + course/status(2)
  const info = Buffer.alloc(18);
  info.writeUInt8(26, 0); // year 2026
  info.writeUInt8(1, 1); // month
  info.writeUInt8(1, 2); // day
  info.writeUInt8(12, 3); // hour
  info.writeUInt8(0, 4); // minute
  info.writeUInt8(0, 5); // second
  info.writeUInt8(0x0c, 6); // satellites nibble = 12
  info.writeUInt32BE(Math.round(20.2642 * 1800000), 7); // magnitude; south flag below negates it
  info.writeUInt32BE(Math.round(57.4791 * 1800000), 11); // east longitude
  info.writeUInt8(45, 15); // speed km/h
  info.writeUInt16BE(0x1400 | 0x0400, 16); // gpsFixed bit + south bit, course 0

  const frame = buildFrame(PROTO.LOCATION, info, 2);
  const decoded = decodeFrame(frame);
  const session = { imei: '123456789012345' };

  const { events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location');
  assert.ok(events[0].location.lat < 0, 'south latitude should be negative');
  assert.ok(Math.abs(events[0].location.lat - -20.2642) < 0.001);
  assert.ok(Math.abs(events[0].location.lng - 57.4791) < 0.001);
  assert.equal(events[0].speedKmh, 45);
});

test('handlePacket still ACKs an unknown protocol without throwing', () => {
  const frame = buildFrame(0x99, Buffer.from([0x00]), 3);
  const decoded = decodeFrame(frame);

  const { acks, events } = handlePacket(decoded, { imei: 'x' });

  assert.equal(events[0].type, 'unknown');
  assert.equal(acks.length, 1);
});

test('buildAck round-trips through crc16Itu', () => {
  const ack = buildAck(PROTO.HEARTBEAT, 42);
  assert.equal(ack[0], 0x78);
  assert.equal(ack[1], 0x78);
  assert.equal(ack[ack.length - 2], 0x0d);
  assert.equal(ack[ack.length - 1], 0x0a);
  const crcData = ack.subarray(2, ack.length - 4);
  const crcExpected = ack.readUInt16BE(ack.length - 4);
  assert.equal(crc16Itu(crcData), crcExpected);
});
