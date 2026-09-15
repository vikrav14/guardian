'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { createHardwareEvidence } = require('../src/wellness-hardware-evidence');
const { inspectRoutine, parseArguments } = require('../scripts/inspect-wellness-routine');
const AT = new Date('2026-10-01T10:00:00Z');
const VERSION = 'V52_TEST_V1.0_2026.01.01_12.00.00';
const PILOT_VERSIONS = [
  'C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29',
  'C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29',
];

function packet(payload) {
  return decodeFrame(Buffer.from(`[3G*9700000000*${payload.length.toString(16).padStart(4, '0')}*${payload}]`));
}

test('documented removal and temperature replies do not loop ACKs or confirm wearing or a schedule', () => {
  const evidence = createHardwareEvidence(), session = {};
  for (const command of ['REMOVE', 'REMOVESMS', 'bodytemp2', 'bodytemp', 'BTTIMESET']) {
    const decoded = packet(command);
    const handled = handlePacket(decoded, session);
    assert.equal(handled.acks.length, 0, command);
    assert.equal(handled.events[0].type, 'command_echo');
    evidence.observe(decoded, session, AT);
    evidence.observe(packet(`${command},private-value`), session, new Date(+AT + 1000));
  }
  const current = evidence.current(session, AT);
  assert.equal(current.commandReplyEvidence.replies.length, 5);
  assert.equal(current.commandReplyEvidence.replies[0].count, 2);
  assert.equal(current.commandReplyEvidence.replies[0].bareReply, false);
  assert.equal(current.commandReplyEvidence.settingsConfirmed, false);
  assert.equal(current.commandReplyEvidence.wearingConfirmed, false);
  assert.equal(current.commandReplyEvidence.scheduleVerified, false);
  assert.equal(current.configurationEvidence.state, 'no_config_received');
  assert.deepEqual(current.firmwareEvidence.versionLabels, []);
  assert.equal(JSON.stringify(current).includes('private-value'), false);
  current.commandReplyEvidence.replies[0].count = 999;
  assert.equal(evidence.current(session).commandReplyEvidence.replies[0].count, 2);
  assert.deepEqual(evidence.current({}).commandReplyEvidence.replies, []);
  assert.deepEqual(createHardwareEvidence().current(session).commandReplyEvidence.replies, []);
  const before = evidence.current(session);
  evidence.observe({ ...packet('REMOVE'), error: 'length_mismatch' }, session, AT);
  evidence.observe(packet('UNKNOWN,private-value'), session, AT);
  assert.deepEqual(evidence.current(session), before);
});

test('wire CONFIG distinguishes no packet, absent fields, invalid/duplicate fields and reported modes', () => {
  const evidence = createHardwareEvidence(), session = {};
  assert.equal(evidence.current(session).configurationEvidence.state, 'no_config_received');
  for (const [payload, expected] of [
    ['CONFIG,TY:test', 'bt_field_missing'], ['CONFIG,BT:invalid', 'bt_field_invalid'],
    ['CONFIG,BT:2,BT:2', 'bt_field_duplicate'], ['CONFIG,BT:0,TM:1', 'other_bt_reported'],
    ['CONFIG,BT:2,TM:1', 'bt2_reported'],
  ]) {
    const decoded = packet(payload), original = JSON.stringify(decoded);
    handlePacket(decoded, session); evidence.observe(decoded, session, AT);
    assert.equal(evidence.current(session).configurationEvidence.state, expected);
    assert.equal(JSON.stringify(decoded), original);
  }
  assert.equal(evidence.current(session).configurationEvidence.packets, 5);
  assert.equal(evidence.current(session).configurationEvidence.lastReceivedAt, AT.toISOString());
  assert.equal(evidence.current({}).configurationEvidence.state, 'no_config_received');
  assert.equal(createHardwareEvidence().current(session).configurationEvidence.state, 'no_config_received');
});

