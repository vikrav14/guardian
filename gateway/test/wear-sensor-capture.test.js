'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWearSensorCapture, startWearSensorCapture, WINDOW_MS, MAX_PACKETS } = require('../src/wear-sensor-capture');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');

const IMEI = '861000000000001';
const NOW = Date.parse('2026-09-16T16:00:00Z');
const consent = { version: 1, status: 'granted', managedBy: 'guardian_admin',
  wearerAcknowledgedAt: new Date(NOW - 60_000) };
// Synthetic extra fields deliberately have no claimed V52 meaning.
function packet(command = 'bphrt', args = ['118', '76', '71', 'EXPERIMENTAL_FLAG', '0', '']) {
  const payload = [command, ...args].join(',');
  return { decoded: { command, args, payload }, frame: Buffer.from(
    `[3G*${IMEI}*${Buffer.byteLength(payload).toString(16).padStart(4, '0')}*${payload}]`) };
}
function fixture(options = {}) {
  let now = NOW;
  const records = [], statuses = [], reads = [];
  const capture = createWearSensorCapture({ enabled: true, pilotImei: IMEI,
    clock: () => now, readConsent: async imei => { reads.push(imei); return consent; },
    write: async record => records.push(record), onStatus: status => statuses.push(status), ...options });
  const session = { imei: IMEI };
  return { capture, records, statuses, reads, session, time: value => { now = value; },
    observe: (input = packet(), s = session) => capture.observe(input.decoded, s, new Date(now), input.frame) };
}

test('sensor capture is disabled by default and only reads consent for the exact pilot and allowed uploads', async () => {
  assert.equal(createWearSensorCapture().active, false);
  assert.equal(startWearSensorCapture().active, false);
  for (const options of [{ enabled: false }, { pilotImei: '' }, {}]) {
    const f = fixture(options);
    if (options.enabled === false || options.pilotImei === '') f.observe();
    f.observe(packet(), { imei: '861000000000002' });
    for (const command of ['LK', 'UD_LTE', 'CONFIG', 'DEVMESSAGE', 'btemp2', 'hrtstart']) {
      f.observe(packet(command));
    }
    await f.capture.flush();
    assert.deepEqual(f.records, []);
    assert.deepEqual(f.reads, []);
  }
});

test('real decoder ACKs and health events stay unchanged while trailing, empty and failure fields survive capture', async () => {
  const f = fixture();
  const input = packet();
  const decoded = decodeFrame(input.frame);
  const session = {};
  const result = handlePacket(decoded, session);
  const original = structuredClone(result);
  assert.equal(f.capture.observe(decoded, session, new Date(NOW), input.frame), undefined);
  decoded.args[3] = 'changed-after-receipt';
  f.observe(packet('oxygen', ['0', '', 'FAIL']));
  f.observe(packet('BPHRT', []));
  await f.capture.flush();
  assert.deepEqual(structuredClone(result), original);
  assert.equal(result.events[0].metric, 'heart_rate_bp');
  assert.equal(result.events[0].heartRate, 71);
  assert.equal(result.acks.length, 1);
  assert.match(result.acks[0].toString(), /\*0005\*bphrt\]$/);
  assert.deepEqual(f.records[0].args, ['118', '76', '71', 'EXPERIMENTAL_FLAG', '0', '']);
  assert.deepEqual(f.records[1].args, ['0', '', 'FAIL']);
  assert.deepEqual(f.records[2].args, []);
  assert.equal(f.records[2].command, 'BPHRT');
  assert.deepEqual(f.records.map(r => r.session), [1, 2, 2]);
  for (const record of f.records) {
    assert.equal(record.wearingInferred, false);
    assert.equal(record.fieldMeaning, 'unverified');
    assert.equal(record.timeBasis, 'gateway_receipt');
    assert.equal(record.receivedAt, new Date(NOW).toISOString());
    assert.equal(record.payloadLengthMatches, true);
  }
  assert.equal(JSON.stringify(f.statuses).includes('EXPERIMENTAL_FLAG'), false);
  assert.equal(JSON.stringify(f.records).includes(IMEI), false);
});

