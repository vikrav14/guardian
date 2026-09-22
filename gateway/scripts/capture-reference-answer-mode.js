'use strict';

// Standalone operator diagnostic. Never import this into server.js.
// The relay does not create commands or ACKs. Only the reference server and
// watch generate traffic. No Firebase, application config or credentials load.
const net = require('node:net');
const { Transform } = require('node:stream');

const REFERENCE_HOST = 'a.igps123.com';
const REFERENCE_PORT = 7720;
const MAX_FRAME = 65556;
const MAX_ROWS = 2000;
const USAGE = 'Use --protocol-id <10 digits> [--listen-port 9002] [--minutes 15] [--guardian-return-host <host> --guardian-return-port <port>] [--run].';

function restorationPlan(options) {
  const target = options.guardianReturn;
  if (target) {
    const host = target.host;
    const validHost = typeof host === 'string' && host.length <= 253 && host.includes('.') &&
      host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
      !host.toLowerCase().endsWith('.localhost') && !/^127\./.test(host) && host !== '0.0.0.0' &&
      (!/^[\d.]+$/.test(host) || net.isIP(host) === 4);
    if (!validHost || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new Error('Provide the verified public Guardian return hostname and TCP port.');
    }
  }
  const returnHost = target ? target.host : REFERENCE_HOST;
  const returnPort = target ? target.port : REFERENCE_PORT;
  return {
    captureMode: target ? 'same_watch_comparison' : 'reference_watch',
    returnHost, returnPort, restoreCommand: `ip,${returnHost},${returnPort}#`,
    returnRouteVerified: false, routingRestored: false,
    guardianTelemetryPausedDuringComparison: Boolean(target),
  };
}

function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--protocol-id', '--listen-port', '--minutes', '--guardian-return-host', '--guardian-return-port', '--run'].includes(key) || key in values) throw new Error(USAGE);
    if (key === '--run') values[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      values[key] = value;
    }
  }
  const portText = values['--listen-port'] ?? '9002';
  const minuteText = values['--minutes'] ?? '15';
  if (!/^\d{10}$/.test(values['--protocol-id'] || '') || !/^\d+$/.test(portText) || !/^\d+$/.test(minuteText)) throw new Error(USAGE);
  const listenPort = Number(portText), minutes = Number(minuteText);
  if (listenPort < 1024 || listenPort > 65535 || [9000, 9001].includes(listenPort) || minutes < 1 || minutes > 20) throw new Error(USAGE);
  const options = { protocolId: values['--protocol-id'], listenPort, minutes, run: values['--run'] === true };
  const hasHost = '--guardian-return-host' in values, hasPort = '--guardian-return-port' in values;
  if (hasHost !== hasPort) throw new Error('Both Guardian return options are required.');
  if (hasHost) {
    if (!/^\d+$/.test(values['--guardian-return-port'])) throw new Error(USAGE);
    options.guardianReturn = { host: values['--guardian-return-host'], port: Number(values['--guardian-return-port']) };
    restorationPlan(options);
  }
  return options;
}

function frameSummary(frame, protocolId, direction) {
  // latin1 preserves bytes: a high-bit byte must never become safe ASCII.
  const raw = frame.toString('latin1');
  const match = /^\[([A-Z0-9]{2})\*(\d{10})\*([0-9a-fA-F]{4})\*([\s\S]*)\]$/.exec(raw);
  if (!match || match[2] !== protocolId) return null;
  const body = match[4];
  const token = body.split(',', 1)[0];
  const command = /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(token) ? token : 'unrecognized';
  const summary = { command, prefix: match[1], lengthField: match[3],
    declaredPayloadBytes: parseInt(match[3], 16), actualPayloadBytes: frame.length - 21,
    lengthMatches: parseInt(match[3], 16) === frame.length - 21,
    argumentCount: (body.match(/,/g) || []).length, argumentsRedacted: true,
    appliedStateVerified: false };
  // Capture literal observed short switches, including an unknown command
  // name with a single 0/1 parameter. Recognition is NOT permission to send it.
  const safeDownlink = direction === 'server_to_watch' &&
    /^(?:APPLOCK,JT-[01]|[A-Za-z][A-Za-z0-9_]{0,31},[01])$/.test(body);
  const bareReply = /^(APPLOCK|ANS)$/.test(body);
  if (safeDownlink || bareReply) {
    summary.argumentsRedacted = false;
    summary.frame = raw;
    summary.frameHex = frame.toString('hex');
  }
  if (command === 'CONFIG') {
    const jt = /(?:^|[,;])JT[:=-]([01])(?=[,;]|$)/.exec(body);
    if (jt) summary.reportedJt = Number(jt[1]);
  }
  return summary;
}

