const { sendSms } = require('./notify');
const { sendDownlinkCommand } = require('./downlink');

/**
 * Device command builders for the ReachFar V52 used by Guardian.
 *
 * Guardian supports one production hardware model: V52. Command transport is
 * selected from V52 vendor material and real-device evidence:
 * - SMS provisioning: center number, SOS slots and `ts#` status. Center,
 *   SOS1 and `ts#` have been exercised successfully on Guardian's real V52;
 *   SOS2/SOS3 retain the same documented slot syntax pending acceptance.
 * - TCP data commands: monitor callback, ring/find, fall settings, medication
 *   reminders and upload interval. These are sent as `[SG*protocolId*LEN*...]`
 *   over the watch's active gateway session. They deliberately have no guessed
 *   SMS fallback.
 *
 * A documented command is not automatically an accepted product capability.
 * Each user-visible feature still requires V52 real-device acceptance.
 */
function centerNumberCommand(phone) {
  return `pw,123456,center,${phone}#`;
}

function sosNumberCommand(slot, phone) {
  const n = Number(slot);
  if (![1, 2, 3].includes(n)) {
    throw new Error('SOS slot must be 1, 2, or 3');
  }
  return `sos${n},${phone}#`;
}

function statusCommand() {
  return 'ts#';
}

function voiceMonitorCommand(phone) {
  return `MONITOR,${phone}`;
}

function ringToFindCommand() {
  return 'FIND';
}

function normalizeCallingPhone(phone) {
  const normalized = String(phone || '')
    .trim()
    .replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Calling phone must use E.164 format, for example +23057123456');
  }
  return normalized;
}

/**
 * V52 PHBX contact names are sent as UTF-16BE hexadecimal. This mirrors the
 * vendor example (`0045007a0075006e`) without copying a real person's data.
 */
function phonebookNameHex(name) {
  const normalized = String(name || '').trim();
  const characters = Array.from(normalized);
  if (characters.length === 0 || characters.length > 20) {
    throw new Error('Phonebook name must contain 1-20 characters');
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('Phonebook name contains unsupported control characters');
  }
  return Buffer.from(normalized, 'utf16le').swap16().toString('hex').toUpperCase();
}

/**
 * Add or replace one V52 phonebook entry over the live TCP session.
 *
 * Vendor form:
 *   PHBX,<serial>,<UTF-16BE name hex>,<phone>,<picture bytes>
 *
 * Guardian deliberately leaves the optional picture field empty during the
 * first real-device acceptance. Slots 1-15 are a conservative Guardian
 * guardrail until the exact V52 capacity is confirmed on the target firmware.
 */
function phonebookContactCommand({ slot, name, phone }) {
  const serial = Number(slot);
  if (!Number.isInteger(serial) || serial < 1 || serial > 15) {
    throw new Error('Phonebook slot must be an integer between 1 and 15');
  }
  return `PHBX,${serial},${phonebookNameHex(name)},${normalizeCallingPhone(phone)},`;
}

/** UTF-16BE hex encoding, 4 hex chars per character, no separators -- the
 * format TAKEPILLS reminder text uses. Confirmed against the vendor's own
 * example captures: "00660066"->"ff" is a placeholder-looking test string,
 * but "006400610069006c0079"->"daily" and "007700650065006b006c0079"->
 * "weekly" both decode cleanly, which is what confirms the encoding. */
function textToHexUtf16(text) {
  let hex = '';
  for (const ch of String(text)) {
    hex += ch.codePointAt(0).toString(16).padStart(4, '0');
  }
  return hex;
}

/**
 * Fall detection on/off, with an option to auto-dial the monitor number
 * when a fall is detected. V52 TCP downlink only, confirmed in the vendor
 * example captures as `[3G*IMEI*LEN*FALLDOWN,1,1]`.
 */
function fallDetectionCommand({ enabled, dialMonitorOnFall = false }) {
  return `FALLDOWN,${enabled ? 1 : 0},${dialMonitorOnFall ? 1 : 0}`;
}

/**
 * Fall detection sensitivity, 0-6. Second value is a vendor-fixed constant
 * (always 6) per protocol doc section 25 -- not a real second parameter, so
 * this doesn't expose it. Confirmed in example captures as `LSSET,5+6` and
 * `LSSET,3+6`.
 */
function fallSensitivityCommand(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error('Fall sensitivity level must be an integer 0-6');
  }
  return `LSSET,${n}+6`;
}