test('only bounded firmware labels and field status are retained; sensor uploads do not establish mode', () => {
  const evidence = createHardwareEvidence(), session = {};
  evidence.observe(packet(`CONFIG,BT:2,TM:1,VR:${VERSION},IMEI:123456789012345,PW:private-secret`), session, AT);
  assert.equal(evidence.current(session).firmwareEvidence.version, VERSION);
  const before = evidence.current(session);
  for (const decoded of [packet('btemp2,1,34.56'), packet('oxygen,0,97'),
    { error: 'length_mismatch', command: 'CONFIG', args: ['BT:0'] }]) evidence.observe(decoded, session, AT);
  assert.deepEqual(evidence.current(session), before);
  const output = JSON.stringify(before);
  for (const secret of ['123456789012345', 'private-secret', '34.56', 'IMEI', 'PW']) assert.equal(output.includes(secret), false);
  before.configurationEvidence.state = 'fake';
  assert.equal(evidence.current(session).configurationEvidence.state, 'bt2_reported');
});

test('VERNO replies are distinct from command handoff, missing version and invalid payloads', () => {
  const evidence = createHardwareEvidence(), session = {};
  evidence.requestVersion(session, AT);
  assert.equal(evidence.current(session).firmwareEvidence.replyState, 'awaiting_reply');
  for (const [payload, state] of [['VERNO', 'empty_reply'], ['VERNO,https://private.invalid', 'unsupported_reply'],
    ['VERNO,V52_123456789012345', 'unsupported_reply'], ['VERNO,A,B', 'unsupported_reply'],
    [`VERNO,${VERSION}`, 'version_received']]) {
    const decoded = packet(payload);
    assert.equal(handlePacket(decoded, session).acks.length, 0);
    evidence.observe(decoded, session, new Date(+AT + 1000));
    assert.equal(evidence.current(session).firmwareEvidence.replyState, state);
  }
  assert.equal(evidence.current(session).firmwareEvidence.version, VERSION);
  assert.deepEqual(evidence.current(session).firmwareEvidence.versionLabels, [VERSION]);
  assert.equal(evidence.current(session).configurationEvidence.state, 'no_config_received');
});

test('observed two-label V52 reply is preserved in wire order without choosing a primary or accepting mode', () => {
  const evidence = createHardwareEvidence(), session = {};
  evidence.observe(packet(`CONFIG,VR:${VERSION}`), session, AT);
  evidence.requestVersion(session, AT, { includeReply: true });
  const decoded = packet(`VERNO,${PILOT_VERSIONS.join(',')}`);
  assert.equal(handlePacket(decoded, session).acks.length, 0);
  evidence.observe(decoded, session, new Date(+AT + 373));
  const current = evidence.current(session, AT);
  assert.equal(current.firmwareEvidence.replyState, 'version_received');
  assert.equal(current.firmwareEvidence.version, null);
  assert.deepEqual(current.firmwareEvidence.versionLabels, PILOT_VERSIONS);
  assert.equal(current.firmwareEvidence.source, 'VERNO');
  assert.equal(current.firmwareEvidence.receivedAt, new Date(+AT + 373).toISOString());
  assert.equal(current.firmwareEvidence.replyDetails.parserReason, 'accepted_version_labels');
  assert.equal(current.configurationEvidence.btField, 'missing');
  current.firmwareEvidence.versionLabels[0] = 'changed';
  assert.deepEqual(evidence.current(session, AT).firmwareEvidence.versionLabels, PILOT_VERSIONS);
  for (const args of [[PILOT_VERSIONS[0], ''], [PILOT_VERSIONS[0], 'PW:secret'],
    [PILOT_VERSIONS[0], '123456789012345'], [...PILOT_VERSIONS, VERSION]]) {
    const fresh = {};
    evidence.observe(packet(`VERNO,${args.join(',')}`), fresh, AT);
    assert.equal(evidence.current(fresh, AT).firmwareEvidence.replyState, 'unsupported_reply');
    assert.deepEqual(evidence.current(fresh, AT).firmwareEvidence.versionLabels, []);
  }
  assert.deepEqual(evidence.current({}, AT).firmwareEvidence.versionLabels, []);
});

