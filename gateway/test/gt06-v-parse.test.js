const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLocationData, handlePacket, decodeFrame } = require('../src/protocol/gt06');
const { parseLteExtras, normalizeMac, isPlaceholderCoords } = require('../src/geolocate/google');

function asciiFrame(factory, protocolId, command, payload = '') {
  const content = payload ? `${command},${payload}` : command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  return Buffer.from(`[${factory}*${protocolId}*${lenHex}*${content}]`, 'ascii');
}

test('parseLteExtras extracts cell towers and WiFi from vendor V tail', () => {
  const extras = [
    '460', '0', '10142', '225274433', '4', '10142', '54313355', '-4', '4', '',
    '8c:14:b4:5e:4b:a8', '-80', '', 'd0:c7:c0:57:af:d2', '-94',
  ];
  const { wifiAccessPoints, cellTowers } = parseLteExtras(extras);

  assert.equal(cellTowers.length, 2);
  assert.deepEqual(cellTowers[0], {
    mobileCountryCode: 460,
    mobileNetworkCode: 0,
    locationAreaCode: 10142,
    cellId: 225274433,
  });
  assert.deepEqual(cellTowers[1], {
    mobileCountryCode: 460,
    mobileNetworkCode: 0,
    locationAreaCode: 10142,
    cellId: 54313355,
    signalStrength: -4,
  });

  assert.equal(wifiAccessPoints.length, 2);
  assert.equal(wifiAccessPoints[0].macAddress, '8c:14:b4:5e:4b:a8');
  assert.equal(wifiAccessPoints[0].signalStrength, -80);
  assert.equal(wifiAccessPoints[1].macAddress, 'd0:c7:c0:57:af:d2');
  assert.equal(wifiAccessPoints[1].signalStrength, -94);
});

test('normalizeMac lowercases and converts dashes to colons', () => {
  assert.equal(normalizeMac('8C-14-B4-5E-4B-A8'), '8c:14:b4:5e:4b:a8');
});

test('isPlaceholderCoords flags factory Shenzhen and 0,0', () => {
  assert.equal(isPlaceholderCoords(0, 0), true);
  assert.equal(isPlaceholderCoords(22.68, 113.99), true);
  assert.equal(isPlaceholderCoords(-20.26, 57.48), false);
});

test('parseLocationData returns geolocation request for V with WiFi/cell', () => {
  const fields = [
    '241122', '062109', 'V', '22.680000', 'N', '113.990000', 'E', '0.0', '0',
    '460', '0', '10142', '225274433', '4', '10142', '54313355', '-4', '4', '',
    '8c:14:b4:5e:4b:a8', '-80', '', 'd0:c7:c0:57:af:d2', '-94',
  ];
  const loc = parseLocationData(fields);

  assert.equal(loc.gpsValid, false);
  assert.equal(loc.needsGeolocation, true);
  assert.equal(loc.accuracySource, 'wifi');
  assert.equal(loc.positioningMode, 'wifi');
  assert.equal(loc.wifiAccessPoints.length, 2);
  assert.equal(loc.cellTowers.length, 2);
  assert.equal(loc.location.lat, null);
  assert.equal(loc.location.lng, null);
  assert.ok(loc.location.recordedAt instanceof Date);
});

test('parseLocationData rejects V without WiFi or cell data', () => {
  const fields = ['241122', '062109', 'V', '22.653729', 'N', '114.014600', 'E', '0.0', '0'];
  const loc = parseLocationData(fields);
  assert.equal(loc.error, 'gps_not_fixed');
});

test('handlePacket emits location for V UD_LTE with WiFi scan', () => {
  const payload = [
    '241122', '062109', 'V', '22.680000', 'N', '113.990000', 'E', '0.0', '0',
    '617', '1', '12345', '67890123', '2', '', 'aa:bb:cc:dd:ee:ff', '-70',
  ].join(',');
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].type, 'location');
  assert.equal(events[0].needsGeolocation, true);
  assert.equal(events[0].accuracySource, 'wifi');
});

test('handlePacket emits location_parse_error for bare V without extras', () => {
  const payload = '241122,062109,V,22.653729,N,114.014600,E,0.0,0';
  const frame = asciiFrame('3G', '9705314117', 'UD_LTE', payload);
  const { events } = handlePacket(decodeFrame(frame), {});

  assert.equal(events[0].type, 'location_parse_error');
  assert.equal(events[0].reason, 'gps_not_fixed');
});
