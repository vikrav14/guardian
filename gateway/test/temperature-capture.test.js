'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createTemperatureCapture, startTemperatureCapture, WINDOW_MS, MAX_PACKETS } = require('../src/temperature-capture');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');

const IMEI = '861000000000001';
const NOW = Date.parse('2026-09-15T14:00:00Z');
const consent = { version: 1, status: 'granted', managedBy: 'guardian_admin',
  wearerAcknowledgedAt: new Date(NOW - 60_000) };
// Arbitrary engineering fixture: these fields are NOT a claimed temperature format.
const packet = () => ({ command: 'btemp2', args: ['1', '003412', ''], payload: 'btemp2,1,003412,' });
function fixture(overrides = {}) {
  const records = [], statuses = [];
  const capture = createTemperatureCapture({ enabled: true, pilotImei: IMEI,
    clock: () => NOW, readConsent: async () => consent,
    write: async record => records.push(record), onStatus: status => statuses.push(status), ...overrides });
  return { capture, records, statuses };
}

test('capture is opt-in, pilot-only and limited to the observed command', async () => {
  for (const options of [{ enabled: false }, { pilotImei: '' }, {}]) {
    const f = fixture(options);
    f.capture.observe(packet(), { imei: '861000000000002' });
    for (const command of ['bphrt', 'oxygen', 'bodytemp2', 'UD_LTE', 'LK']) {
      f.capture.observe({ ...packet(), command }, { imei: IMEI });
    }
    if (options.enabled === false || options.pilotImei === '') f.capture.observe(packet(), { imei: IMEI });
    await f.capture.flush();
    assert.deepEqual(f.records, []);
  }
  assert.equal(startTemperatureCapture().active, false);
});

test('preserves unparsed strings and receipt time without adding health events or changing ACKs', async () => {
  const payload = packet().payload;
  const frame = Buffer.from(`[3G*${IMEI}*${payload.length.toString(16).padStart(4, '0')}*${payload}]`);
  const decoded = decodeFrame(frame), session = {};
  const result = handlePacket(decoded, session);
  const original = structuredClone(result);
  const { capture, records } = fixture();
  assert.equal(capture.observe(decoded, session, new Date(NOW)), undefined);
  decoded.args[1] = 'changed-after-receipt';
  await capture.flush();
  assert.deepEqual(structuredClone(result), original);
  assert.equal(result.events[0].type, 'unknown_command');
  assert.equal(result.acks[0].toString(), '[SG*0000000000*0006*btemp2]');
  assert.deepEqual(records, [{ version: 1, command: 'btemp2', receivedAt: new Date(NOW).toISOString(),
    timeBasis: 'gateway_receipt', fieldMeaning: 'unverified', args: ['1', '003412', ''] }]);
});

test('revoked, missing, expired or unreadable consent cannot save payloads', async () => {
  for (const value of [null, { ...consent, status: 'revoked' },
    { ...consent, revokedAt: new Date(NOW) }, { ...consent, expiresAt: new Date(NOW) }]) {
    const f = fixture({ readConsent: async () => value });
    f.capture.observe(packet(), { imei: IMEI });
    await f.capture.flush();
    assert.deepEqual(f.records, []);
    assert.deepEqual(f.statuses, ['consent_required']);
  }
  const f = fixture({ readConsent: async () => { throw new Error('private data must not be logged'); } });
  f.capture.observe(packet(), { imei: IMEI });
  await f.capture.flush();
  assert.deepEqual(f.records, []);
  assert.deepEqual(f.statuses, ['capture_failed']);
});

test('expired window and expiry during a pending consent read prevent writes', async () => {
  let time = NOW, release;
  const f = fixture({ clock: () => time,
    readConsent: () => new Promise(resolve => { release = resolve; }) });
  f.capture.observe(packet(), { imei: IMEI });
  await Promise.resolve();
  time = NOW + WINDOW_MS;
  release(consent);
  await f.capture.flush();
  f.capture.observe(packet(), { imei: IMEI });
  await f.capture.flush();
  assert.deepEqual(f.records, []);
});

test('bounds pending work and rejects oversized or malformed packets', async () => {
  const f = fixture();
  for (const invalid of [
    { ...packet(), error: 'length_mismatch' }, { ...packet(), args: null },
    { ...packet(), payload: 'btemp2,different' },
    { ...packet(), args: Array(33).fill('x') },
    { command: 'btemp2', args: ['x'.repeat(257)], payload: `btemp2,${'x'.repeat(257)}` },
    { command: 'btemp2', args: Array(20).fill('x'.repeat(200)),
      payload: ['btemp2', ...Array(20).fill('x'.repeat(200))].join(',') },
  ]) f.capture.observe(invalid, { imei: IMEI });
  await f.capture.flush();
  assert.deepEqual(f.records, []);
  for (let i = 0; i < 100; i++) f.capture.observe(packet(), { imei: IMEI });
  await f.capture.flush();
  assert.equal(f.records.length, MAX_PACKETS);
});

test('write/log failures are isolated and later capture work can proceed', async () => {
  let calls = 0;
  const f = fixture({ write: async () => { if (++calls === 1) throw new Error('disk failed'); },
    onStatus: () => { throw new Error('logger failed'); } });
  f.capture.observe(packet(), { imei: IMEI });
  f.capture.observe(packet(), { imei: IMEI });
  await assert.doesNotReject(f.capture.flush());
  assert.equal(calls, 2);
});

test('runtime writes a bounded private file, reads consent only, and redacts console payloads', async t => {
  const logs = [], reads = [];
  const db = { collection: name => ({ doc: imei => ({ get: async () => {
    reads.push({ name, imei });
    return { exists: true, data: () => ({ ...consent, wearerAcknowledgedAt: new Date(0) }) };
  } }) }) };
  const capture = startTemperatureCapture({ enabled: true,
    config: { careWellbeingIngestEnabled: true, wifiHomePilotImei: IMEI }, db,
    log: line => logs.push(line) });
  const armed = JSON.parse(logs[0].slice('[temperature-capture] '.length));
  t.after(() => fs.rm(armed.savedTo, { force: true }));
  capture.observe(packet(), { imei: IMEI });
  capture.observe(packet(), { imei: IMEI });
  await capture.flush();
  const lines = (await fs.readFile(armed.savedTo, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].args, packet().args);
  assert.deepEqual(reads, Array(2).fill({ name: 'wellbeingConsents', imei: IMEI }));
  assert.ok(logs.some(line => line.includes('packet_saved')));
  assert.ok(logs.every(line => !line.includes('003412') && !line.includes(IMEI)));
  if (process.platform !== 'win32') assert.equal((await fs.stat(armed.savedTo)).mode & 0o777, 0o600);
});
