'use strict';

// Operator-only reference capture. Not imported by the gateway; no commands generated.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { BACKENDS, parseArguments: parseRelayArguments, restorationPlan, createLog,
  frameSummary, startRelay } = require('./capture-movement-session');
const MAX_PRIVATE_FRAMES = 64;
const MAX_PRIVATE_BYTES = 2 * 1024 * 1024;
// The alert scene is needed to compare pill-tone/vibration behavior. Keep its
// exact device-addressed bytes private alongside the reminder, not in metadata.
const PRIVATE_COMMANDS = ['TAKEPILLS', 'TK', 'PROFILE'];

function parseArguments(args) {
  const relayArgs = [], extras = {};
  for (let i = 0; i < args.length; i++) {
    if (['--private-output', '--stop-file'].includes(args[i])) {
      const key = args[i], value = args[++i];
      if (extras[key] || !value || !path.isAbsolute(value)) throw Error('Absolute unique capture paths required');
      extras[key] = value;
    } else relayArgs.push(args[i]);
  }
  const options = parseRelayArguments(relayArgs);
  if (!extras['--private-output']) throw Error('Private output is required');
  const paths = [options.output, extras['--private-output'], extras['--stop-file']].filter(Boolean).map(p => path.resolve(p).toLowerCase());
  if (new Set(paths).size !== paths.length) throw Error('Capture paths must differ');
  return { ...options, privateOutput: extras['--private-output'], stopFile: extras['--stop-file'] };
}

function createPrivateCapture(output, protocolId, { write = fs.writeSync, now = () => new Date() } = {}) {
  if (!path.isAbsolute(output) || !/^\d{10}$/.test(protocolId)) throw Error('Invalid private capture target');
  const writer = createLog(output, { write });
  let frames = 0, rawBytes = 0, limited = false, closed = false;
  const status = () => ({ frames, rawBytes, limited, failed: writer.failed, closed });
  const close = () => { if (!closed) { closed = true; writer.close(); } return status(); };
  const record = (frame, direction) => {
    if (!Buffer.isBuffer(frame) || frame.length > 65556 || !['watch_to_server', 'server_to_watch'].includes(direction)) return null;
    const summary = frameSummary(frame, protocolId, direction);
    if (!summary?.lengthMatches || !PRIVATE_COMMANDS.includes(summary.command.toUpperCase())) return null;
    if (closed || writer.failed || limited) return { saved: false, ...status() };
    if (frames >= MAX_PRIVATE_FRAMES || rawBytes + frame.length > MAX_PRIVATE_BYTES) {
      limited = true; close(); return { saved: false, ...status() };
    }
    const captureRef = frames + 1;
    const sha256 = createHash('sha256').update(frame).digest('hex');
    const saved = writer.write({ event: 'private_medication_frame', at: now().toISOString(),
      captureRef, direction, command: summary.command, frameBytes: frame.length,
      sha256, frameBase64: frame.toString('base64') });
    if (saved) { frames++; rawBytes += frame.length; }
    else close();
    return { saved, captureRef: saved ? captureRef : null, ...status() };
  };
  return { record, status, close };
}

async function startMedicationCapture(options, dependencies = {}) {
  if (options.stopFile && fs.existsSync(options.stopFile)) throw Error('Stop file already exists');
  const privateCapture = createPrivateCapture(options.privateOutput, options.protocolId, dependencies.privateOptions);
  const emit = dependencies.emit || (row => console.log(JSON.stringify(row)));
  let poll;
  try {
    const relay = await startRelay(options, {
      ...dependencies,
      summarize(frame, protocolId, direction) {
        const summary = frameSummary(frame, protocolId, direction);
        if (!summary) return null;
        // Strip even the base recorder's small safe-frame allowlist from this metadata file.
        const { frame: _frame, frameHex: _hex, ...metadata } = summary;
        const privateRecord = privateCapture.record(frame, direction);
        return { ...metadata, argumentsRedacted: true, ...(privateRecord ? { privateRecord } : {}) };
      },
      emit(row) {
        if (row.event === 'relay_stopped') {
          clearInterval(poll);
          const result = privateCapture.close();
          emit({ ...row, privateCapture: result,
            captureComplete: row.captureComplete && !result.failed && !result.limited });
        } else emit(row);
      },
    });
    if (options.stopFile) poll = setInterval(() => {
      if (fs.existsSync(options.stopFile)) void relay.stop('stop_file');
    }, 500);
    emit({ event: 'medication_capture_ready', privateCommands: PRIVATE_COMMANDS,
      maxPrivateFrames: MAX_PRIVATE_FRAMES, maxPrivateBytes: MAX_PRIVATE_BYTES,
      commandsGenerated: false, routingRestored: false });
    return { ...relay, privateCapture };
  } catch (error) { clearInterval(poll); privateCapture.close(); throw error; }
}

async function main(args) {
  const options = parseArguments(args);
  if (!options.run) {
    console.log(JSON.stringify({ outcome: 'preview', backend: options.backend,
      upstream: BACKENDS[options.backend], minutes: options.minutes,
      ...restorationPlan(options), privateCommands: PRIVATE_COMMANDS,
      networkOpened: false, fileCreated: false, commandsGenerated: false }));
    return;
  }
  const capture = await startMedicationCapture(options);
  process.once('SIGINT', () => { void capture.stop(); });
  process.once('SIGTERM', () => { void capture.stop(); });
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Medication capture failed. Check new output paths and listener. Restore the verified Guardian route if routing was changed.');
  process.exitCode = 1;
});
module.exports = { parseArguments, createPrivateCapture: createPrivateCapture, startMedicationCapture,
  MAX_PRIVATE_FRAMES, MAX_PRIVATE_BYTES, main };
