'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWearEvidence, parseWearSignal, wearAt, ACCEPTED_MODE } = require('../src/wear-evidence');
const { reduceCounterLedger } = require('../src/activity-counter-ledger');
const { normalizeActivityObservation } = require('../src/activity-steps');
const { loadWearReport } = require('../scripts/inspect-wear-evidence');
const imei = '999999999999999', start = Date.parse('2026-09-14T18:00:00Z');
const at = seconds => new Date(start + seconds * 1000);
function packet(seconds, state = '00000008', command = 'UD_LTE') {
  const timestamp = at(seconds).toISOString().slice(11, 19).replaceAll(':', '');
  return { command, args: ['140926', timestamp, 'A', '20', 'S', '57', 'E', '0', '0',
    '0', '8', '90', '70', '1000', '0', state] };
}
function pilot(options = {}) {
  const observer = createWearEvidence({ enabled: true, deviceMode: ACCEPTED_MODE, acceptedImeis: [imei], ...options });
  const session = {};
  const capture = (seconds, state, command, currentSession = session) => {
    const events = [{ imei, type: 'heartbeat' }];
    observer.capture(packet(seconds, state, command), events, currentSession, at(seconds));
    return events[0].wearEvidence;
  };
  return { observer, session, capture };
}

test('wear parsing uses only the fixed Annex I field and ignores heartbeats/history/echoes', () => {
  for (const command of ['UD2', 'UD2_LTE', 'LK', 'TKQ', 'oxygen', 'REMOVESMS']) {
    assert.equal(parseWearSignal(packet(0, '00100008', command)), undefined);
  }
  assert.equal(parseWearSignal(packet(0, '00100000')).removalAlarmBit, true);
  assert.equal(parseWearSignal(packet(0, '00000008')).wearBit, true);
  const bad = packet(0, 'bad'); bad.args.push('00000008');
  assert.equal(parseWearSignal(bad), null);
  bad.args[0] = '310226'; assert.equal(parseWearSignal(bad), null);
});

test('both exact-device acceptance and repeated positive evidence are required', () => {
  for (const options of [{ deviceMode: 'unverified' }, { acceptedImeis: [] }]) {
    const { capture } = pilot(options);
    capture(0); assert.equal(capture(60).state, 'unknown');
  }
  const { capture } = pilot();
  assert.equal(capture(0).eligible, false);
  assert.equal(capture(30).eligible, false);
  assert.equal(capture(60).eligible, true);
});

test('removal interrupts qualification immediately; clear alarm does not restore worn', () => {
  const { capture } = pilot(); capture(0); const worn = capture(60);
  assert.equal(capture(80, '00100000').eligible, false);
  assert.equal(capture(140, '00000000').state, 'removed');
  assert.equal(capture(150, '00000000').state, 'removed');
  assert.equal(capture(170, '00000008').state, 'unknown');
  const restored = capture(230);
  assert.equal(restored.state, 'worn');
  assert.notEqual(restored.continuityId, worn.continuityId);
});

test('silence, invalid status and conflicting signals cannot be qualified as worn', () => {
  const { capture } = pilot(); capture(0); const worn = capture(60);
  assert.equal(wearAt(worn, at(180)).state, 'unknown');
  assert.equal(capture(181, '00000008', 'LK').state, 'unknown');
  assert.equal(capture(200).state, 'unknown');
  assert.equal(capture(260).state, 'worn');
  assert.equal(capture(270, '00100008').state, 'unknown');
  assert.equal(capture(280, 'garbage').state, 'unknown');
});

test('replays and future/history packets never renew wearing evidence', () => {
  const { observer, session, capture } = pilot(); capture(0); capture(60);
  for (const [decoded, receipt] of [[packet(60), 100], [packet(300), 110], [packet(180, '00000008', 'UD2'), 180]]) {
    const events = [{ imei }]; observer.capture(decoded, events, session, at(receipt));
    assert.equal(events[0].wearEvidence.observedAt?.getTime() || null, receipt < 180 ? +at(60) : null);
  }
});

test('reconnect/restart requires new evidence and old socket close cannot clear a new session', () => {
  const { observer, session, capture } = pilot(); capture(0); const old = capture(60);
  const nextSession = {};
  assert.equal(capture(70, undefined, 'LK', nextSession).state, 'unknown');
  capture(80, undefined, undefined, nextSession);
  const next = capture(140, undefined, undefined, nextSession);
  observer.disconnect(imei, session, at(150));
  assert.equal(capture(160, undefined, 'LK', nextSession).state, 'worn');
  assert.notEqual(next.continuityId, old.continuityId);
  assert.equal(pilot().capture(170).state, 'unknown');
});

test('raw midnight diagnostics continue; off-wrist increments never enter wearer reports on restoration', () => {
  const { capture } = pilot(); capture(0);
  let state, day;
  const record = (seconds, raw, wear) => {
    const observation = normalizeActivityObservation({ imei, stepsRaw: raw, wearEvidence: wear }, { receivedAt: at(seconds) });
    const result = reduceCounterLedger(state, day, observation, { counterMode: 'observed_delta', customerEnabled: true });
    state = result.state; day = result.day; return result;
  };
  record(60, 1000, capture(60));
  record(90, 1098, capture(90));
  assert.equal(day.reportedSteps, 98);
  record(100, 1110, capture(100, '00100000'));
  record(160, 1140, capture(160, '00100000'));
  capture(170); record(230, 1200, capture(230));
  assert.equal(day.reportedSteps, 98); // restoration is a fresh baseline
  record(260, 1220, capture(260));
  assert.equal(day.reportedSteps, 118); assert.equal(day.recordedSteps, 220);
  assert.equal(day.wearExcludedSteps, 102);
  assert.equal(day.coverage, 'partial');
});

test('even removal/restoration wholly between counters breaks interval continuity', () => {
  const { capture } = pilot(); capture(0); const before = capture(60);
  capture(70, '00100000'); capture(130, '00100000'); capture(140); const after = capture(200);
  const first = reduceCounterLedger(null, null, normalizeActivityObservation({ imei, stepsRaw: 1000, wearEvidence: before }, { receivedAt: at(60) }));
  const second = reduceCounterLedger(first.state, first.day, normalizeActivityObservation({ imei, stepsRaw: 1098, wearEvidence: after }, { receivedAt: at(200) }));
  assert.equal(second.day.recordedSteps, 98); assert.equal(second.day.wearQualifiedSteps, 0);
});

test('diagnostic report redacts identity and treats expired state as unknown', async () => {
  const data = { deviceMode: ACCEPTED_MODE, deviceAccepted: true,
    status: { state: 'worn', observedAt: at(0), expiresAt: at(120) },
    samples: [{ ...parseWearSignal(packet(0)), receivedAt: at(0), imei, latitude: 20 }] };
  const ref = { collection: () => ref, doc: () => ref, get: async () => ({ exists: true, data: () => data }) };
  const report = await loadWearReport(ref, imei, at(121));
  assert.equal(report.wearingStatus, 'unknown');
  assert.doesNotMatch(JSON.stringify(report), /999999999999999|latitude/);
});
