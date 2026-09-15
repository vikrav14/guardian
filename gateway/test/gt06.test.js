const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFrames, decodeFrame, handlePacket, buildAckFrame } = require('../src/protocol/gt06');

function asciiFrame(factory, protocolId, command, payload = '') {
  const content = payload ? `${command},${payload}` : command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  return Buffer.from(`[${factory}*${protocolId}*${lenHex}*${content}]`, 'ascii');
}

function v52AlarmPayload(trackerState, gpsFlag = 'A') {
  // Full V52 Annex I order. Tracker state is index 15 and the LTE tail
  // deliberately continues through a final voltage value.
  return [
    '050218', '060013', gpsFlag, '43.720963', 'N', '123.2604950', 'E',
    '0.00', '244.2', '0.0', '19', '40', '56', '0', '0', trackerState,
    '2', '255', '460', '0', '18264', '22511', '125',
    '18264', '22512', '115', '0', '3.4',
  ].join(',');
}

function v52WifiAlarmPayload(trackerState) {
  return [
    '230726', '080947', 'V', '22.683546', 'N', '113.9907380', 'E',
    '0.00', '0.0', '0.0', '0', '100', '80', '0', '0', trackerState,
    '1', '0', '617', '1', '53', '203778', '169',
    '1', '', 'A4:08:EA:56:E7:BD', '-87', '0.0',
  ].join(',');
}

test('extractFrames pulls a complete ASCII frame and leaves the rest untouched', () => {
  const frame = asciiFrame('3G', '9700000000', 'LK', '0,0,80');
  const extra = Buffer.from('tail', 'ascii');
  const { frames, rest } = extractFrames(Buffer.concat([frame, extra]));

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], frame);
  assert.deepEqual(rest, extra);
});

test('decodeFrame parses factory, protocol id, command, and args', () => {
  const frame = asciiFrame('3G', '9700000000', 'LK', '0,0,80');
  const decoded = decodeFrame(frame);

  assert.equal(decoded.factory, '3G');
  assert.equal(decoded.imei, '9700000000');
  assert.equal(decoded.command, 'LK');
  assert.deepEqual(decoded.args, ['0', '0', '80']);
});

test('handlePacket normalizes a 10-digit id to the 15-digit Firestore imei', () => {
  const frame = asciiFrame('3G', '9700000000', 'LK', '0,0,80');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'heartbeat');
  assert.equal(events[0].protocolId, '9700000000');
  assert.equal(events[0].imei, session.imei);
  assert.match(events[0].imei, /^\d{15}$/);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0002*LK]');
});

test('handlePacket retains all LK raw counters and battery, including zero', () => {
  const frame = asciiFrame('3G', '9700000000', 'LK', '1234,50,0');
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].type, 'heartbeat');
  assert.equal(events[0].stepsRaw, 1234);
  assert.equal(events[0].rollCountRaw, 50);
  assert.equal(events[0].batteryPercent, 0);
});

test('handlePacket parses a valid UD_LTE location', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0.0,0,0,0,0,00000000,0,0,0000,0';
  const frame = asciiFrame('3G', '9700000000', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location');
  assert.equal(events[0].imei, session.imei);
  assert.match(events[0].imei, /^\d{15}$/);
  assert.ok(Math.abs(events[0].location.lat - 22.653729) < 0.0001);
  assert.ok(Math.abs(events[0].location.lng - 114.0146) < 0.0001);
  assert.equal(events[0].speedKmh, 0);
  assert.equal(events[0].course, 0);
});

test('handlePacket ignores UD_LTE when GPS is V with no WiFi/cell data', () => {
  const payload = '241122,062109,V,22.653729,N,114.014600,E,0.0,0';
  const frame = asciiFrame('3G', '9700000000', 'UD_LTE', payload);
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
  const frame = asciiFrame('3G', '9700000000', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].speedKmh, 0);
  assert.equal(events[0].course, 45);
});

test('handlePacket parses simulator-style short UD_LTE payloads', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,5.00,45';
  const frame = asciiFrame('3G', '9700000000', 'UD_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].speedKmh, 5);
  assert.equal(events[0].course, 45);
});

test('handlePacket still ACKs an unknown command without throwing', () => {
  const frame = asciiFrame('3G', '9700000000', 'RYIMEI', '000000000000001');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.some((e) => e.type === 'imei_report'), true);
  assert.equal(acks.length, 1);
});

test('handlePacket ACKs CONFIG with CONFIG,1 per vendor spec', () => {
  const frame = asciiFrame('3G', '9700000000', 'CONFIG', '000000000000001');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks } = handlePacket(decoded, session);

  assert.equal(acks.length, 1);
  assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0008*CONFIG,1]');
});