/**
 * Medication reminder. V52 TCP downlink only, confirmed against three
 * example captures for once/daily/weekly.
 * - time: 'HH:MM'
 * - frequency: 1 (once) | 2 (daily) | 3 (weekly)
 * - week: 7-digit Sun->Sat on/off mask, required when frequency is 3
 * - text: plain reminder text, auto-encoded to the device's hex-UTF16 format
 * - enabled: on/off bit in the time segment (protocol doc: "1 is on, 0 is
 *   off"). Defaults true; all 3 vendor example captures happen to use 1,
 *   so this is the confirmed value for "on" -- 0 for "off" is documented
 *   in the prose but not demonstrated in a capture.
 *
 * Note: in all 3 vendor example captures, the "remind number" field right
 * after the time segment is always identical to the frequency digit (1, 2,
 * or 3). It's unclear from the doc alone whether that's a coincidence of
 * their test data or a real requirement, so this builder follows the
 * confirmed pattern rather than guessing at an independent value.
 */
function medicationReminderCommand({ time, frequency, week, text, enabled = true }) {
  const freq = Number(frequency);
  if (![1, 2, 3].includes(freq)) {
    throw new Error('Medication reminder frequency must be 1 (once), 2 (daily), or 3 (weekly)');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
    throw new Error('Medication reminder time must be HH:MM (24-hour)');
  }
  let timeSegment = `${time}-${enabled ? 1 : 0}-${freq}`;
  if (freq === 3) {
    if (!/^[01]{7}$/.test(week || '')) {
      throw new Error('Weekly medication reminder requires a 7-digit Sun-Sat week mask, e.g. 0111110');
    }
    timeSegment += `-${week}`;
  }
  if (!text) {
    throw new Error('Medication reminder requires reminder text');
  }
  return `TAKEPILLS,${timeSegment},${freq},${textToHexUtf16(text)}`;
}

/**
 * Standing location-reporting interval. TCP downlink only (protocol doc
 * section II.1: `[CS*IMEI*LEN*UPLOAD,time interval]`, unit seconds). The
 * vendor doc gives no min/max -- the 10s floor and 3600s ceiling here are
 * our own UX guardrail against battery-draining or effectively-disabled
 * settings, not a protocol requirement.
 */
function uploadIntervalCommand(seconds) {
  const n = Number(seconds);
  if (!Number.isInteger(n) || n < 10 || n > 3600) {
    throw new Error('Upload interval must be an integer between 10 and 3600 seconds');
  }
  return `UPLOAD,${n}`;
}

// Types dispatched over the live TCP session (./downlink) instead of SMS.
// No SMS equivalent exists for these in the vendor's SMS command sheet.
const TCP_ONLY_TYPES = new Set([
  'set_phonebook_contact',
  'voice_monitor',
  'ring_to_find',
  'set_fall_detection',
  'set_fall_sensitivity',
  'set_medication_reminder',
  'set_upload_interval',
]);

const BUILDERS = {
  set_center_number: ({ phone }) => centerNumberCommand(phone),
  set_sos_number: ({ slot, phone }) => sosNumberCommand(slot, phone),
  check_status: () => statusCommand(),
  set_phonebook_contact: (params) => phonebookContactCommand(params),
  voice_monitor: ({ phone }) => voiceMonitorCommand(phone),
  ring_to_find: () => ringToFindCommand(),
  set_fall_detection: (params) => fallDetectionCommand(params),
  set_fall_sensitivity: ({ level }) => fallSensitivityCommand(level),
  set_medication_reminder: (params) => medicationReminderCommand(params),
  set_upload_interval: ({ seconds }) => uploadIntervalCommand(seconds),
};

/**
 * Send a V52 command. Provisioning commands use the watch SIM; runtime data
 * commands use the active TCP session. There is no cross-model fallback and
 * no transport substitution: an unavailable V52 session fails clearly.
 */
async function sendDeviceCommand(db, imei, type, params, transports = {}) {
  const tcpSender = transports.sendDownlinkCommand || sendDownlinkCommand;
  const smsSender = transports.sendSms || sendSms;
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(`Unknown device command type: ${type}`);
  }
  const text = builder(params || {});

  if (TCP_ONLY_TYPES.has(type)) {
    const result = tcpSender(imei, text);
    if (!result.ok) {
      throw new Error(
        `Device has no active connection right now — ${type} requires a live session (no SMS fallback exists for this command)`
      );
    }
    return { text, channel: 'tcp', result };
  }

  const deviceSnap = await db.collection('devices').doc(imei).get();
  const simNumber = deviceSnap.data()?.simNumber;
  if (!simNumber) {
    throw new Error('Device has no simNumber on file — set it in device settings first');
  }

  const result = await smsSender(simNumber, text);
  return { text, channel: 'sms', simNumber, result };
}

module.exports = {
  sendDeviceCommand,
  centerNumberCommand,
  sosNumberCommand,
  statusCommand,
  voiceMonitorCommand,
  ringToFindCommand,
  normalizeCallingPhone,
  phonebookNameHex,
  phonebookContactCommand,
  fallDetectionCommand,
  fallSensitivityCommand,
  medicationReminderCommand,
  uploadIntervalCommand,
  textToHexUtf16,
};
