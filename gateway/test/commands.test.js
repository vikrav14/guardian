const test = require('node:test');
const assert = require('node:assert/strict');
const {
  centerNumberCommand,
  sosNumberCommand,
  statusCommand,
  voiceMonitorCommand,
  ringToFindCommand,
  sendDeviceCommand,
  fallDetectionCommand,
  fallSensitivityCommand,
  medicationReminderCommand,
  uploadIntervalCommand,
  textToHexUtf16,
} = require('../src/commands');
const { buildAckFrame } = require('../src/protocol/gt06');

test('centerNumberCommand matches the vendor SMS syntax exactly', () => {
  assert.equal(centerNumberCommand('+23057123456'), 'pw,123456,center,+23057123456#');
});

test('sosNumberCommand builds sos1/sos2/sos3 commands', () => {
  assert.equal(sosNumberCommand(1, '+23057123456'), 'sos1,+23057123456#');
  assert.equal(sosNumberCommand(2, '+23057123456'), 'sos2,+23057123456#');
  assert.equal(sosNumberCommand(3, '+23057123456'), 'sos3,+23057123456#');
});

test('sosNumberCommand rejects an out-of-range slot', () => {
  assert.throws(() => sosNumberCommand(4, '+23057123456'), /slot must be 1, 2, or 3/);
});

test('statusCommand is the documented ts# check', () => {
  assert.equal(statusCommand(), 'ts#');
});

test('voiceMonitorCommand builds the V52 TCP data command', () => {
  assert.equal(voiceMonitorCommand('+23057123456'), 'MONITOR,+23057123456');
});

test('ringToFindCommand builds the V52 TCP data command', () => {
  assert.equal(ringToFindCommand(), 'FIND');
});

test('V52 runtime commands produce exact SG frames without SMS terminators', () => {
  assert.equal(
    buildAckFrame('9705254749', voiceMonitorCommand('+23058590100')).toString('ascii'),
    '[SG*9705254749*0014*MONITOR,+23058590100]'
  );
  assert.equal(
    buildAckFrame('9705254749', ringToFindCommand()).toString('ascii'),
    '[SG*9705254749*0004*FIND]'
  );
});

test('sendDeviceCommand rejects an unknown command type', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }) };
  await assert.rejects(
    () => sendDeviceCommand(db, '861397052547400', 'reboot_now', {}),
    /Unknown device command type/
  );
});

test('sendDeviceCommand rejects a device with no simNumber on file', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }) };
  await assert.rejects(
    () => sendDeviceCommand(db, '861397052547400', 'check_status', {}),
    /no simNumber on file/
  );
});

// --- V52 TCP downlink commands ---
// Expected values below are the vendor's own example captures, not
// hand-derived from the spec prose, so these pin byte-for-byte compatibility.

test('fallDetectionCommand matches the vendor example capture', () => {
  assert.equal(
    fallDetectionCommand({ enabled: true, dialMonitorOnFall: true }),
    'FALLDOWN,1,1'
  );
  assert.equal(
    fallDetectionCommand({ enabled: false, dialMonitorOnFall: false }),
    'FALLDOWN,0,0'
  );
});

test('fallSensitivityCommand matches the vendor example captures', () => {
  assert.equal(fallSensitivityCommand(5), 'LSSET,5+6');
  assert.equal(fallSensitivityCommand(3), 'LSSET,3+6');
});

test('fallSensitivityCommand rejects out-of-range levels', () => {
  assert.throws(() => fallSensitivityCommand(7), /0-6/);
  assert.throws(() => fallSensitivityCommand(-1), /0-6/);
});

test('textToHexUtf16 matches the vendor example captures', () => {
  assert.equal(textToHexUtf16('daily'), '006400610069006c0079');
  assert.equal(textToHexUtf16('weekly'), '007700650065006b006c0079');
});

test('medicationReminderCommand matches all 3 vendor example captures (once/daily/weekly)', () => {
  assert.equal(
    medicationReminderCommand({ time: '06:22', frequency: 1, text: 'ff' }),
    'TAKEPILLS,06:22-1-1,1,00660066'
  );
  assert.equal(
    medicationReminderCommand({ time: '06:37', frequency: 2, text: 'daily' }),
    'TAKEPILLS,06:37-1-2,2,006400610069006c0079'
  );
  assert.equal(
    medicationReminderCommand({ time: '07:00', frequency: 3, week: '1111111', text: 'weekly' }),
    'TAKEPILLS,07:00-1-3-1111111,3,007700650065006b006c0079'
  );
});

