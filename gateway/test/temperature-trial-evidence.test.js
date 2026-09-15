'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTemperatureTrialEvidence, CAPTURE_WINDOW_MS, VALUE_RETENTION_MS,
  MAX_PACKETS } = require('../src/temperature-trial-evidence');

const NOW = Date.parse('2026-09-15T20:00:00Z');
function packet(command = 'btemp2', args = ['1', '36.68']) {
  return { command, args, payload: [command, ...args].join(',') };
}
function fixture() {
  let now = NOW;
  const session = { imei: '861000000000001', protocolId: '9700000001' };
  const evidence = createTemperatureTrialEvidence({ clock: () => now });
  return { evidence, session, tick: delta => { now += delta; },
    start: options => evidence.start(session, { operatorPosition: 'worn',
      requestedAt: new Date(now), trialId: 'temperature-test', ...options }),
    observe: (value = packet(), origin = session, at = new Date(now)) => evidence.observe(value, origin, at),
    current: options => evidence.current(session, options) };
}

test('starts only an explicit supervised trial and never upgrades acceptance', () => {
  const f = fixture();
  assert.equal(f.current().outcome, 'no_trial');
  for (const options of [{ operatorPosition: undefined }, { operatorPosition: 'unknown' },
    { modeBt: 1 }, { trialId: 'private value,not allowed' }, { requestedAt: new Date(NOW + 1) },
    { command: 'bodytemp,1,1' }, { command: 'BodyTemp2' }, { command: 'btemp2' }, { command: null }]) {
    assert.throws(() => f.start(options));
  }
  const started = f.start();
  assert.equal(started.phase, 'waiting');
  assert.equal(started.command, 'bodytemp2');
  assert.equal(started.modeBtAtRequest, null);
  assert.equal(started.operatorPositionIsManual, true);
  assert.throws(() => f.start(), /already observing/);
  assert.throws(() => f.evidence.markHandoff('success'));
  f.evidence.markHandoff('command_handed_off');
  assert.throws(() => f.evidence.markHandoff('command_handed_off'), /already recorded/);
  f.tick(1000); f.observe();
  const observed = f.current();
  assert.equal(observed.outcome, 'upload_observed_after_request');
  for (const flag of ['measurementConfirmed', 'requestCausedUpload', 'settingsConfirmed', 'wearingConfirmed', 'scheduleVerified']) {
    assert.equal(observed[flag], false);
  }
});

test('isolates the original session and ignores prior, future and other command packets', () => {
  const f = fixture();
  f.observe();
  f.start();
  f.observe(packet(), f.session, new Date(NOW - 1));
  f.observe(packet(), f.session, new Date(NOW + 1));
  f.observe(packet(), { ...f.session });
  f.observe(packet('bphrt'));
  f.observe(packet('BODYTEMP3', []));
  assert.equal(f.current().packets.length, 0);
  f.tick(1); f.observe();
  assert.equal(f.current().counts.uploads, 1);
  // A reference whose identity fields change must not inherit the old trial.
  f.session.imei = '861000000000002';
  f.tick(1); f.observe();
  assert.equal(f.current().phase, 'session_changed');
  assert.equal(f.current().counts.uploads, 1);
});

test('explicit uppercase probe preserves command case and distinguishes cross-case replies', () => {
  const f = fixture();
  const started = f.start({ command: 'BODYTEMP2' });
  assert.equal(started.command, 'BODYTEMP2');
  f.evidence.markHandoff('command_handed_off');
  f.tick(1); f.observe(packet('bodytemp2', []));
  f.tick(1); f.observe(packet('BODYTEMP2', []));
  const replies = f.current();
  assert.equal(replies.counts.replies, 2);
  assert.equal(replies.outcome, 'reply_received_awaiting_upload');
  assert.deepEqual(replies.packets.map(value => ({ command: value.command,
    matchesRequestedCommand: value.matchesRequestedCommand })), [
    { command: 'bodytemp2', matchesRequestedCommand: false },
    { command: 'BODYTEMP2', matchesRequestedCommand: true },
  ]);
  assert.equal(replies.measurementConfirmed, false);
  assert.equal(replies.requestCausedUpload, false);
  f.tick(1); f.observe();
  const upload = f.current({ includeValues: true });
  assert.equal(upload.outcome, 'upload_observed_after_request');
  assert.equal(upload.packets[2].command, 'btemp2');
  assert.equal(Object.hasOwn(upload.packets[2], 'matchesRequestedCommand'), false);
  assert.deepEqual(upload.packets[2].args, ['1', '36.68']);
  assert.equal(upload.measurementConfirmed, false);
  assert.equal(upload.requestCausedUpload, false);
});

test('an uppercase reply during a lowercase trial stays a nonmatching observation', () => {
  const f = fixture(); f.start();
  f.tick(1); f.observe(packet('BODYTEMP2', []));
  f.tick(CAPTURE_WINDOW_MS);
  const result = f.current();
  assert.equal(result.command, 'bodytemp2');
  assert.equal(result.outcome, 'reply_without_upload');
  assert.equal(result.packets[0].matchesRequestedCommand, false);
  assert.equal(result.measurementConfirmed, false);
});

