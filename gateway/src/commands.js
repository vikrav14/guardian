const { sendSms } = require('./notify');
const { sendDownlinkCommand } = require('./downlink');

/**
 * Device command builders for the ReachFar GT06 family.
 *
 * Two dispatch paths, per TCP_ONLY_TYPES below:
 * - SMS (V28C): most of these use the exact syntax from
 *   docs/reference/Switch-Server-SMS-Commands.pdf (the vendor doc for that
 *   exact device). `voiceMonitorCommand` is the one exception: it's not in
 *   that PDF, but is documented for the RF-V28 -- the same "V28" family from
 *   the same manufacturer (Shenzhen Reachfar) -- by a third-party/community
 *   source (github.com/matthiasmo/RF-V28), not Reachfar's own V28C manual.
 *   Treat it as higher-confidence-but-unverified.
 * - TCP downlink (V46/V48/V52): fall detection, sensitivity, and medication
 *   reminders come from the vendor's "GPS Tracker Communication Protocol
 *   V46-V48-V52 2021-12-20" doc and its companion example captures. These
 *   are documented as data-channel-only (no SMS equivalent exists in the
 *   vendor's SMS command sheet), so they require the device to have a live
 *   TCP session with the gateway -- there is no SMS fallback to fake one.
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
  return `monitor,${phone}#`;
}

// Same source/confidence caveat as voiceMonitorCommand: documented for the
// RF-V28 by a third party, not the V28C's own manual.
function ringToFindCommand() {
  return 'find#';
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
 * when a fall is detected. TCP downlink only (V46-V48-V52 protocol doc
 * section 24, confirmed in the example captures as
 * `[3G*IMEI*LEN*FALLDOWN,1,1]`).
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
 * Medication reminder. TCP downlink only (protocol doc section 28,
 * confirmed against 3 example captures for once/daily/weekly).
 * - time: 'HH:MM'
 * - frequency: 1 (once) | 2 (daily) | 3 (weekly)
 * - week: 7-digit Sun->Sat on/off mask, required when frequency is 3
 * - text: plain reminder text, auto-encoded to the device's hex-UTF16 format
 *
 * Note: in all 3 vendor example captures, the "remind number" field right
 * after the time segment is always identical to the frequency digit (1, 2,
 * or 3). It's unclear from the doc alone whether that's a coincidence of
 * their test data or a real requirement, so this builder follows the
 * confirmed pattern rather than guessing at an independent value.
 */
function medicationReminderCommand({ time, frequency, week, text }) {
  const freq = Number(frequency);
  if (![1, 2, 3].includes(freq)) {
    throw new Error('Medication reminder frequency must be 1 (once), 2 (daily), or 3 (weekly)');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
    throw new Error('Medication reminder time must be HH:MM (24-hour)');
  }
  let timeSegment = `${time}-1-${freq}`;
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

// Types dispatched over the live TCP session (./downlink) instead of SMS.
// No SMS equivalent exists for these in the vendor's SMS command sheet.
const TCP_ONLY_TYPES = new Set([
  'set_fall_detection',
  'set_fall_sensitivity',
  'set_medication_reminder',
]);

const BUILDERS = {
  set_center_number: ({ phone }) => centerNumberCommand(phone),
  set_sos_number: ({ slot, phone }) => sosNumberCommand(slot, phone),
  check_status: () => statusCommand(),
  voice_monitor: ({ phone }) => voiceMonitorCommand(phone),
  ring_to_find: () => ringToFindCommand(),
  set_fall_detection: (params) => fallDetectionCommand(params),
  set_fall_sensitivity: ({ level }) => fallSensitivityCommand(level),
  set_medication_reminder: (params) => medicationReminderCommand(params),
};

/**
 * Send a device command. SMS for V28C-documented commands (the pendant's
 * own SIM number, exactly as the vendor documents). TCP downlink for
 * V46-V48-V52-only commands that have no SMS equivalent -- these require
 * the device to currently hold a live TCP session with the gateway; there
 * is no SMS fallback to fake one, so this fails clearly instead of
 * pretending to have queued something that can't be delivered.
 */
async function sendDeviceCommand(db, imei, type, params) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(`Unknown device command type: ${type}`);
  }
  const text = builder(params || {});

  if (TCP_ONLY_TYPES.has(type)) {
    const result = sendDownlinkCommand(imei, text);
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

  const result = await sendSms(simNumber, text);
  return { text, channel: 'sms', simNumber, result };
}

module.exports = {
  sendDeviceCommand,
  centerNumberCommand,
  sosNumberCommand,
  statusCommand,
  voiceMonitorCommand,
  ringToFindCommand,
  fallDetectionCommand,
  fallSensitivityCommand,
  medicationReminderCommand,
  textToHexUtf16,
};
