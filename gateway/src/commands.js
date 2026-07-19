const { sendSms } = require('./notify');

/**
 * SMS command builders for the V28C/GT06 family. Most of these use the exact
 * syntax from docs/reference/Switch-Server-SMS-Commands.pdf (the vendor doc
 * for this exact device). `voiceMonitorCommand` is the one exception: it's
 * not in that PDF, but is documented for the RF-V28 -- the same "V28" family
 * from the same manufacturer (Shenzhen Reachfar) -- by a third-party/community
 * source (github.com/matthiasmo/RF-V28), not Reachfar's own V28C manual.
 * Treat it as higher-confidence-but-unverified: test it on a real device
 * before relying on it. Remote photo capture is still undocumented anywhere
 * we could find, so it remains unbuilt rather than guessed.
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

const BUILDERS = {
  set_center_number: ({ phone }) => centerNumberCommand(phone),
  set_sos_number: ({ slot, phone }) => sosNumberCommand(slot, phone),
  check_status: () => statusCommand(),
  voice_monitor: ({ phone }) => voiceMonitorCommand(phone),
  ring_to_find: () => ringToFindCommand(),
};

/**
 * Send a device command by SMS to the pendant's own SIM number (the V28C has
 * no GPRS command channel decoded in ./protocol/gt06.js, so SMS — exactly as
 * documented by the vendor — is the only verified downlink path today).
 */
async function sendDeviceCommand(db, imei, type, params) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error(`Unknown device command type: ${type}`);
  }
  const text = builder(params || {});

  const deviceSnap = await db.collection('devices').doc(imei).get();
  const simNumber = deviceSnap.data()?.simNumber;
  if (!simNumber) {
    throw new Error('Device has no simNumber on file — set it in device settings first');
  }

  const result = await sendSms(simNumber, text);
  return { text, simNumber, result };
}

module.exports = {
  sendDeviceCommand,
  centerNumberCommand,
  sosNumberCommand,
  statusCommand,
  voiceMonitorCommand,
  ringToFindCommand,
};
