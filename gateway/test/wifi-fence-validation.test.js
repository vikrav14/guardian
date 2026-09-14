'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWifiFenceCapture, documentedFenceCommand, commandPreview,
  CAPTURE_MS, MAX_ENTRIES } = require('../src/wifi-fence-validation');
const { fingerprintRouter } = require('../src/wifi-home-observer');
const { buildAckFrame, decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { sendDeviceCommand } = require('../src/commands');

const imei = '359633100123456';
const protocolId = '6331001234';
const routerId = '02:00:00:00:00:01';
const hashKey = 'ab'.repeat(32);
const start = Date.parse('2026-09-08T12:00:00Z');
const options = { imei, hashKey, startedAtMs: start,
  routerHash: fingerprintRouter({ imei, routerId, hashKey }) };

function packet(command = 'UD_LTE', seconds = 0, state = '00000000', wifi = true) {
  const time = new Date(start + seconds * 1000).toISOString().slice(11, 19).replace(/:/g, '');
  const args = ['080926', time, 'V', '0', 'N', '0', 'E', '0', '0', '0',
    '0', '70', '45', '0', '0', state, '1', '0', '617', '1', '53', '203778', '-80',
    ...(wifi ? ['1', routerId, '-68'] : ['0'])];
  const frame = buildAckFrame(protocolId, [command, ...args].join(','));
  const decoded = decodeFrame(frame);
  const result = handlePacket(decoded, { imei, protocolId });
  // The session binding is explicit here; no real identity is part of fixtures.
  for (const event of result.events) event.imei = imei;
  return { decoded, ...result };
}
function record(capture, data, now = start) {
  for (const event of data.events) capture.recordPacket(event,
    { command: data.decoded.command, trackerState: data.decoded.args[15] }, now);
}

test('documented three-slot frame matches supplier length; incomplete or padded forms fail', async () => {
  const radios = [routerId, '02:00:00:00:00:02', '02:00:00:00:00:03'];
  const command = documentedFenceCommand(radios);
  assert.match(buildAckFrame(protocolId, command).toString(), /\*0045\*WIFIFENCE,1,/);
  assert.equal(Buffer.byteLength(command), 69);
  for (const invalid of [[], [routerId], radios.slice(0, 2), [...radios, routerId],
    [routerId, routerId, routerId], [routerId, radios[1], ,], [routerId, '', radios[2]],
    [routerId, 'ff:ff:ff:ff:ff:ff', radios[2]], [routerId, '02:00:00:00:00:02*CR]', radios[2]]]) {
    assert.throws(() => documentedFenceCommand(invalid));
  }
  let sends = 0;
  await assert.rejects(sendDeviceCommand({}, imei, 'set_wifi_fence', { routers: radios }, {
    sendDownlinkCommand: () => { sends++; }, sendSms: () => { sends++; },
  }), /Unknown device command/);
  assert.equal(sends, 0);
  assert.equal(commandPreview().liveProvisioningAvailable, false);
  assert.equal(commandPreview().watchCommandsSent, 0);
});

test('V52 fence bits are captured independently of SOS classification, without changing events or ACKs', () => {
  const capture = createWifiFenceCapture(options);
  const data = packet('AL_LTE', 0, '00050000'); // SOS + fence exit
  const before = { decoded: structuredClone(data.decoded),
    events: structuredClone(data.events), acks: data.acks.map(ack => Buffer.from(ack)) };
  assert.equal(data.events[0].alarmType, 'sos');
  record(capture, data);
  assert.deepEqual(data, before);
  assert.match(data.acks[0].toString(), /\*0002\*AL\]/);
  const out = capture.snapshot(start, true);
  assert.equal(out.timeline[0].sosBit, true);
  assert.equal(out.timeline[0].fenceExitBit, true);
  assert.equal(out.timeline[0].fenceSource, 'unconfirmed');
  assert.equal(out.nativeFenceAccepted, false);
  assert.equal(out.homeClaim, false);
  // A shorter legacy-shaped packet cannot move the state field into a tail.
  capture.recordPacket({ ...data.events[0], alarmCode: '00080000' },
    { command: 'AL_LTE', trackerState: null }, start + 1000);
  assert.equal(capture.snapshot(start + 1000, true).timeline[1].fenceEnterBit, null);
});