class FrameObserver {
  constructor({ protocolId, direction, emit }) {
    this.protocolId = protocolId;
    this.direction = direction;
    this.emit = emit;
    this.buffer = Buffer.alloc(0);
    this.disabled = false;
  }
  push(chunk) {
    if (this.disabled) return;
    // Chunk processing keeps retained memory bounded even for binary uploads.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 4096)]);
      while (this.buffer.length) {
        const start = this.buffer.indexOf(0x5b);
        if (start < 0) { this.buffer = Buffer.alloc(0); break; }
        if (start > 0) this.buffer = this.buffer.subarray(start);
        if (this.buffer.length < 20) break;
        const header = /^\[([A-Z0-9]{2})\*(\d{10})\*([0-9a-fA-F]{4})\*$/.exec(this.buffer.subarray(0, 20).toString('latin1'));
        if (!header) { this.buffer = this.buffer.subarray(1); continue; }
        const total = 21 + parseInt(header[3], 16);
        if (this.buffer.length < total) break;
        if (this.buffer[total - 1] !== 0x5d) {
          // Stop observation on framing loss; never mislabel embedded binary
          // data as subsequent commands. Forwarding remains byte-transparent.
          this.disabled = true;
          this.buffer = Buffer.alloc(0);
          this.emit({ event: 'observation_stopped', direction: this.direction, reason: 'invalid_frame_boundary' });
          return;
        }
        const frame = this.buffer.subarray(0, total);
        this.buffer = this.buffer.subarray(total);
        const summary = frameSummary(frame, this.protocolId, this.direction);
        this.emit(summary ? { event: 'frame', direction: this.direction, ...summary }
          : { event: 'frame_redacted', direction: this.direction, reason: 'unexpected_identity' });
      }
      if (this.buffer.length > MAX_FRAME) {
        this.disabled = true;
        this.buffer = Buffer.alloc(0);
        this.emit({ event: 'observation_stopped', direction: this.direction, reason: 'buffer_limit' });
        return;
      }
    }
  }
  finish() {
    if (this.buffer.length) this.emit({ event: 'observation_incomplete', direction: this.direction, retainedBytes: this.buffer.length });
    this.buffer = Buffer.alloc(0);
  }
}