test('requested reply details expose rejected format without accepting firmware or retaining other packets', () => {
  const evidence = createHardwareEvidence(), session = {};
  evidence.requestVersion(session, AT);
  evidence.observe(packet('VERNO,Version: V52 example,extra'), session, new Date(+AT + 100));
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails, undefined);
  evidence.requestVersion(session, AT, { includeReply: true });
  evidence.observe(packet('CONFIG,VR:example,BT:invalid'), session, AT);
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails, null);
  evidence.observe(packet('VERNO,Version: V52 example,extra'), session, new Date(+AT + 392));
  const firmware = evidence.current(session, new Date(+AT + 1000)).firmwareEvidence;
  assert.equal(firmware.replyState, 'unsupported_reply');
  assert.equal(firmware.version, 'example'); // Earlier CONFIG remains independently attributed.
  assert.equal(firmware.source, 'CONFIG');
  assert.deepEqual(firmware.replyDetails.arguments, ['Version: V52 example', 'extra']);
  assert.equal(firmware.replyDetails.parserReason, 'version_label_format_rejected');
  firmware.replyDetails.arguments[0] = 'changed';
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails.arguments[0], 'Version: V52 example');
  evidence.observe(packet('VERNO,second'), session, new Date(+AT + 500));
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails.arguments[0], 'Version: V52 example');
  assert.equal(evidence.current({}, AT).firmwareEvidence.replyDetails, undefined);
  assert.equal(evidence.current(session, new Date(+AT + 120_000)).firmwareEvidence.replyDetails, undefined);
  evidence.observe(packet('VERNO,late reply'), session, new Date(+AT + 120_001));
  assert.equal(evidence.current(session, new Date(+AT + 120_002)).firmwareEvidence.replyDetails, undefined);
});

test('opt-in VERNO detail capture bounds and redacts values and resets on every request', () => {
  const evidence = createHardwareEvidence(), session = {};
  evidence.requestVersion(session, AT, { includeReply: true });
  evidence.observe(packet('VERNO,early reply'), session, new Date(+AT - 1));
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails, null);
  const args = ['PW:private-secret', '123456789012345', 'https://private.invalid',
    '192.168.1.1:9000', 'person@example.invalid', 'Version: with spaces\t', 'X'.repeat(300), 'last', 'excluded'];
  evidence.observe(packet(`VERNO,${args.join(',')}`), session, new Date(+AT + 10));
  const details = evidence.current(session, AT).firmwareEvidence.replyDetails;
  assert.equal(details.argumentCount, 9);
  assert.equal(details.arguments.length, 8);
  assert.equal(details.truncated, true);
  assert.ok(details.arguments.every(value => value.length <= 256));
  for (const secret of ['private-secret', '123456789012345', 'private.invalid', '192.168.1.1', 'person@example', '\t', 'excluded']) {
    assert.equal(details.arguments.join(',').includes(secret), false);
  }
  evidence.requestVersion(session, new Date(+AT + 20));
  assert.equal(evidence.current(session, AT).firmwareEvidence.replyDetails, undefined);
});

