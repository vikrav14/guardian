'use strict';

// Standalone diagnostic. No Firebase/config imports and no generated commands.
// Both backends share this byte-preserving relay so differences can be measured.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const BACKENDS = Object.freeze({
  guardian: Object.freeze({ host: '127.0.0.1', port: 9000 }),
  anytracking: Object.freeze({ host: 'a.igps123.com', port: 7720 }),
});
const MAX_FRAME = 65556;
const MAX_ROWS = 2000;
const USAGE = 'Use --backend guardian|anytracking --protocol-id <10 digits> --return-url tcp://<current-Guardian-host>:<port> --output <new-absolute-jsonl-path> [--listen-port 9002] [--minutes 10] [--run].';

function restorationPlan(options) {
  let target;
  try { target = new URL(options.returnUrl); } catch { throw Error(USAGE); }
  const host = target.hostname;
  if (target.protocol !== 'tcp:' || !target.port || Number(target.port) < 1 || target.username || target.password
      || (target.pathname && target.pathname !== '/') || target.search || target.hash
      || !host.includes('.') || host.length > 253 || host.toLowerCase().endsWith('.localhost')
      || /^127\./.test(host) || host === '0.0.0.0'
      || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      || (/^[\d.]+$/.test(host) && net.isIP(host) !== 4)) throw Error(USAGE);
  return { restoreCommand: `ip,${host},${target.port}#`, returnRouteVerified: false,
    routingRestored: false, guardianTelemetryPausedDuringComparison: options.backend === 'anytracking' };
}

function parseArguments(args, { maxMinutes = 20, defaultMinutes = 10 } = {}) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--backend', '--protocol-id', '--return-url', '--output', '--listen-port', '--minutes', '--run'].includes(key)
        || Object.hasOwn(values, key)) throw Error(USAGE);
    if (key === '--run') values[key] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw Error(USAGE); values[key] = value; }
  }
  const port = values['--listen-port'] ?? '9002', minutes = values['--minutes'] ?? String(defaultMinutes);
  if (!Object.hasOwn(BACKENDS, values['--backend'] || '') || !/^\d{10}$/.test(values['--protocol-id'] || '')
      || !/^\d+$/.test(port) || +port < 1024 || +port > 65535 || [9000, 9001].includes(+port)
      || !/^\d+$/.test(minutes) || +minutes < 1 || +minutes > maxMinutes
      || typeof values['--output'] !== 'string' || !path.isAbsolute(values['--output'])) throw Error(USAGE);
  const options = { backend: values['--backend'], protocolId: values['--protocol-id'],
    returnUrl: values['--return-url'], output: values['--output'], listenPort: +port, minutes: +minutes,
    run: values['--run'] === true };
  restorationPlan(options);
  return options;
}