async function startRelay(options, { emit = row => console.log(JSON.stringify(row)),
  connect = () => net.createConnection({ host: REFERENCE_HOST, port: REFERENCE_PORT }),
  now = () => new Date(), durationMs = options.minutes * 60000, identifyTimeoutMs = 10000,
  connectTimeoutMs = 10000 } = {}) {
  const restoration = restorationPlan(options);
  const sockets = new Set();
  const observers = new Set();
  let rows = 0, sequence = 0, stopping = false, timer;
  const log = row => {
    if (rows++ < MAX_ROWS) emit({ at: now().toISOString(), ...row });
    else if (rows === MAX_ROWS + 1) emit({ at: now().toISOString(), event: 'capture_limit', captureComplete: false });
  };
  const server = net.createServer(watch => {
    if (stopping || sockets.size >= 8 || sequence >= 40) { watch.destroy(); return; }
    const session = ++sequence;
    let upstream, initial = Buffer.alloc(0), closed = false, connectTimer;
    const sessionLog = row => log({ session, ...row });
    const pairObservers = [];
    sockets.add(watch);
    watch.setNoDelay(true);
    const identificationTimer = setTimeout(() => close('identification_timeout'), identifyTimeoutMs);
    const close = reason => {
      if (closed) return;
      closed = true;
      clearTimeout(identificationTimer);
      clearTimeout(connectTimer);
      for (const observer of pairObservers) { observer.finish(); observers.delete(observer); }
      watch.destroy(); sockets.delete(watch);
      if (upstream) { upstream.destroy(); sockets.delete(upstream); }
      sessionLog({ event: 'session_closed', reason });
    };
    watch.on('error', () => close('watch_socket_error'));
    watch.on('close', () => close('watch_closed'));
    const onFirstData = chunk => {
      if (initial.length + chunk.length > MAX_FRAME * 2) { close('initial_buffer_limit'); return; }
      initial = Buffer.concat([initial, chunk]);
      if (initial.length < 20) return;
      const header = /^\[([A-Z0-9]{2})\*(\d{10})\*([0-9a-fA-F]{4})\*$/.exec(initial.subarray(0, 20).toString('latin1'));
      if (!header || header[2] !== options.protocolId) { close('identity_not_allowed'); return; }
      watch.pause();
      watch.off('data', onFirstData);
      clearTimeout(identificationTimer);
      try { upstream = connect(); } catch { close('reference_connect_failed'); return; }
      sockets.add(upstream);
      upstream.setNoDelay(true);
      connectTimer = setTimeout(() => close('reference_connect_timeout'), connectTimeoutMs);
      upstream.on('error', () => close('reference_socket_error'));
      upstream.on('close', () => close('reference_closed'));
      upstream.once('connect', () => {
        if (closed) return;
        clearTimeout(connectTimer);
        sessionLog({ event: 'reference_connected' });
        const tap = direction => {
          const observer = new FrameObserver({ protocolId: options.protocolId, direction, emit: sessionLog });
          observers.add(observer); pairObservers.push(observer);
          return new Transform({ transform(chunk, encoding, done) {
            observer.push(chunk);
            done(null, chunk); // exact original Buffer, with stream backpressure
          } });
        };
        const uplink = tap('watch_to_server'), downlink = tap('server_to_watch');
        uplink.on('error', () => close('observation_error'));
        downlink.on('error', () => close('observation_error'));
        watch.unshift(initial); initial = Buffer.alloc(0);
        watch.pipe(uplink).pipe(upstream);
        upstream.pipe(downlink).pipe(watch);
      });
    };
    watch.on('data', onFirstData);
  });
  const stop = async (reason = 'operator_stopped') => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    for (const observer of observers) observer.finish();
    observers.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await new Promise(resolve => server.close(resolve));
    // Always print restoration guidance, even if capture reached its row cap.
    emit({ at: now().toISOString(), event: 'relay_stopped', reason, ...restoration,
      note: 'Send the prepared return SMS and verify fresh telemetry at the original server. Stopping or expiry does not restore routing.' });
  };
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.listenPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  server.on('error', () => { void stop('listener_error'); });
  timer = setTimeout(() => { void stop('capture_window_ended'); }, durationMs);
  log({ event: 'relay_listening', protocolId: options.protocolId, address: server.address(),
    referenceHost: REFERENCE_HOST, referencePort: REFERENCE_PORT, minutes: options.minutes,
    ...restoration, appliedStateVerified: false,
    note: options.guardianReturn
      ? 'Same-watch comparison requires operator agreement to temporary supplier routing and a verified Guardian return SMS. Supplier traffic reaches the watch unchanged.'
      : 'Only use after confirming the reference watch already uses this server and preparing its return SMS.' });
  return { server, stop };
}

async function main(args) {
  const options = parseArguments(args);
  if (!options.run) {
    console.log(JSON.stringify({ outcome: 'preview', ...options, referenceHost: REFERENCE_HOST,
      referencePort: REFERENCE_PORT, networkOpened: false, commandsGenerated: false,
      ...restorationPlan(options),
      note: options.guardianReturn
        ? 'Prepared comparison only. Confirm owner agreement, AnyTracking access and the current Guardian return route before changing routing. Read docs/testing/answer-mode-same-watch-capture.md.'
        : 'For the separate reference watch only. Confirm its existing server matches before --run. Read docs/testing/answer-mode-reference-relay.md.' }, null, 2));
    return;
  }
  const relay = await startRelay(options);
  process.once('SIGINT', () => { void relay.stop(); });
  process.once('SIGTERM', () => { void relay.stop(); });
}

if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Capture failed. Check arguments/listen port. If routing was changed, restore the watch to its original server using the prepared SMS.');
  process.exitCode = 1;
});
module.exports = { parseArguments, restorationPlan, frameSummary, FrameObserver, startRelay, main };
