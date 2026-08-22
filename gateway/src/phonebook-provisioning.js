'use strict';

const { phonebookContactCommand } = require('./commands');
const { sendDownlinkCommand } = require('./downlink');

function normalizeDeviceIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!/^\d{10}(?:\d{5})?$/.test(identifier)) {
    throw new Error('Device identifier must be a 10-digit protocol ID or 15-digit hardware IMEI');
  }
  return identifier;
}

/**
 * Provision one incoming-call allowlist entry over a live V52 session.
 *
 * This deliberately bypasses the generic Firestore device-command channel.
 * Until Guardian has an authenticated contact-management service, only the
 * strict administrator HTTP route and local technician script may call it.
 */
function provisionPhonebookContact(
  payload,
  { sendDownlinkCommandImpl = sendDownlinkCommand } = {}
) {
  const imei = normalizeDeviceIdentifier(payload?.imei);
  const slot = Number(payload?.slot);
  const command = phonebookContactCommand({
    slot,
    name: payload?.name,
    phone: payload?.phone,
  });
  const result = sendDownlinkCommandImpl(imei, command);

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || 'phonebook_provisioning_failed',
      slot,
      sessions: Number(result?.sessions || 0),
      evidence: 'not_sent',
      physicalVerificationRequired: true,
    };
  }

  return {
    ok: true,
    protocolId: result.protocolId,
    slot,
    sessions: Number(result.sessions || 0),
    evidence: 'socket_handoff_only',
    physicalVerificationRequired: true,
  };
}

module.exports = {
  normalizeDeviceIdentifier,
  provisionPhonebookContact,
};