test('regular reports, both fence bits, command responses and CR bursts never assert Home', () => {
  const capture = createWifiFenceCapture(options);
  record(capture, packet('UD_LTE', 0, '000C0000'));
  capture.recordCommand('CR', start + 1000);
  capture.recordPacket({ type: 'command_echo', imei }, { command: 'WIFIFENCE' }, start + 2000);
  capture.recordCommand('UPLOAD,600', start + 3000);
  capture.recordCommand(`WIFIFENCE,1,${routerId}`, start + 4000);
  record(capture, packet('UD_LTE', 600), start + 600_000);
  const out = capture.snapshot(start + 610_000, true);
  assert.equal(out.maxReportGapSeconds, 600);
  assert.equal(out.secondsSinceLastReport, 10);
  assert.equal(out.counts.fencePackets, 1);
  assert.equal(out.counts.freshRouterSightings, 2);
  assert.equal(out.counts.crHandoffs, 1);
  assert.equal(out.counts.uploadHandoffs, 1);
  assert.equal(out.counts.fenceHandoffs, 1);
  assert.equal(out.timeline[0].fenceExitBit, true);
  assert.equal(out.timeline[0].fenceEnterBit, true);
  assert.equal(out.timeline[2].settingsApplied, null);
  assert.equal(out.homeClaim, false);
});

test('heartbeats, stale/backlog/future/repeated data cannot increase fresh evidence', () => {
  const capture = createWifiFenceCapture(options);
  record(capture, packet('AL_LTE', 0, '00080000'));
  record(capture, packet('AL_LTE', 0, '00080000'), start + 1000);
  record(capture, packet('AL_LTE', 0, '00080000'), start + 130_000);
  record(capture, packet('UD2', 130, '00080000'), start + 130_000);
  record(capture, packet('UD_LTE', 200), start + 130_000);
  capture.recordPacket({ type: 'heartbeat', imei }, { command: 'LK' }, start + 180_000);
  const out = capture.snapshot(start + 180_000, true);
  assert.equal(out.counts.freshRouterSightings, 1);
  assert.equal(out.counts.freshFencePackets, 1);
  assert.equal(out.counts.heartbeats, 1);
  assert.equal(out.counts.staleOrInvalidReports, 3);
  assert.equal(out.secondsSinceLastRouterSighting, 180);
  assert.deepEqual(out.timeline.slice(0, 5).map(row => row.timeStatus),
    ['fresh', 'fresh', 'stale', 'buffered', 'future']);
});

test('captures are bounded, stop at expiry, reject free-text markers and exclude private data', () => {
  const capture = createWifiFenceCapture(options);
  const data = packet();
  data.events[0].name = 'private name';
  data.events[0].location.lat = -20.123456;
  data.events[0].raw = `private ${routerId}`;
  record(capture, data);
  const other = { type: 'heartbeat', imei: '359633100123457' };
  capture.recordPacket(other, { command: 'LK' }, start);
  assert.throws(() => capture.mark('free text with a private address', start));
  capture.mark('at_home', start);
  for (let i = 1; i <= MAX_ENTRIES + 10; i++) {
    capture.recordPacket({ type: 'heartbeat', imei }, { command: 'LK' }, start + i);
  }
  const out = capture.snapshot(start + 1000, true);
  assert.equal(out.retainedEntries, MAX_ENTRIES);
  assert.ok(out.droppedEntries > 0);
  const copy = capture.snapshot(start + 1000, true);
  copy.counts.reports = 900;
  copy.timeline[0].kind = 'changed';
  assert.equal(capture.snapshot(start + 1000).counts.reports, 1);
  const count = out.counts.heartbeats;
  capture.recordPacket({ type: 'heartbeat', imei }, { command: 'LK' }, start + CAPTURE_MS);
  capture.recordCommand('CR', start + CAPTURE_MS);
  assert.equal(capture.snapshot(start + CAPTURE_MS).phase, 'completed');
  assert.equal(capture.snapshot(start + CAPTURE_MS).counts.heartbeats, count);
  assert.throws(() => capture.mark('at_home', start + CAPTURE_MS), /No active/);
  for (const secret of [imei, routerId, hashKey, options.routerHash, 'private name', '-20.123456']) {
    assert.ok(!JSON.stringify(out).includes(secret));
  }
  const stopped = createWifiFenceCapture(options);
  stopped.stop(start + 1000);
  record(stopped, packet(), start + 2000);
  assert.equal(stopped.snapshot(start + 5000).counts.reports, 0);
  assert.equal(stopped.snapshot(start + 5000).elapsedSeconds, 1);
  const restarted = createWifiFenceCapture({ ...options, startedAtMs: start + 5000 });
  assert.notEqual(restarted.snapshot(start + 5000).captureId, stopped.snapshot(start).captureId);
  assert.equal(restarted.snapshot(start + 5000).counts.fencePackets, 0);
});

test('clock reversal and excessive radio lists are not treated as fresh router evidence', () => {
  const capture = createWifiFenceCapture(options);
  record(capture, packet(), start);
  record(capture, packet('UD_LTE', 1), start - 1);
  assert.equal(capture.snapshot(start).counts.reports, 1);
  const event = packet('UD_LTE', 1).events[0];
  event.wifiAccessPoints = Array(33).fill({ macAddress: routerId, signalStrength: -68 });
  capture.recordPacket(event, { command: 'UD_LTE' }, start + 1000);
  assert.equal(capture.snapshot(start + 1000).counts.freshRouterSightings, 1);
});