test('buildAckFrame uses the protocol id the device expects in replies', () => {
  const ack = buildAckFrame('9700000000', 'LK');
  assert.equal(ack.toString('ascii'), '[SG*9700000000*0002*LK]');
});

test('handlePacket reads V52 SOS from fixed tracker-state field, not final LTE value', () => {
  const payload = v52AlarmPayload('00010000');
  const frame = asciiFrame('3G', '9700000000', 'AL_LTE', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'sos');
  assert.equal(events[0].alarmCode, '00010000');
  assert.equal(events[0].alarmStateIndex, 15);
  assert.equal(events[0].alarmArgCount, 28);
  assert.notEqual(events[0].alarmCode, decoded.args.at(-1));
  assert.equal(decoded.args.at(-1), '3.4');
  assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0002*AL]');
});

test('handlePacket does not accept a shortened legacy alarm layout', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0,0,00010000';
  const frame = asciiFrame('3G', '9700000000', 'AL_LTE', payload);
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].alarmType, 'other');
  assert.equal(events[0].alarmCode, undefined);
});

test('handlePacket parses UD2 blind-spot re-upload with no ack (server no need reply)', () => {
  const payload = '241122,062109,A,22.653729,N,114.014600,E,0.0,45';
  const frame = asciiFrame('3G', '9700000000', 'UD2', payload);
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(acks.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'location');
  assert.equal(events[0].blindSpotReupload, true);
});

test('handlePacket parses oxygen (SpO2) upload and acks with status 1', () => {
  const frame = asciiFrame('3G', '9700000000', 'oxygen', '0,98');
  const decoded = decodeFrame(frame);
  const session = {};

  const { acks, events } = handlePacket(decoded, session);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'health_reading');
  assert.equal(events[0].metric, 'spo2');
  assert.equal(events[0].value, 98);
  assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0008*oxygen,1]');
});

test('handlePacket rejects out-of-range oxygen values with status 2', () => {
  const frame = asciiFrame('3G', '9700000000', 'oxygen', '0,101');
  const decoded = decodeFrame(frame);

  const { acks, events } = handlePacket(decoded, {});

  assert.deepEqual(events, []);
  assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0008*oxygen,2]');
});

test('handlePacket parses bphrt (heart rate + blood pressure) upload', () => {
  const frame = asciiFrame('3G', '9700000000', 'bphrt', '120,72,72,,,,');
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

test('handlePacket parses V52 fall alarm from bit 22', () => {
  const frame = asciiFrame('3G', '9700000000', 'AL_LTE', v52AlarmPayload('00400000'));
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'fall');
  assert.equal(events[0].severity, 'critical');
});

test('handlePacket rejects bit 21 as a V52 fall alarm', () => {
  const frame = asciiFrame('3G', '9700000000', 'AL_LTE', v52AlarmPayload('00200000'));
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].alarmCode, '00200000');
  assert.equal(events[0].alarmType, 'other');
});

test('handlePacket uses V52 bits 18 and 19 for safe-zone transitions', () => {
  const exitFrame = asciiFrame('3G', '9700000000', 'AL_LTE', v52AlarmPayload('00040000'));
  const enterFrame = asciiFrame('3G', '9700000000', 'AL_LTE', v52AlarmPayload('00080000'));

  assert.equal(handlePacket(decodeFrame(exitFrame), {}).events[0].alarmType, 'geofence_exit');
  assert.equal(handlePacket(decodeFrame(enterFrame), {}).events[0].alarmType, 'geofence_enter');
});

test('handlePacket uses V52 bit 20 for bracelet removal, not safe-zone exit', () => {
  const frame = asciiFrame('3G', '9700000000', 'AL_LTE', v52AlarmPayload('00100008'));
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].alarmType, 'bracelet_removed');
});

test('handlePacket parses full V52 gps=V alarm and keeps WiFi geolocation tail', () => {
  const frame = asciiFrame(
    '3G',
    '9700000000',
    'AL_LTE',
    v52WifiAlarmPayload('00010000')
  );
  const decoded = decodeFrame(frame);
  const session = {};

  const { events } = handlePacket(decoded, session);

  assert.equal(events[0].type, 'alarm');
  assert.equal(events[0].alarmType, 'sos');
  assert.equal(events[0].alarmCode, '00010000');
  assert.equal(events[0].needsGeolocation, true);
  assert.equal(events[0].accuracySource, 'wifi');
});