test('separates bare reply from uploaded data and reports an unanswered measurement window', () => {
  const f = fixture();
  f.start(); f.evidence.markHandoff('command_handed_off');
  f.tick(100); f.observe(packet('bodytemp2', []));
  assert.equal(f.current().outcome, 'reply_received_awaiting_upload');
  assert.equal(f.current().counts.replies, 1);
  assert.equal(f.current().counts.uploads, 0);
  f.tick(CAPTURE_WINDOW_MS);
  f.observe();
  assert.equal(f.current().phase, 'capture_timeout');
  assert.equal(f.current().outcome, 'reply_without_upload');
  assert.equal(f.current().packets.length, 1);
  f.start();
  f.tick(CAPTURE_WINDOW_MS);
  assert.equal(f.current().outcome, 'no_reply_or_upload');
});

test('keeps values opt-in and bounded, expires them while retaining metadata', () => {
  const f = fixture();
  f.start(); f.evidence.markHandoff('handoff_unknown');
  f.tick(1); f.observe();
  const normal = f.current();
  assert.equal(normal.handoff, 'handoff_unknown');
  assert.equal(normal.valuesIncluded, false);
  assert.ok(!JSON.stringify(normal).includes('36.68'));
  const explicit = f.current({ includeValues: true });
  assert.deepEqual(explicit.packets[0].args, ['1', '36.68']);
  explicit.packets[0].args[1] = 'not shared';
  assert.equal(f.current({ includeValues: true }).packets[0].args[1], '36.68');
  f.tick(CAPTURE_WINDOW_MS);
  assert.equal(f.current({ includeValues: true }).packets[0].args[1], '36.68');
  f.tick(VALUE_RETENTION_MS);
  const expired = f.current({ includeValues: true, at: new Date(NOW + 2) });
  assert.equal(expired.valuesExpired, true);
  assert.equal(expired.valuesIncluded, false);
  assert.equal(expired.counts.uploads, 1);
  assert.ok(!JSON.stringify(expired).includes('36.68'));
  // Moving the caller's inspection time backwards cannot restore purged data.
  assert.ok(!JSON.stringify(f.current({ includeValues: true, at: new Date(NOW + 2) })).includes('36.68'));
});

test('retains metadata and values on reconnect without accepting the new session', () => {
  const f = fixture(); f.start(); f.tick(1); f.observe();
  const nextSession = { ...f.session };
  const disconnected = f.evidence.current(null);
  assert.equal(disconnected.phase, 'session_changed');
  assert.equal(disconnected.sessionMatches, false);
  f.tick(1); f.observe(packet(), nextSession);
  f.observe();
  const next = f.evidence.current(nextSession, { includeValues: true });
  assert.equal(next.phase, 'session_changed');
  assert.equal(next.counts.uploads, 1);
  assert.equal(next.packets[0].args[1], '36.68');
});

test('rejects malformed, oversized, nonnumeric and identifier payloads without retaining raw data', () => {
  const f = fixture(); f.start();
  const invalid = [
    { ...packet(), error: 'secret must not be stored' },
    { ...packet(), args: null },
    { ...packet(), payload: 'btemp2,secret-mismatch' },
    packet('btemp2', Array(9).fill('1')),
    packet('btemp2', ['password=secret-too-long']),
    packet('btemp2', ['861000000000001']),
    packet('btemp2', ['NaN']),
    packet('btemp2', []),
    packet('bodytemp2', ['1']),
  ];
  for (const value of invalid) { f.tick(1); f.observe(value); }
  const result = f.current({ includeValues: true });
  assert.equal(result.counts.rejected, invalid.length);
  assert.equal(result.counts.uploads, 0);
  const raw = JSON.stringify(result);
  for (const secret of ['secret', '861000000000001', '9700000001', 'NaN', 'password']) assert.ok(!raw.includes(secret));
  assert.ok(result.packets.every(value => !Object.hasOwn(value, 'args')));
});

test('retains numeric sentinels as unverified fields, bounds records and deduplicates same receipt', () => {
  const f = fixture(); f.start();
  const sentinel = packet('btemp2', ['0', '-1', '65535']);
  f.tick(1); f.observe(sentinel); f.observe(sentinel);
  assert.equal(f.current().counts.duplicates, 1);
  for (let i = 0; i < 30; i++) { f.tick(1); f.observe(); }
  const result = f.current({ includeValues: true });
  assert.equal(result.packets.length, MAX_PACKETS);
  assert.equal(result.counts.uploads, MAX_PACKETS);
  assert.equal(result.counts.dropped, 21);
  assert.deepEqual(result.packets[0].args, ['0', '-1', '65535']);
  assert.equal(result.measurementConfirmed, false);
  assert.equal(result.packets[0].fieldMeaning, 'unverified');
});

test('a command that was not sent cannot collect a later unsolicited upload', () => {
  const f = fixture(); f.start(); f.evidence.markHandoff('not_sent');
  f.tick(1); f.observe();
  assert.equal(f.current().phase, 'not_sent');
  assert.equal(f.current().outcome, 'not_sent');
  assert.equal(f.current().packets.length, 0);
});

test('removed trial records its reported position without claiming worn or promoting readings', () => {
  const f = fixture();
  const started = f.start({ operatorPosition: 'removed', command: 'BODYTEMP2' });
  assert.equal(started.operatorPosition, 'removed');
  assert.equal(started.operatorPositionIsManual, true);
  assert.equal(started.dataUse, 'engineering_trial_only');
  f.evidence.markHandoff('command_handed_off');
  f.tick(1); f.observe();
  const result = f.current({ includeValues: true });
  assert.equal(result.operatorPosition, 'removed');
  assert.equal(result.dataUse, 'engineering_trial_only');
  assert.equal(result.wearingConfirmed, false);
  assert.equal(result.measurementConfirmed, false);
  assert.equal(result.scheduleVerified, false);
  assert.equal(result.packets[0].args[1], '36.68');
});
