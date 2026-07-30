const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFrames, decodeFrame, handlePacket, buildAckFrame } = require('../src/protocol/gt06');

function asciiFrame(factory, protocolId, command, payload = '') {
  const content = payload ? `${command},${payload}` : command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  return Buffer.from(`[${factory}*${protocolId}*${lenHex}*${content}]`, 'ascii');
}

test('extractFrames pulls a complete ASCII frame and leaves the rest untouched', () => {
  const frame = asciiFrame('3G', '9705314117', 'LK', '0,0,80');
  const extra = Buffer.from('tail', 'ascii');
  const { frames, rest } = extractFrames(Buffer.concat([frame, extra]));

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], frame);
  assert.deepEqual(rest, extra);
});

test('decodeFrame parses factory, protocol id, command, and args', () => {
  const frame = asciiFrame('3G', '9705314117', 'LK', '0,0,80');
  const decoded = decodeFrame(frame);

  assert.equal(decoded.factory, '3G');
  assert.equal(decoded.imei, '9705314117');
  assert.equal(decoded.command, 'LK');
  assert.deepEqual(decoded.args, ['0', '0', '80']);
});

test('handlePacket normalizes a 10-digit id to the 15-digit Firestore imei', () => {
  const frame = asciiFrame('3G', '9705314117', 'LK', '0,0,80');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'heartbeat');
  assert.equal(events[0].protocolId, '9705314117');
  assert.equal(events[0].imei, '861397053141170');
  assert.equal(session.imei, '861397053141170');
  assert.equal(acks.length, 1);
  assert.equal(acks[0].toString('ascii'), '[SG*9705314117*0002*LK]');
});

test('handlePacket parses a valid UD_LTE location', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0.0,0,0,0,0,00000000,0,0,0000,0';
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location');
  assert.equal(events[0].imei, '861397053141170');
  assert.ok(Math.abs(events[0].location.lat - 22.653729) < 0.0001);
  assert.ok(Math.abs(events[0].location.lng - 114.0146) < 0.0001);
  assert.equal(events[0].speedKmh, 0);
  assert.equal(events[0].course, 0);
});

test('handlePacket ignores UD_LTE when GPS is V with no WiFi/cell data', () => {
  const payload = '241122,062109,V,22.653729,N,114.014600,E,0.0,0';
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location_parse_error');
  assert.equal(events[0].reason, 'gps_not_fixed');
  assert.equal(events[0].gpsFlag, 'V');
  assert.ok(events[0].payloadPreview.includes('241122,062109,V'));
});

test('handlePacket reads speed from field 7 and course from field 8', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0.0,45';
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].speedKmh, 0);
  assert.equal(events[0].course, 45);
});

test('handlePacket parses simulator-style short UD_LTE payloads', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,5.00,45';
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].speedKmh, 5);
  assert.equal(events[0].course, 45);
});

test('handlePacket still ACKs an unknown command without throwing', () => {
  const frame = asciiFrame('3G', '9705314117', 'RYIMEI', '861397053141170');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.some((e) => e.type === 'imei_report'), true);
  assert.equal(acks.length, 1);
});

test('handlePacket ACKs CONFIG with CONFIG,1 per vendor spec', () => {
  const frame = asciiFrame('3G', '9705314117', 'CONFIG', '861397053141170');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks } = handlePacket(decoded, session);

  assert.equal(acks.length, 1);
  assert.equal(acks[0].toString('ascii'), '[SG*9705314117*0008*CONFIG,1]');
});

test('buildAckFrame uses the protocol id the device expects in replies', () => {
  const ack = buildAckFrame('9705314117', 'LK');
  assert.equal(ack.toString('ascii'), '[SG*9705314117*0002*LK]');
});

test('handlePacket parses AL_LTE SOS alarm with alarmCode from state field', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0,0,00010000';
  const frame = asciiFrame('3G', '9705314117', 'AL_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'sos');
  assert.equal(events[0].alarmCode, '00010000');
  assert.equal(acks[0].toString('ascii'), '[SG*9705314117*0002*AL]');
});

test('handlePacket parses UD2 blind-spot re-upload with no ack (server no need reply)', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0.0,45';
  const frame = asciiFrame('3G', '9705314117', 'UD2', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(acks.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location');
  assert.equal(events[0].blindSpotReupload, true);
});

test('handlePacket parses oxygen (SpO2) upload and acks with status 1', () => {
  const frame = asciiFrame('3G', '9705314117', 'oxygen', '0,98');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'health_reading');
  assert.equal(events[0].metric, 'spo2');
  assert.equal(events[0].value, 98);
  assert.equal(acks[0].toString('ascii'), '[SG*9705314117*0008*oxygen,1]');
});

test('handlePacket parses bphrt (heart rate + blood pressure) upload', () => {
  const frame = asciiFrame('3G', '9705314117', 'bphrt', '120,72,72,,,,');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'health_reading');
  assert.equal(events[0].metric, 'heart_rate_bp');
  assert.equal(events[0].systolic, 120);
  assert.equal(events[0].diastolic, 72);
  assert.equal(events[0].heartRate, 72);
  assert.equal(acks.length, 1);
});

test('handlePacket parses AL_LTE fall alarm from bit 22 (V52 protocol spec)', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0,0,00400000';
  const frame = asciiFrame('3G', '9705314117', 'AL_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'fall');
  assert.equal(events[0].severity, 'critical');
});

test('handlePacket parses AL_LTE with gps=V as alarm with geolocation when WiFi present', () => {
  const payload = [
    '241122', '062109', 'V', '22.680000', 'N', '113.990000', 'E', '0', '0',
    '617', '1', '12345', '67890123', '1', '', 'aa:bb:cc:dd:ee:ff', '-70', '00010000',
  ].join(',');
  const frame = asciiFrame('3G', '9705314117', 'AL_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'sos');
  assert.equal(events[0].needsGeolocation, true);
  assert.equal(events[0].accuracySource, 'wifi');
});
