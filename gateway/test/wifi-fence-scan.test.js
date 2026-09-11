'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { inspectV52WifiScan } = require('../src/wifi-fence-scan');
const { createWifiFenceCapture, CAPTURE_MS } = require('../src/wifi-fence-validation');
const { createWifiHomeObserver, fingerprintRouter } = require('../src/wifi-home-observer');
const { buildAckFrame, decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { controlWifiFenceValidation, observeWifiFencePacket,
  getWifiFenceValidation } = require('../src/wifi-fence-runtime');

const imei = '359633100123456';
const protocolId = '6331001234';
const routerId = '02:00:00:00:00:01';
const otherRadio = '02:00:00:00:00:02';
const hashKey = 'ab'.repeat(32);
const start = Date.parse('2026-09-11T12:00:00Z');
const options = { imei, hashKey, startedAtMs: start,
  routerHash: fingerprintRouter({ imei, routerId, hashKey }) };

function fields({ flag = 'A', seconds = 0, state = '00000000',
  wifi = ['1', 'Private Home', routerId.toUpperCase(), '-68', '0.0'],
  cells = ['1', '0', '617', '1', '53', '203778', '169'] } = {}) {
  const time = new Date(start + seconds * 1000).toISOString().slice(11, 19).replace(/:/g, '');
  return ['110926', time, flag, '20.123456', 'S', '57.123456', 'E', '0.0', '0',
    '0', flag === 'A' ? '5' : '0', '70', '50', '0', '0', state, ...cells, ...wifi];
}

function packet(input, command = 'UD_LTE') {
  const decoded = decodeFrame(buildAckFrame(protocolId, [command, ...fields(input)].join(',')));
  const output = handlePacket(decoded, { imei, protocolId });
  for (const event of output.events) event.imei = imei;
  return { decoded, ...output };
}

function record(capture, data, now = start) {
  for (const event of data.events) capture.recordPacket(event, {
    command: data.decoded.command, trackerState: data.decoded.args[15], args: data.decoded.args,
  }, now);
}

test('raw A and V scans reach the runtime capture without changing production events or GPS precedence', t => {
  const keys = ['wifiHomeObserveEnabled', 'wifiHomePilotImei', 'wifiHomeRouterHash', 'wifiHomeHashKey'];
  const saved = Object.fromEntries(keys.map(k => [k, config[k]]));
  Object.assign(config, { wifiHomeObserveEnabled: true, wifiHomePilotImei: imei,
    wifiHomeRouterHash: options.routerHash, wifiHomeHashKey: hashKey });
  const initial = controlWifiFenceValidation({ action: 'start' }, start);
  t.after(() => {
    controlWifiFenceValidation({ action: 'stop', captureId: initial.capture.captureId }, start + 60_000);
    Object.assign(config, saved);
  });
  const observer = createWifiHomeObserver({ ...options, enabled: true });
  for (const seconds of [0, 10, 20]) {
    const data = packet({ flag: 'V', seconds });
    observer.observe(data.events[0], start + seconds * 1000);
    observeWifiFencePacket(data.decoded, data.events, start + seconds * 1000);
  }
  assert.equal(observer.snapshot(start + 20_000).matchState, 'matched');
  const gps = packet({ seconds: 30 });
  assert.equal(gps.events[0].accuracySource, 'gps');
  assert.equal(gps.events[0].needsGeolocation, undefined);
  assert.equal(gps.events[0].wifiAccessPoints, undefined);
  const before = structuredClone({ decoded: gps.decoded, events: gps.events });
  const acks = gps.acks.map(x => x.toString());
  observeWifiFencePacket(gps.decoded, gps.events, start + 30_000);
  observer.observe(gps.events[0], start + 30_000);
  assert.equal(observer.snapshot(start + 30_000).reason, 'satellite_observation');
  assert.equal(observer.snapshot(start + 30_000).consecutiveMatches, 0);
  assert.deepEqual({ decoded: gps.decoded, events: gps.events }, before);
  assert.deepEqual(gps.acks.map(x => x.toString()), acks);
  const out = getWifiFenceValidation(start + 30_000, true).capture;
  assert.equal(out.scanDiagnosticsVersion, 1);
  assert.equal(out.counts.freshRouterSightings, 4);
  const row = out.timeline.at(-1);
  assert.equal(row.gpsValid, true);
  assert.equal(row.radioScanSource, 'packet_fields');
  assert.equal(row.radioScanStatus, 'decoded');
  assert.equal(row.radioScanLayout, 'named');
  assert.equal(row.declaredRadios, 1);
  assert.equal(row.radiosReported, 1);
  assert.equal(row.homeRouterSeen, true);
  assert.equal(row.signalDbm, -68);
  assert.equal(out.homeClaim, false);
  assert.equal(out.nativeFenceAccepted, false);
  assert.equal(out.counts.crHandoffs + out.counts.uploadHandoffs + out.counts.fenceHandoffs, 0);
  for (const secret of [imei, protocolId, routerId, routerId.toUpperCase(), hashKey,
    options.routerHash, 'Private Home', '20.123456', '57.123456', '203778']) {
    assert.ok(!JSON.stringify(out).includes(secret), 'diagnostics must redact private packet fields');
  }
});

test('declared cell count locates named and nameless Wi-Fi, including an empty SSID and zero cells', () => {
  const twoCells = ['2', '0', '617', '1', '53', '203778', '169', '53', '203779', '150'];
  for (const cells of [twoCells, ['0']]) {
    const out = inspectV52WifiScan(fields({ cells,
      wifi: ['2', '', routerId, '-61', 'Other', otherRadio, '-87', '4.4441'] }));
    assert.equal(out.status, 'decoded');
    assert.equal(out.declaredRadios, 2);
    assert.deepEqual(out.accessPoints, [
      { macAddress: routerId, signalStrength: -61 },
      { macAddress: otherRadio, signalStrength: -87 },
    ]);
  }
  const nameless = inspectV52WifiScan(fields({ wifi: ['1', routerId, '-68'] }));
  assert.equal(nameless.layout, 'nameless');
  assert.equal(nameless.accessPoints[0].macAddress, routerId);
});

test('missing, explicit zero, rejected addresses and malformed scans remain distinguishable', () => {
  const capture = createWifiFenceCapture(options);
  const cases = [
    { wifi: [], status: 'not_reported', count: null, declared: null },
    { wifi: ['0', '0.0'], status: 'decoded', count: 0, declared: 0 },
    { wifi: ['1', '', '00:00:00:00:00:00', '-68'], status: 'decoded', count: 0, declared: 1 },
    { wifi: ['1', 'Home', routerId], status: 'invalid_radio_entries', count: null, declared: 1 },
    { wifi: ['1', 'Home', routerId, '-68junk'], status: 'invalid_radio_entries', count: null, declared: 1 },
    { wifi: ['6', ...Array(6).fill(['Home', routerId, '-68']).flat()],
      status: 'invalid_radio_count', count: null, declared: null },
    { wifi: ['0', routerId, '-68'], status: 'invalid_radio_entries', count: null, declared: 0 },
  ];
  for (const [i, c] of cases.entries()) {
    record(capture, packet({ wifi: c.wifi, seconds: i }), start + i * 1000);
    const row = capture.snapshot(start + i * 1000, true).timeline.at(-1);
    assert.equal(row.radioScanStatus, c.status);
    assert.equal(row.radiosReported, c.count);
    assert.equal(row.declaredRadios, c.declared);
    assert.equal(row.homeRouterSeen, false);
    if (i === 2) assert.equal(row.rejectedRadios, 1);
  }
  assert.equal(capture.snapshot(start + 10_000).counts.freshRouterSightings, 0);
  for (const input of [null, ['short'], fields({ cells: ['999'] }), fields({ state: 'invalid' }),
    fields({ cells: ['1', 'not-a-delay', '617', '1', '53', '203778', '169'] })]) {
    assert.equal(inspectV52WifiScan(input).accessPoints, null);
  }
});

test('a MAC-shaped SSID is not mistaken for the enrolled radio; excessive or trailing data cannot create a sighting', () => {
  const capture = createWifiFenceCapture(options);
  record(capture, packet({ wifi: ['1', routerId, otherRadio, '-40'] }));
  let row = capture.snapshot(start, true).timeline[0];
  assert.equal(row.radioScanStatus, 'decoded');
  assert.equal(row.radiosReported, 1);
  assert.equal(row.homeRouterSeen, false);
  record(capture, packet({ seconds: 1,
    wifi: ['1', 'Other', otherRadio, '-60', '0.0', routerId, '-68'] }), start + 1000);
  row = capture.snapshot(start + 1000, true).timeline.at(-1);
  assert.equal(row.radioScanStatus, 'invalid_radio_entries');
  assert.equal(row.homeRouterSeen, false);
  assert.equal(capture.snapshot(start + 1000).counts.freshRouterSightings, 0);
});

test('GPS radio sightings retain source-time, buffered and duplicate rules, while SOS fields and ACKs stay intact', () => {
  const capture = createWifiFenceCapture(options);
  const sos = packet({ state: '00050000' }, 'AL_LTE');
  const original = structuredClone(sos.events);
  const acks = sos.acks.map(x => x.toString());
  record(capture, sos);
  record(capture, sos, start + 1000);
  record(capture, sos, start + 130_000);
  record(capture, packet({ seconds: 130 }, 'UD2'), start + 130_000);
  record(capture, packet({ seconds: 200 }), start + 130_000);
  const out = capture.snapshot(start + 130_000, true);
  assert.deepEqual(sos.events, original);
  assert.equal(sos.events[0].alarmType, 'sos');
  assert.equal(sos.events[0].location.source, 'gps');
  assert.deepEqual(sos.acks.map(x => x.toString()), acks);
  assert.match(acks[0], /\*0002\*AL\]/);
  assert.equal(out.timeline[0].homeRouterSeen, true);
  assert.equal(out.timeline[0].sosBit, true);
  assert.equal(out.timeline[0].fenceExitBit, true);
  assert.equal(out.timeline[0].fenceSource, 'unconfirmed');
  assert.deepEqual(out.timeline.map(x => x.timeStatus), ['fresh', 'fresh', 'stale', 'buffered', 'future']);
  assert.equal(out.counts.freshRouterSightings, 1);
  assert.equal(out.counts.freshFencePackets, 1);
  assert.equal(out.counts.staleOrInvalidReports, 3);
  assert.equal(out.homeClaim, false);
  // No packet-field access after expiry or for a different watch.
  const unreadable = new Proxy([], { get() { throw new Error('unexpected scan read'); } });
  assert.doesNotThrow(() => capture.recordPacket(sos.events[0], { args: unreadable }, start + CAPTURE_MS));
  assert.doesNotThrow(() => capture.recordPacket({ ...sos.events[0], imei: '359633100123457' },
    { args: unreadable }, start + 130_000));
});
