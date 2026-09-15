'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWearEvidence, parseWearSignal, wearAt, ACCEPTED_MODE, TRACE_LIMIT,
  TRACE_DEVICE_LIMIT } = require('../src/wear-evidence');
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

function diagnosticPilot() {
  const documents = new Map();
  const reference = path => ({ path, collection: name => reference(`${path}/${name}`),
    doc: name => reference(`${path}/${name}`),
    get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }) });
  const db = { collection: name => reference(name),
    runTransaction: async operation => operation({
      get: ref => ref.get(), set: (ref, value) => documents.set(ref.path, structuredClone(value)),
    }) };
  const observer = createWearEvidence({ db, enabled: true, deviceMode: ACCEPTED_MODE,
    acceptedImeis: [imei] });
  const session = {};
  return { observer, session, db,
    capture(decoded, receipt, socket = session) {
      const events = [{ imei }]; observer.capture(decoded, events, socket, at(receipt));
      return events[0].wearEvidence;
    },
    async report(receipt = 500) {
      // Persistence is coalesced and nonblocking; let its promise chain drain.
      await new Promise(setImmediate);
      return loadWearReport(db, imei, at(receipt));
    } };
}

test('receipt diagnostics retain same-second alarms, delayed/history and unrecognized status variants', async () => {
  const { capture, report } = diagnosticPilot();
  capture(packet(0), 0); capture(packet(60), 60);
  capture(packet(60, '00100000', 'AL_LTE'), 61);
  capture(packet(59, '00000000'), 62);
  capture(packet(0, '00000008'), 121);
  capture(packet(300, '00000000'), 122);
  capture(packet(100, '80000008', 'UD2'), 123);
  capture(packet(100, '80000000', 'AL_NEW'), 124);
  const data = await report(124);
  assert.equal(data.samples.length, 2); // Original accepted live collection is unchanged.
  assert.deepEqual(data.receivedStatusTrace.entries.filter(row => row.kind === 'status').map(row => row.decision), [
    'live_status_sample', 'live_status_sample', 'same_timestamp_removal_invalidated_wearing', 'out_of_order_device_time',
    'stale_device_time', 'future_device_time', 'buffered_history', 'unsupported_status_command',
  ]);
  const duplicateAlarm = data.receivedStatusTrace.entries.find(row => row.command === 'AL_LTE');
  assert.deepEqual(duplicateAlarm.setBits, [20]);
  assert.deepEqual(duplicateAlarm.changedBits, [3, 20]);
  assert.equal(duplicateAlarm.deviceObservedAt, at(60).toISOString());
  const history = data.receivedStatusTrace.entries.find(row => row.command === 'UD2');
  assert.deepEqual(history.setBits, [3, 31]);
  assert.deepEqual(history.changedBits, [3, 31]);
});

test('receipt diagnostics survive reconnect but cannot carry wearing acceptance across sessions', async () => {
  const { observer, session, capture, report } = diagnosticPilot();
  capture(packet(0, '00100000', 'AL_LTE'), 0);
  observer.disconnect(imei, session, at(1));
  const second = {};
  assert.equal(capture(packet(2), 2, second).eligible, false);
  observer.disconnect(imei, session, at(3)); // Closing the old socket cannot end the new trace.
  const data = await report(3);
  assert.equal(data.samples.length, 1);
  assert.deepEqual(data.receivedStatusTrace.entries.map(row => row.kind), [
    'session_started', 'status', 'session_disconnected', 'session_started', 'status',
  ]);
  assert.deepEqual(data.receivedStatusTrace.entries.map(row => row.session), [1, 1, 1, 2, 2]);
  assert.equal(data.receivedStatusTrace.entries[1].trackerState, '00100000');
  assert.equal(data.receivedStatusTrace.entries.at(-1).previousTrackerState, null);
  assert.equal(data.wearingStatus, 'unknown');
});

