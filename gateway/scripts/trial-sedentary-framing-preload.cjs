'use strict';

// Temporary operator diagnostic: load with node --require from gateway/.
// Never import this from application code. It neither opens a listener nor
// sends a command; the existing authenticated downlink route remains in use.
const path = require('node:path');
const protocolId = process.env.GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID;
if (!/^\d{10}$/.test(protocolId || '')) {
  throw new Error('Set GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID to the exact pilot protocol ID.');
}
const expectedEntry = path.resolve(process.cwd(), 'src/server.js');
if (path.resolve(process.argv[1] || '') !== expectedEntry) {
  throw new Error('Run from gateway/: node --require <this-file> src/server.js');
}
const protocol = require(path.resolve(process.cwd(), 'src/protocol/gt06.js'));
const original = protocol.buildAckFrame;
if (typeof original !== 'function') throw new Error('Gateway frame builder unavailable.');
for (const mode of [0, 1]) {
  const command = `SEDENTARY,${mode},20`;
  const existing = original(protocolId, command);
  if (!Buffer.isBuffer(existing) ||
      existing.toString('ascii') !== `[SG*${protocolId}*000E*${command}]`) {
    throw new Error('Gateway framing changed. Stop and review this diagnostic.');
  }
}

const enableDeadline = Date.now() + 20 * 60 * 1000;
let enableAttempted = false;
protocol.buildAckFrame = function (id, command) {
  if (String(id) !== protocolId || !['SEDENTARY,1,20', 'SEDENTARY,0,20'].includes(command)) {
    return original.apply(this, arguments);
  }
  if (command === 'SEDENTARY,1,20') {
    if (enableAttempted || Date.now() >= enableDeadline) {
      const reason = enableAttempted ? 'enable_already_attempted' : 'enable_window_expired';
      console.log(JSON.stringify({ event: 'sedentary_frame_trial_blocked', reason,
        commandSent: false }));
      throw new Error(`Sedentary frame trial blocked: ${reason}`);
    }
    // Consume before socket handoff: an uncertain write must not be retried.
    enableAttempted = true;
  }
  const frame = Buffer.from(`[3G*${protocolId}*000e*${command}]`, 'ascii');
  console.log(JSON.stringify({ event: 'sedentary_trial_frame_built', protocolId,
    command, frame: frame.toString('ascii'), commandSent: false,
    appliedStateVerified: false }));
  return frame;
};
console.log(JSON.stringify({ event: 'sedentary_frame_trial_ready', protocolId,
  permittedBodies: ['SEDENTARY,1,20', 'SEDENTARY,0,20'], enableAttempts: 1,
  enableWindowMinutes: 20, offAvailableAfterWindow: true,
  automaticCommands: false, otherFramesChanged: false,
  note: 'Check physical menu. Send off for cleanup; restarting normally removes this helper but does not reset watch settings.' }));