test('medicationReminderCommand sets the on/off segment to 0 when disabled', () => {
  assert.equal(
    medicationReminderCommand({ time: '06:22', frequency: 1, text: 'ff', enabled: false }),
    'TAKEPILLS,06:22-0-1,1,00660066'
  );
});

test('medicationReminderCommand rejects a weekly reminder with no week mask', () => {
  assert.throws(
    () => medicationReminderCommand({ time: '07:00', frequency: 3, text: 'weekly' }),
    /7-digit Sun-Sat week mask/
  );
});

test('medicationReminderCommand rejects a malformed time', () => {
  assert.throws(
    () => medicationReminderCommand({ time: '25:99', frequency: 1, text: 'x' }),
    /HH:MM/
  );
});

test('sendDeviceCommand routes TCP-only types over downlink and fails clearly with no live session', async () => {
  const db = {};
  await assert.rejects(
    () => sendDeviceCommand(db, '861397052547400', 'set_fall_detection', { enabled: true }),
    /no active connection right now/
  );
});

test('sendDeviceCommand sends V52 monitor and find commands only over TCP', async () => {
  const calls = [];
  const transports = {
    sendDownlinkCommand: (imei, command) => {
      calls.push({ imei, command });
      return { ok: true, sessions: 1 };
    },
    sendSms: async () => {
      throw new Error('V52 runtime commands must not use SMS');
    },
  };

  const monitor = await sendDeviceCommand(
    {},
    '861397052547492',
    'voice_monitor',
    { phone: '+23058590100' },
    transports
  );
  const find = await sendDeviceCommand(
    {},
    '861397052547492',
    'ring_to_find',
    {},
    transports
  );

  assert.equal(monitor.channel, 'tcp');
  assert.equal(monitor.text, 'MONITOR,+23058590100');
  assert.equal(find.channel, 'tcp');
  assert.equal(find.text, 'FIND');
  assert.deepEqual(calls, [
    { imei: '861397052547492', command: 'MONITOR,+23058590100' },
    { imei: '861397052547492', command: 'FIND' },
  ]);
});

test('sendDeviceCommand keeps live-proven V52 provisioning commands on SMS', async () => {
  const calls = [];
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ data: () => ({ simNumber: '+23073332567' }) }),
      }),
    }),
  };
  const transports = {
    sendDownlinkCommand: () => {
      throw new Error('V52 provisioning commands must not use TCP');
    },
    sendSms: async (to, command) => {
      calls.push({ to, command });
      return { ok: true };
    },
  };

  await sendDeviceCommand(
    db,
    '861397052547492',
    'set_center_number',
    { phone: '+23058590100' },
    transports
  );
  await sendDeviceCommand(
    db,
    '861397052547492',
    'set_sos_number',
    { slot: 1, phone: '58590100' },
    transports
  );
  await sendDeviceCommand(
    db,
    '861397052547492',
    'check_status',
    {},
    transports
  );

  assert.deepEqual(calls, [
    { to: '+23073332567', command: 'pw,123456,center,+23058590100#' },
    { to: '+23073332567', command: 'sos1,58590100#' },
    { to: '+23073332567', command: 'ts#' },
  ]);
});

test('uploadIntervalCommand matches the vendor doc syntax', () => {
  assert.equal(uploadIntervalCommand(10), 'UPLOAD,10');
  assert.equal(uploadIntervalCommand(60), 'UPLOAD,60');
  assert.equal(uploadIntervalCommand(3600), 'UPLOAD,3600');
});

test('uploadIntervalCommand rejects out-of-range or non-integer intervals', () => {
  assert.throws(() => uploadIntervalCommand(5), /10 and 3600/);
  assert.throws(() => uploadIntervalCommand(3601), /10 and 3600/);
  assert.throws(() => uploadIntervalCommand(30.5), /10 and 3600/);
});

test('sendDeviceCommand routes set_upload_interval over downlink and fails clearly with no live session', async () => {
  const db = {};
  await assert.rejects(
    () => sendDeviceCommand(db, '861397052547400', 'set_upload_interval', { seconds: 60 }),
    /no active connection right now/
  );
});
