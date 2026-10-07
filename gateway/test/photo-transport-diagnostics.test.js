'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { notePhotoTransportPacket, createPhotoTransportDiagnostics } = require('../src/photo-transport-diagnostics');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');

test('records the decoder event that preceded capture without packet arguments or identities', () => {
  const session = { lastPacketAt: 1000 };
  const decoded = decodeFrame(Buffer.from('[3G*9705254749*000A*UPLOAD,600]'));
  const { events } = handlePacket(decoded, session);
  notePhotoTransportPacket(session, events, 1000);
  const d = createPhotoTransportDiagnostics({}, session, () => 5500).snapshot();
  assert.deepEqual(d.lastDecodedPacket, { kind: 'command_echo', echo: 'UPLOAD', ageMs: 4500 });
  assert.equal(d.lastChunkAgeMs, 4500);
  assert.equal(d.evidence, 'node_stream_not_watch_delivery');
  for (const secret of ['9705254749', '861397052547492', '600']) assert(!JSON.stringify(d).includes(secret));
  notePhotoTransportPacket(session, [{ type: 'command_echo', command: 'CALL,private_number' }], 6000);
  assert.equal(createPhotoTransportDiagnostics({}, session, () => 7000).snapshot().lastDecodedPacket.echo, 'other');
  notePhotoTransportPacket(session, [{ type: 'location', lat: -20.1, privateRadio: 'private' }], 7000);
  assert.deepEqual(session.photoTransportPacket, { at: 7000, kind: 'location', echo: null });
});

test('write backpressure and callback completion are independent evidence, never device receipt', () => {
  let at = 1000;
  const socket = { bytesRead: 50, bytesWritten: 10, writableLength: 0, writable: true, destroyed: false };
  const d = createPhotoTransportDiagnostics(socket, { lastPacketAt: 990 }, () => at);
  socket.bytesWritten = 39; socket.writableLength = 29; d.returned(false);
  assert.equal(d.snapshot().writeReturned, false);
  assert.equal(d.snapshot().callback.outcome, 'not_observed');
  at += 17; socket.writableLength = 0; d.callback();
  const s = d.snapshot();
  assert.equal(s.before.bytesWritten, 10); assert.equal(s.afterWrite.writableLength, 29);
  assert.equal(s.callback.outcome, 'completed'); assert.equal(s.callback.afterMs, 17);
  assert.equal(s.callback.counters.writableLength, 0);
  assert.equal(s.evidence, 'node_stream_not_watch_delivery');
});

test('diagnostic failures, invalid clocks and hostile error messages cannot leak or throw', () => {
  const socket = { get writableLength() { throw Error('private'); } };
  const d = createPhotoTransportDiagnostics(socket, { lastPacketAt: 10000 }, () => 1000);
  d.returned(undefined); d.callback({ code: 'private_response', message: 'secret' });
  d.threw({ code: 'EPIPE', message: 'private' });
  const s = d.snapshot();
  assert.equal(s.lastChunkAgeMs, null); assert.equal(s.before, null);
  assert.equal(s.callback.errorCode, 'other'); assert.equal(s.throwCode, 'EPIPE');
  assert(!JSON.stringify(s).includes('private')); assert(!JSON.stringify(s).includes('secret'));
  assert.doesNotThrow(() => notePhotoTransportPacket({}, null, 1000));
});