test('missing, revoked, expired, future and unauthorized consent cannot save values', async () => {
  for (const value of [null, { ...consent, status: 'revoked' },
    { ...consent, revokedAt: new Date(NOW) }, { ...consent, expiresAt: new Date(NOW) },
    { ...consent, wearerAcknowledgedAt: new Date(NOW + 1) }, { ...consent, managedBy: 'client' }]) {
    const f = fixture({ readConsent: async () => value });
    f.observe();
    await f.capture.flush();
    assert.deepEqual(f.records, []);
    assert.deepEqual(f.statuses, ['consent_required']);
  }
  let current = consent;
  const f = fixture({ readConsent: async () => current });
  f.observe();
  await f.capture.flush();
  current = { ...consent, status: 'revoked' };
  f.observe();
  await f.capture.flush();
  assert.equal(f.records.length, 1);
  assert.equal(f.statuses.at(-1), 'consent_required');
});

test('consent and write failures cannot break subsequent packet handling or leak error details', async () => {
  let calls = 0;
  const f = fixture({ readConsent: async () => {
    if (++calls === 1) throw new Error('private data');
    return consent;
  } });
  assert.doesNotThrow(() => { f.observe(); f.observe(); });
  await f.capture.flush();
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.statuses, ['capture_failed', 'packet_saved']);
  const broken = fixture({ write: async () => { throw new Error('private path'); },
    onStatus: () => { throw new Error('private console'); } });
  assert.doesNotThrow(() => broken.observe());
  await assert.doesNotReject(broken.capture.flush());
});

test('ten-packet and time limits also bound pending work and recheck expiry after consent reads', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ readConsent: () => gate });
  for (let i = 0; i < MAX_PACKETS + 10; i++) f.observe();
  await Promise.resolve();
  assert.equal(f.capture.active, false);
  release(consent);
  await f.capture.flush();
  assert.equal(f.records.length, MAX_PACKETS);

  let releaseExpired;
  const expired = fixture({ readConsent: () => new Promise(resolve => { releaseExpired = resolve; }) });
  expired.observe();
  await Promise.resolve();
  expired.time(NOW + WINDOW_MS);
  releaseExpired(consent);
  await expired.capture.flush();
  expired.observe();
  assert.equal(expired.capture.active, false);
  assert.deepEqual(expired.records, []);
  const backwards = fixture();
  backwards.time(NOW - 1);
  backwards.observe();
  await backwards.capture.flush();
  assert.deepEqual(backwards.reads, []);
});

test('malformed or oversize payloads never reach consent reads; header mismatch remains diagnostic', async () => {
  const f = fixture();
  for (const input of [packet('bphrt', Array(33).fill('1')), packet('bphrt', ['x'.repeat(257)]),
    packet('bphrt', Array(9).fill('x'.repeat(240)))]) f.observe(input);
  const inconsistent = packet();
  inconsistent.decoded.payload = 'different';
  f.observe(inconsistent);
  f.capture.observe(packet().decoded, f.session, new Date(NaN));
  f.capture.observe(packet().decoded, f.session, new Date(NOW - 1));
  await f.capture.flush();
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.records, []);
  const input = packet();
  input.frame = Buffer.from(input.frame.toString().replace(/\*[0-9a-f]{4}\*/, '*FFFF*'));
  f.observe(input);
  await f.capture.flush();
  assert.equal(f.records[0].payloadLengthMatches, false);
});

test('runtime writes only a private local file with fresh consent, without Firestore writes or value logging', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-wear-sensors-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const log = [], reads = [];
  const capture = startWearSensorCapture({ enabled: true,
    config: { careWellbeingIngestEnabled: true, wifiHomePilotImei: IMEI }, directory,
    db: { collection(name) { return { doc(imei) { return { async get() {
      reads.push({ name, imei }); return { exists: true,
        data: () => ({ ...consent, wearerAcknowledgedAt: new Date(Date.now() - 60_000) }) };
    } }; } }; } }, log: line => log.push(line) });
  const input = packet();
  capture.observe(input.decoded, { imei: IMEI }, new Date(), input.frame);
  await capture.flush();
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const file = path.join(directory, files[0]);
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(record.args, input.decoded.args);
  assert.deepEqual(reads, [{ name: 'wellbeingConsents', imei: IMEI }]);
  assert.equal(log.join('\n').includes('EXPERIMENTAL_FLAG'), false);
  assert.equal(log.join('\n').includes('"sendsMeasurementRequests":false'), true);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.throws(() => startWearSensorCapture({ enabled: true, config: {}, db: {} }), /needs Firestore/);
});