test('running pilot confines hardware operations to one session; firmware and removal replies cannot unlock temperature', async () => {
  const sent = [], pilot = { imei: '861000000000001' };
  let matches = [{ socket: { destroyed: false }, session: pilot }];
  const module = { exports: {} };
  const ref = { collection: () => ref, doc: () => ref,
    get: async () => ({ data: () => ({ updatedAt: { toDate: () => AT } }) }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/wellness-routine-runtime'), 'utf8'), {
    module, console, Date, setInterval: () => ({ unref() {} }), clearInterval() {},
    require: name => {
      if (name === './sessions') return { findSocketsForDevice: imei => { assert.equal(imei, pilot.imei); return matches; } };
      if (name === './downlink') return { sendDownlinkCommand: (imei, command) => { sent.push([imei, command]); return { ok: true }; } };
      if (name === './care-wellbeing') return { validConsent: () => true };
      if (name === './entitlements') return {};
      if (name === './wellness-routine') return { ...require('../src/wellness-routine'),
        createRoutineController: () => ({ tick: async () => {} }) };
      if (name === './wellness-hardware-evidence') return { createHardwareEvidence };
      if (name === './supervised-temperature-trial') return require('../src/supervised-temperature-trial');
      return require(name);
    },
  });
  const { parseRoutineOperation } = module.exports;
  for (const payload of [null, [], { action: 'CONFIG' }, { action: 'firmware_version', command: 'CONFIG' },
    { action: 'firmware_version', includeReply: 'true' }, { action: 'temperature_once', includeReply: true },
    { action: 'removal_test_enable', includeReply: true }, { action: 'removal_test_enable', imei: 'other' }]) {
    assert.throws(() => parseRoutineOperation(payload));
  }
  assert.equal(parseRoutineOperation({ action: 'firmware_version', includeReply: true }).includeReply, true);
  assert.equal(parseRoutineOperation({ action: 'temperature_once' }).includeReply, false);
  const runtime = module.exports.startWellnessRoutineRuntime({ db: ref,
    config: { wifiHomePilotImei: pilot.imei, wellnessRoutinePilotEnabled: true, careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true },
    wearEvidence: { current: () => null } });
  runtime.observe(packet('CONFIG,BT:2,TM:1'), { imei: '861000000000002' });
  assert.equal((await runtime.status()).configurationEvidence.state, 'no_config_received');
  assert.equal((await runtime.status()).updatedAt, AT.toISOString());
  matches = []; assert.throws(() => runtime.requestVersion(), /connected/);
  matches = [{ socket: {}, session: pilot }, { socket: {}, session: {} }];
  assert.throws(() => runtime.requestVersion(), /connected/); assert.equal(sent.length, 0);
  matches = [{ socket: {}, session: pilot }];
  assert.equal(runtime.requestVersion({ includeReply: true }).outcome, 'version_request_handed_off');
  assert.deepEqual(sent, [[pilot.imei, 'VERNO']]);
  assert.throws(() => runtime.requestVersion(), /two minutes/);
  runtime.observe(packet(`VERNO,${PILOT_VERSIONS.join(',')}`), pilot);
  assert.equal((await runtime.status()).firmwareEvidence.version, null);
  assert.deepEqual((await runtime.status()).firmwareEvidence.versionLabels, PILOT_VERSIONS);
  assert.deepEqual((await runtime.status()).firmwareEvidence.replyDetails.arguments, PILOT_VERSIONS);
  assert.equal((await runtime.status()).temperatureBt, null);
  await assert.rejects(runtime.requestTemperature(), /CONFIG BT:2/);
  assert.equal(sent.length, 1);
  assert.throws(() => runtime.requestRemovalTest(1), /boolean/);
  assert.equal(parseRoutineOperation({ action: 'removal_test_enable' }).action, 'removal_test_enable');
  assert.equal(parseRoutineOperation({ action: 'removal_test_disable' }).action, 'removal_test_disable');
  const enabled = runtime.requestRemovalTest(true);
  assert.equal(enabled.outcome, 'command_handed_off');
  assert.equal(enabled.settingsConfirmed, false);
  assert.throws(() => runtime.requestRemovalTest(true), /two minutes/);
  runtime.observe(packet('REMOVE'), pilot);
  assert.equal((await runtime.status()).commandReplyEvidence.wearingConfirmed, false);
  assert.equal((await runtime.status()).temperatureBt, null);
  assert.equal(runtime.requestRemovalTest(false).command, 'REMOVE,0');
  assert.deepEqual(sent.slice(1), [[pilot.imei, 'REMOVE,1'], [pilot.imei, 'REMOVE,0']]);
  for (const candidates of [[], [{ socket: {}, session: pilot }, { socket: {}, session: {} }]]) {
    matches = candidates;
    assert.throws(() => runtime.requestRemovalTest(false), /connected/);
  }
  assert.equal(sent.length, 3);
  matches = [{ socket: {}, session: pilot }];
  pilot.lastPacketAt = Date.now();
  runtime.observe(packet('CONFIG,BT:1'), pilot);
  runtime.observe(packet('CONFIG,TY:partial'), pilot);
  assert.equal(pilot.wellnessLastReportedTemperatureBt, 1);
  assert.equal((await runtime.status()).temperatureBt, null);
  await assert.rejects(runtime.requestTemperatureTrial({ action: 'single', operatorPosition: 'worn' }), /reported BT mode/);
  assert.equal(sent.length, 3);
  matches = [{ socket: {}, session: { imei: pilot.imei } }];
  assert.equal((await runtime.status()).firmwareEvidence.version, null);
  runtime.close();
});

