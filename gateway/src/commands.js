const { sendSms } = require('./notify');

/**
 * SMS command builders for the V28C/GT06 family, using the exact syntax from
 * docs/reference/Switch-Server-SMS-Commands.pdf. Only commands documented
 * there are implemented — features the datasheet lists (voice monitoring,
 * remote photo, reboot, etc.) don't have a documented SMS/GPRS command string
 * in the vendor docs available here, so they are intentionally not built as
 * commands yet rather than guessed.
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

const BUILDERS = {
  set_center_number: ({ phone }) => centerNumberCommand(phone),
  set_sos_number: ({ slot, phone }) => sosNumberCommand(slot, phone),
  check_status: () => statusCommand(),
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
};