function createLog(output, { write = fs.writeSync } = {}) {
  const fd = fs.openSync(output, 'wx', 0o600);
  let closed = false;
  const writer = { failed: false, failureReported: false,
    write(row) {
      if (closed || writer.failed) return false;
      const data = Buffer.from(JSON.stringify(row) + '\n');
      try {
        for (let offset = 0; offset < data.length;) {
          const n = write(fd, data, offset, data.length - offset);
          if (!Number.isInteger(n) || n <= 0 || n > data.length - offset) throw Error('write failed');
          offset += n;
        }
        return true;
      } catch { writer.failed = true; return false; }
    },
    close() {
      if (!closed) { closed = true; try { fs.closeSync(fd); } catch { writer.failed = true; } }
      return !writer.failed;
    },
  };
  return writer;
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
  const exactSafe = /^(?:CONFIG,1|LK|TKQ|ICCID|RYIMEI|CR|SEDENTARY|SEDENTARYWORKTIME)$/.test(body)
    || (direction === 'server_to_watch' && (
      /^SEDENTARY,[01],(?:20|26)$/.test(body)
      || /^SEDENTARYWORKTIME,(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d,-$/.test(body)));
  if (exactSafe && summary.lengthMatches) {
    summary.argumentsRedacted = false;
    summary.frame = raw;
    summary.frameHex = frame.toString('hex');
  }
  return summary;
}

class FrameObserver {
  constructor({ protocolId, direction, emit, summarize = frameSummary }) {
    this.protocolId = protocolId;
    this.direction = direction;
    this.emit = emit;
    this.summarize = summarize;
    this.buffer = Buffer.alloc(0);
    this.disabled = false;
  }
  push(chunk) {
    if (this.disabled) return;
    // Chunk processing keeps retained memory bounded even for binary uploads.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 4096)]);
      while (this.buffer.length) {
        if (this.buffer[0] !== 0x5b) {
          this.disabled = true; this.buffer = Buffer.alloc(0);
          this.emit({ event: 'observation_stopped', direction: this.direction, reason: 'invalid_frame_start' });
          return;
        }
        if (this.buffer.length < 20) break;
        const header = /^\[([A-Z0-9]{2})\*(\d{10})\*([0-9a-fA-F]{4})\*$/.exec(this.buffer.subarray(0, 20).toString('latin1'));
        if (!header) {
          this.disabled = true; this.buffer = Buffer.alloc(0);
          this.emit({ event: 'observation_stopped', direction: this.direction, reason: 'invalid_frame_header' });
          return;
        }
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
        const summary = this.summarize(frame, this.protocolId, this.direction);
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
  connect = () => net.createConnection(BACKENDS[options.backend]),
  now = () => new Date(), durationMs = options.minutes * 60000, identifyTimeoutMs = 10000,
  connectTimeoutMs = 10000, writeLog = fs.writeSync, summarize = frameSummary } = {}) {
  const restoration = restorationPlan(options);
  const writer = createLog(options.output, { write: writeLog });
  const sockets = new Set();
  const closeSessions = new Set();
  let rows = 0, sequence = 0, stopping = false, timer, stopPromise;
  let observationComplete = true, framesObserved = 0;
  const publish = row => {
    const value = { at: now().toISOString(), backend: options.backend, ...row };
    const saved = writer.write(value);
    if (!saved && !writer.failureReported) {
      writer.failureReported = true;
      emit({ event: 'capture_write_failed', forwardingContinues: true, captureComplete: false });
    }
    return value;
  };
  const log = row => {
    if (row.event === 'frame') framesObserved++;
    if (['observation_stopped', 'observation_incomplete', 'frame_redacted'].includes(row.event)) observationComplete = false;
    if (rows++ < MAX_ROWS) publish(row);
    else if (rows === MAX_ROWS + 1) {
      const limit = publish({ event: 'capture_limit', captureComplete: false });
      emit(limit);
    }
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
      for (const observer of pairObservers) observer.finish();
      watch.destroy(); sockets.delete(watch);
      if (upstream) { upstream.destroy(); sockets.delete(upstream); }
      closeSessions.delete(close);
      sessionLog({ event: 'session_closed', reason });
    };
    closeSessions.add(close);
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
      try { upstream = connect(); } catch { close('upstream_connect_failed'); return; }
      sockets.add(upstream);
      upstream.setNoDelay(true);
      connectTimer = setTimeout(() => close('upstream_connect_timeout'), connectTimeoutMs);
      upstream.on('error', () => close('upstream_socket_error'));
      upstream.on('close', () => close('upstream_closed'));
      upstream.once('connect', () => {
        if (closed) return;
        clearTimeout(connectTimer);
        sessionLog({ event: 'upstream_connected' });
        emit({ event: 'upstream_connected', backend: options.backend, session });
        const tap = direction => {
          const observer = new FrameObserver({ protocolId: options.protocolId, direction, emit: sessionLog, summarize });
          pairObservers.push(observer);
          return new Transform({ transform(chunk, encoding, done) {
            try { observer.push(chunk); }
            catch { observer.disabled = true; observer.buffer = Buffer.alloc(0);
              sessionLog({ event: 'observation_stopped', direction, reason: 'observer_error' }); }
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
  const stop = (reason = 'operator_stopped') => {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      clearTimeout(timer);
      for (const close of closeSessions) close(reason);
      await new Promise(resolve => server.close(resolve));
      const ended = publish({ event: 'relay_stopped', reason, ...restoration,
        framesObserved, captureComplete: observationComplete && framesObserved > 0 && !writer.failed && rows <= MAX_ROWS,
        note: 'Stopping does not restore routing. Use the current Guardian return SMS and verify fresh Guardian packets.' });
      const saved = writer.close();
      emit({ ...ended, captureComplete: ended.captureComplete && saved });
    })();
    return stopPromise;
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.listenPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    writer.close();
    throw error;
  }
  server.on('error', () => { void stop('listener_error'); });
  timer = setTimeout(() => { void stop('capture_window_ended'); }, durationMs);
  const ready = { event: 'relay_listening', protocolId: options.protocolId, address: server.address(),
    upstream: BACKENDS[options.backend], minutes: options.minutes, output: options.output,
    ...restoration, commandsGenerated: false, originalBytesForwarded: true,
    appliedStateVerified: false, captureComplete: false,
    note: 'Capture only. Send the verified recorder SMS only after this listener is ready. Restore Guardian before expiry.' };
  log(ready);
  emit({ at: now().toISOString(), backend: options.backend, ...ready });
  return { server, stop };
}

async function main(args) {
  const options = parseArguments(args);
  if (!options.run) {
    console.log(JSON.stringify({ outcome: 'preview', ...options, upstream: BACKENDS[options.backend],
      ...restorationPlan(options), networkOpened: false, fileCreated: false, commandsGenerated: false,
      note: 'Verify the current Guardian return route and recorder tunnel before --run. Preview does not test reachability.' }, null, 2));
    return;
  }
  const relay = await startRelay(options);
  process.once('SIGINT', () => { void relay.stop(); });
  process.once('SIGTERM', () => { void relay.stop(); });
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Capture could not start or complete. Check arguments, output path and listen port. If routing changed, restore the current Guardian route.');
  process.exitCode = 1;
});
module.exports = { BACKENDS, parseArguments, restorationPlan, createLog, frameSummary, FrameObserver, startRelay, main };