test('CLI version check confirms a two-label reply with exactly one query', async () => {
  let now = +AT;
  const methods = [], printed = [];
  const code = await inspectRoutine({ args: ['--request-version'], config: { adminApiKey: 'test', httpPort: 9001 },
    now: () => now, sleep: async ms => { now += ms; }, print: value => printed.push(value),
    fetchImpl: async (_, options) => {
      methods.push(options.method);
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), { action: 'firmware_version' });
        return { ok: true, json: async () => ({ outcome: 'version_request_handed_off', requestedAt: AT.toISOString() }) };
      }
      return { ok: true, json: async () => ({ firmwareEvidence: {
        requestedAt: AT.toISOString(), replyAt: new Date(now).toISOString(), replyState: 'version_received',
        version: null, versionLabels: PILOT_VERSIONS,
      } }) };
    },
  });
  assert.equal(code, 0); assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(JSON.parse(printed.at(-1)).versionConfirmed, true);
  assert.deepEqual(JSON.parse(printed.at(-1)).firmwareEvidence.versionLabels, PILOT_VERSIONS);
});

test('CLI opt-in captures a rejected reply with one version query and never promotes it', async () => {
  let now = +AT;
  const methods = [], printed = [];
  const code = await inspectRoutine({ args: ['--request-version', '--include-version-reply'],
    config: { adminApiKey: 'test', httpPort: 9001 }, now: () => now,
    sleep: async ms => { now += ms; }, print: value => printed.push(value),
    fetchImpl: async (_, options) => {
      methods.push(options.method);
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), { action: 'firmware_version', includeReply: true });
        return { ok: true, json: async () => ({ outcome: 'version_request_handed_off', requestedAt: AT.toISOString() }) };
      }
      return { ok: true, json: async () => ({ firmwareEvidence: {
        requestedAt: AT.toISOString(), replyAt: new Date(now).toISOString(), replyState: 'unsupported_reply',
        version: null, replyDetails: { argumentCount: 1, arguments: ['Version: example'],
          parserReason: 'version_label_format_rejected', truncated: false },
      } }) };
    } });
  assert.equal(code, 0);
  assert.deepEqual(methods, ['POST', 'GET']);
  const result = JSON.parse(printed.at(-1));
  assert.equal(result.versionConfirmed, false);
  assert.equal(result.outcome, 'version_reply_received');
  assert.equal(result.firmwareEvidence.replyDetails.arguments[0], 'Version: example');
});

test('CLI times out without retries, does not reuse an older reply, and rejects arbitrary actions', async () => {
  let now = +AT, posts = 0;
  const printed = [];
  const code = await inspectRoutine({ args: ['--request-version'], config: { adminApiKey: 'test', httpPort: 9001 },
    now: () => now, sleep: async ms => { now += ms; }, print: value => printed.push(value),
    fetchImpl: async (_, options) => {
      if (options.method === 'POST') { posts++;
        return { ok: true, json: async () => ({ outcome: 'version_request_handed_off', requestedAt: AT.toISOString() }) }; }
      return { ok: true, json: async () => ({ firmwareEvidence: { requestedAt: AT.toISOString(),
        replyAt: new Date(+AT - 1000).toISOString(), replyState: 'version_received' } }) };
    },
  });
  assert.equal(code, 1); assert.equal(posts, 1); assert.equal(now - +AT, 20_000);
  assert.equal(JSON.parse(printed.at(-1)).outcome, 'version_reply_not_observed');
  for (const args of [['--request-version', '--request-temperature'], ['--command=CONFIG'], ['--enable'],
    ['--include-version-reply'], ['--request-temperature', '--include-version-reply'],
    ['--request-version', '--include-version-reply', '--include-version-reply']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments([]), null);
  assert.equal(parseArguments(['--request-temperature']), 'temperature_once');
});