test('receipt trace is bounded and malformed packets never expose their payload or manufacture bits', async () => {
  const { capture, report } = diagnosticPilot();
  for (let i = 0; i < 150; i += 1) capture(packet(i), i);
  const bad = packet(151, 'private-payload'); bad.args.push('location-secret');
  capture(bad, 151);
  const data = await report(151);
  assert.equal(data.receivedStatusTrace.entries.length, TRACE_LIMIT);
  assert.equal(data.receivedStatusTrace.receivedStatusPackets, 151);
  assert.equal(data.receivedStatusTrace.droppedEntries, 32);
  assert.equal(data.samples.length, 120);
  const last = data.receivedStatusTrace.entries.at(-1);
  assert.equal(last.trackerState, null);
  assert.deepEqual(last.setBits, []);
  assert.equal(last.decision, 'invalid_status_packet');
  assert.doesNotMatch(JSON.stringify(data), /private-payload|location-secret|999999999999999/);
  assert.equal(data.wearingStatus, 'unknown');
});

test('evicting an old diagnostic trace cannot reset a live accepted wearing state', async () => {
  const { observer, capture, report } = diagnosticPilot();
  capture(packet(0), 0); const before = capture(packet(60), 60);
  for (let i = 0; i < TRACE_DEVICE_LIMIT; i += 1) {
    observer.capture(packet(70), [{ imei: String(100000000000000 + i) }], {}, at(70));
  }
  const after = capture(packet(90), 90);
  assert.equal(after.eligible, true);
  assert.equal(after.continuityId, before.continuityId);
  const data = await report(90);
  assert.equal(data.receivedStatusTrace.entries[0].kind, 'trace_resumed');
  assert.equal(data.receivedStatusTrace.receivedStatusPackets, 1);
  assert.equal(data.samples.length, 3);
});

test('same-second removal alarm immediately revokes wearing; duplicates cannot restore it', () => {
  const { observer, session, capture } = pilot();
  capture(0); assert.equal(capture(60).eligible, true);
  const alarm = [{ imei }];
  observer.capture(packet(60, '00100000', 'AL_LTE'), alarm, session, at(61));
  assert.equal(alarm[0].wearEvidence.eligible, false);
  assert.equal(alarm[0].wearEvidence.state, 'unknown');
  const duplicatePositive = [{ imei }];
  observer.capture(packet(60, '00000008'), duplicatePositive, session, at(62));
  assert.equal(duplicatePositive[0].wearEvidence.eligible, false);
  assert.equal(capture(63).eligible, false);
  assert.equal(capture(123).eligible, true);
});

test('same-second removal cancels pending worn confirmation, while older alarms cannot erase newer proof', () => {
  const { observer, session, capture } = pilot();
  capture(0);
  observer.capture(packet(0, '00100000', 'AL_LTE'), [{ imei }], session, at(1));
  assert.equal(capture(60).eligible, false); // Confirmation must start after the alarm.
  const latest = capture(120);
  assert.equal(latest.eligible, true);
  for (const alarm of [packet(60, '00100000', 'AL_LTE'), packet(0, '00100000', 'AL_LTE'),
    packet(120, '00100000', 'UD2')]) {
    const events = [{ imei }]; observer.capture(alarm, events, session, at(121));
    assert.equal(events[0].wearEvidence.eligible, true);
    assert.equal(events[0].wearEvidence.continuityId, latest.continuityId);
  }
});

test('same-second removal does not accept an unverified pilot or manufacture removed status', () => {
  const { observer, session, capture } = pilot({ deviceMode: 'unverified' });
  capture(0); capture(60);
  const events = [{ imei }];
  observer.capture(packet(60, '00100000', 'AL_LTE'), events, session, at(61));
  assert.equal(events[0].wearEvidence.state, 'unknown');
  assert.equal(events[0].wearEvidence.eligible, false);
  assert.equal(events[0].wearEvidence.reason, 'device_unverified');
});
