'use strict';

// Metadata only. A Node write callback does not prove tunnel/watch delivery.
const KINDS = new Set(['alarm', 'location', 'heartbeat', 'command_echo', 'imei_report']);
const ECHOES = new Set(['UPLOAD', 'CR', 'RCAPTURE']);
const ERRORS = new Set(['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ERR_STREAM_DESTROYED', 'ERR_SOCKET_CLOSED']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const age = (at, previous) => Number.isFinite(previous) && previous <= at ? at - previous : null;
const safe = fn => (...args) => { try { return fn(...args); } catch { return null; } };

// Use decoder event types, not a guessed list of UD/AL spelling variants.
// Keep no packet content, device identity, location, radio or call destination.
const notePhotoTransportPacket = safe((session, events, receivedAtMs) => {
  if (!session || !Number.isFinite(receivedAtMs)) return;
  const selected = [...KINDS].map(kind => events.find(e => e.type === kind)).find(Boolean);
  const kind = selected?.type || 'other';
  const name = kind === 'command_echo' && typeof selected.command === 'string'
    ? selected.command.toUpperCase() : null;
  session.photoTransportPacket = { at: receivedAtMs, kind,
    echo: name ? (ECHOES.has(name) ? name : 'other') : null };
});

function createPhotoTransportDiagnostics(socket, session, now) {
  const startedAt = +now();
  const counters = safe(() => ({ bytesRead: count(socket.bytesRead), bytesWritten: count(socket.bytesWritten),
    writableLength: count(socket.writableLength), destroyed: socket.destroyed === true,
    writable: typeof socket.writable === 'boolean' ? socket.writable : null }));
  const packet = session.photoTransportPacket;
  const data = { version: 1, evidence: 'node_stream_not_watch_delivery',
    lastChunkAgeMs: age(startedAt, session.lastPacketAt),
    lastDecodedPacket: packet ? { kind: KINDS.has(packet.kind) ? packet.kind : 'other',
      echo: ECHOES.has(packet.echo) ? packet.echo : packet.echo ? 'other' : null,
      ageMs: age(startedAt, packet.at) } : null,
    before: counters(), writeReturned: null, afterWrite: null,
    callback: { outcome: 'not_observed', afterMs: null, errorCode: null, counters: null },
    threw: false, throwCode: null };
  const code = error => ERRORS.has(error?.code) ? error.code : 'other';
  return {
    returned: safe(value => { data.writeReturned = typeof value === 'boolean' ? value : null; data.afterWrite = counters(); }),
    callback: safe(error => { data.callback = { outcome: error ? 'error' : 'completed',
      afterMs: age(+now(), startedAt), errorCode: error ? code(error) : null, counters: counters() }; }),
    threw: safe(error => { data.threw = true; data.throwCode = code(error); }),
    snapshot: safe(() => ({ ...data, callback: { ...data.callback }, observed: counters() })),
  };
}

module.exports = { notePhotoTransportPacket, createPhotoTransportDiagnostics };
