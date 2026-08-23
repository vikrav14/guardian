'use strict';

const { pedometerCommand, walkTimeCommand } = require('./commands');
const { sendDownlinkCommand } = require('./downlink');

const FULL_DAY_WINDOWS = Object.freeze([
  '00:00-23:59',
  '00:00-00:00',
  '00:00-00:00',
]);

function normalizeDeviceIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!/^\d{10}(?:\d{5})?$/.test(identifier)) {
    throw new Error('Device identifier must be a 10-digit protocol ID or 15-digit hardware IMEI');
  }
  return identifier;
}

/**
 * Explicit technician-only V52 pedometer provisioning.
 *
 * Enabling applies the manufacturer example's full-day counting sheet before
 * PEDO,1. Disabling sends PEDO,0 only and preserves the stored time sheet.
 * Successful writes prove socket handoff, not firmware acknowledgement or
 * physical counting, so every newly provisioned watch still needs inspection.
 */
function provisionActivitySteps(
  payload,
  { sendDownlinkCommandImpl = sendDownlinkCommand } = {}
) {
  const imei = normalizeDeviceIdentifier(payload?.imei);
  if (typeof payload?.enabled !== 'boolean') {
    throw new Error('enabled must be true or false');
  }

  const enabled = payload.enabled;
  const commands = enabled
    ? [walkTimeCommand(FULL_DAY_WINDOWS), pedometerCommand(true)]
    : [pedometerCommand(false)];
  const handoffs = [];

  for (const command of commands) {
    const result = sendDownlinkCommandImpl(imei, command);
    if (!result?.ok) {
      return {
        ok: false,
        error: result?.error || 'activity_steps_provisioning_failed',
        enabled,
        windowMode: enabled ? 'full_day' : 'unchanged',
        commandsRequired: commands.length,
        commandsHandedOff: handoffs.length,
        sessions: Number(result?.sessions || 0),
        evidence: handoffs.length > 0 ? 'partial_socket_handoff' : 'not_sent',
        partialConfigurationPossible: handoffs.length > 0,
        physicalVerificationRequired: true,
      };
    }
    handoffs.push(result);
  }

  const lastHandoff = handoffs.at(-1);
  return {
    ok: true,
    protocolId: lastHandoff.protocolId,
    enabled,
    windowMode: enabled ? 'full_day' : 'unchanged',
    commandsRequired: commands.length,
    commandsHandedOff: handoffs.length,
    sessions: Number(lastHandoff.sessions || 0),
    evidence: 'socket_handoff_only',
    partialConfigurationPossible: false,
    physicalVerificationRequired: true,
  };
}

module.exports = {
  FULL_DAY_WINDOWS,
  normalizeDeviceIdentifier,
  provisionActivitySteps,
};
