'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSummary, parseArguments } = require('../scripts/capture-wifi-session');
const { FrameObserver } = require('../scripts/capture-movement-session');
const ID = '1234567890';
const radio = '02:aa:bb:cc:dd:01';
const frame = body => {
  const buffer = Buffer.from(body, 'latin1');
  return Buffer.concat([Buffer.from(`[3G*${ID}*${buffer.length.toString(16).padStart(4, '0')}*`), buffer, Buffer.from(']')]);
};
function report({ command = 'UD_LTE', flag = 'V', state = '00000000', wifi = ['1', 'Secret SSID', radio, '-61'] } = {}) {
  return frame([command, '011026', '083400', flag, '20.123456', 'S', '57.654321', 'E',
    '0.0', '0', '0', '0', '90', '64', '12', '0', state, '1', '0', '617', '1', '53', '203778', '169', ...wifi].join(','));
}

test('Wi-Fi preview is standalone, side effect free, and supports several 10-minute intervals', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'capture.jsonl');
  const args = ['--backend', 'anytracking', '--protocol-id', ID,
    '--return-url', 'tcp://return.example.test:12345', '--output', output];
  assert.equal(parseArguments(args).minutes, 45);
  assert.equal(parseArguments([...args, '--minutes', '90']).minutes, 90);
  assert.throws(() => parseArguments([...args, '--minutes', '91']));
  assert.throws(() => parseArguments([...args, '--listen-port', '9000']));
  const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-wifi-session.js'), ...args],
    { env: {}, encoding: 'utf8', timeout: 3000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.networkOpened, false);
  assert.equal(result.fileCreated, false);
  assert.equal(result.guardianTelemetryPausedDuringComparison, true);
  assert.equal(result.routerNamesAndAddressesSaved, false);
  assert.equal(fs.existsSync(output), false);
});

test('fence configuration preserves slots, delimiters and empty removal fields using matching radio aliases', () => {
  const summarize = createSummary();
  const command = summarize(frame(`WIFIFENCE,01,${radio.toUpperCase()},2,,-1,Private Name,+23055555555`), ID, 'server_to_watch');
  assert.deepEqual(command.fenceArguments[0], { kind: 'numeric', text: '01' });
  assert.equal(command.fenceArguments[1].alias, 'router_1');
  assert.equal(command.fenceArguments[1].letterCase, 'upper');
  assert.equal(command.fenceArguments[3].kind, 'empty');
  assert.equal(command.nativeFenceApplied, false);
  const scan = summarize(report(), ID, 'watch_to_server');
  assert.equal(scan.scan.radios[0].alias, 'router_1');
  assert.equal(scan.scan.radios[0].signalDbm, -61);
  const ack = summarize(frame('WIFIFENCE'), ID, 'watch_to_server');
  assert.equal(ack.bareReply, true);
  const persisted = JSON.stringify([command, scan, ack]);
  for (const secret of [radio, radio.toUpperCase(), 'Private Name', '+23055555555', 'Secret SSID',
    '20.123456', '57.654321', '203778', ID]) assert.equal(persisted.includes(secret), false, secret);
  assert.equal(command.frame, undefined);
  assert.equal(command.frameHex, undefined);
});

test('generic fence bits never claim Wi-Fi provenance and scans work with valid or invalid GPS', () => {
  const summarize = createSummary();
  for (const flag of ['A', 'V']) {
    const row = summarize(report({ command: 'AL_LTE', flag, state: '000C0000' }), ID, 'watch_to_server');
    assert.equal(row.reportedAt, '2026-10-01T08:34:00.000Z');
    assert.equal(row.gpsFlag, flag);
    assert.equal(row.batteryPercent, 64);
    assert.equal(row.genericFenceExitBit, true);
    assert.equal(row.genericFenceEntryBit, true);
    assert.equal(row.fenceSource, 'unconfirmed');
    assert.equal(row.scan.status, 'decoded');
  }
  assert.equal(summarize(report(), ID, 'server_to_watch').scan, undefined);
});

test('missing, empty, malformed and invalid-radio scans remain distinct and never leak SSIDs resembling MACs', () => {
  const summarize = createSummary();
  assert.equal(summarize(report({ wifi: [] }), ID, 'watch_to_server').scan.status, 'not_reported');
  assert.deepEqual(summarize(report({ wifi: ['0'] }), ID, 'watch_to_server').scan.radios, []);
  assert.equal(summarize(report({ wifi: ['1', radio, 'broken', '-60'] }), ID, 'watch_to_server').scan.status, 'invalid_radio_entries');
  const invalid = summarize(report({ wifi: ['1', 'name', '00:00:00:00:00:00', '-60'] }), ID, 'watch_to_server');
  assert.equal(invalid.scan.rejectedRadios, 1);
  assert.deepEqual(invalid.scan.radios, []);
  assert.equal(summarize(frame('AL_LTE,short'), ID, 'watch_to_server').trackerState, undefined);
});

test('fragmentation preserves observation while arbitrary/private/binary command contents stay hidden', () => {
  const rows = [], observer = new FrameObserver({ protocolId: ID, direction: 'server_to_watch',
    emit: row => rows.push(row), summarize: createSummary() });
  const bytes = Buffer.concat([frame('UPLOAD,600'), frame('CR'), frame('CONFIG,1'),
    frame('MONITOR,+23055555555'), frame('SecretName,PrivatePayload'), frame('PHOTO,\xff\x00][')]);
  for (let i = 0; i < bytes.length; i += 3) observer.push(bytes.subarray(i, i + 3));
  observer.finish();
  assert.equal(rows.length, 6);
  assert.equal(rows[0].requestedUploadSeconds, 600);
  assert.equal(rows[4].command, 'OTHER');
  for (const row of rows) { assert.equal(row.frame, undefined); assert.equal(row.frameHex, undefined); }
  for (const secret of ['+23055555555', 'SecretName', 'PrivatePayload', '\\u0000']) assert.equal(JSON.stringify(rows).includes(secret), false);
});

test('router alias and fence argument limits are explicit', () => {
  const summarize = createSummary();
  for (let i = 0; i < 512; i++) {
    const suffix = i.toString(16).padStart(4, '0');
    summarize(frame(`WIFIFENCE,1,02:00:00:00:${suffix.slice(0, 2)}:${suffix.slice(2)}`), ID, 'server_to_watch');
  }
  const limited = summarize(frame(`WIFIFENCE,1,${radio}`), ID, 'server_to_watch');
  assert.equal(limited.fenceArguments[1].reason, 'alias_limit');
  const fields = summarize(frame(`WIFIFENCE,${Array(40).fill('1').join(',')}`), ID, 'server_to_watch');
  assert.equal(fields.fenceArgumentsTruncated, true);
  assert.equal(fields.fenceArguments.length, 24);
});
