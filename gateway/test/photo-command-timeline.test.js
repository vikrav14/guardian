'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoCommandObserver, noteDeviceWrite, beginPhotoCommandTimeline } = require('../src/photo-command-timeline');
const { setup, receive, imei, protocolId } = require('./helpers/photo-harness');
const { sendDownlinkCommand } = require('../src/downlink');
const sessions = require('../src/sessions');
const frame = body => Buffer.from(`[3G*${protocolId}*${Buffer.byteLength(body).toString(16).padStart(4, '0')}*${body}]`);
const input = { imei, purpose: 'Check immediate surroundings', consentConfirmed: true, safetyPurposeConfirmed: true };
const base = Date.parse('2026-10-01T00:00:00Z');

test('lookback and active timeline distinguish commands, ACKs and replacement sessions without payloads', () => {
  const observer = createPhotoCommandObserver(), socket = {}, session = { imei, protocolId };
  observer.noteWrite(socket, session, frame('UPLOAD,300'), 'downlink', base - 121_000);
  observer.noteWrite(socket, session, frame('UPLOAD,60'), 'downlink', base - 1000);
  const trace = observer.begin({ socket, session, startedAt: base, expiresAt: base + 120_000 });
  observer.noteWrite(socket, session, frame('rcapture'), 'photo_capture', base);
  observer.noteWrite(socket, session, frame('LK'), 'protocol_ack', base + 500);
  observer.noteWrite({}, { ...session }, frame('CR'), 'downlink', base + 1000);
  observer.noteWrite({}, { ...session, imei: '861397052547490' }, frame('CR'), 'downlink', base + 1100);
  for (const command of ['CALL,+23057123456', 'PHBX,1,private-name,+23057123456',
    'WIFIFENCE,1,private-router', 'private_unknown_command,private-body']) {
    observer.noteWrite(socket, session, frame(command), 'downlink', base + 1200);
  }
  trace.stop('image_received', base + 5000);
  observer.noteWrite(socket, session, frame('UPLOAD,300'), 'downlink', base + 6000);
  const data = trace.snapshot();
  assert.deepEqual(data.events.map(row => row.command), ['UPLOAD', 'RCAPTURE', 'LK', 'CR', 'CALL', 'PHBX', 'WIFIFENCE', 'OTHER']);
  assert.equal(data.events[0].phase, 'before'); assert.equal(data.events[0].afterMs, -1000);
  assert.equal(data.events[0].reportingIntervalSeconds, 60);
  assert.equal(data.events[3].sameSession, false);
  assert.equal(data.duringWriteAttempts, 7);
  assert.equal(data.endReason, 'image_received');
  for (const hidden of ['private', '+23057123456', imei, protocolId]) assert.equal(JSON.stringify(data).includes(hidden), false);
  data.events.length = 0;
  assert.equal(trace.snapshot().events.length, 8, 'inspection returns a detached snapshot');
});

test('high traffic has explicit truncation and expires without blocking or retaining an unbounded timeline', () => {
  const observer = createPhotoCommandObserver(), socket = {}, session = { imei, protocolId };
  for (let i = 0; i < 40; i++) observer.noteWrite(socket, session, frame('LK'), 'protocol_ack', base - 40 + i);
  const trace = observer.begin({ socket, session, startedAt: base, expiresAt: base + 120_000 });
  for (let i = 0; i < 100; i++) observer.noteWrite(socket, session, frame('LK'), 'protocol_ack', base + i);
  observer.noteWrite(socket, session, frame('CR'), 'downlink', base + 120_000);
  const data = trace.snapshot();
  assert.equal(data.events.length, 64); assert.equal(data.beforeTruncated, true);
  assert.equal(data.duringWriteAttempts, 100); assert.equal(data.duringDropped, 52);
  assert.equal(data.endReason, 'expired');
  assert.equal(data.events.some(row => row.command === 'CR'), false);
  assert.doesNotThrow(() => observer.noteWrite(null, null, 'invalid', 'private-source', NaN));
});

test('real downlink writes continue unchanged and show up on the matching photo trace', t => {
  const writes = [], socket = { write: bytes => { writes.push(bytes); return false; } };
  sessions.registerSession(socket, { imei, protocolId });
  const session = sessions.getSession(socket);
  t.after(() => sessions.unregisterSession(socket));
  const at = new Date(), trace = beginPhotoCommandTimeline({ socket, session, startedAt: at, expiresAt: new Date(+at + 120_000) });
  t.after(() => trace.stop('failed'));
  const result = sendDownlinkCommand(imei, 'CR');
  assert.equal(result.ok, true); assert.equal(writes.length, 1);
  assert.equal(writes[0].toString(), `[SG*${protocolId}*0002*CR]`);
  assert.equal(trace.snapshot().events.at(-1).command, 'CR');
});

test('a timed-out capture persists camera and competing writes with no additional camera commands', async () => {
  const s = setup();
  noteDeviceWrite(s.socket, s.session, frame('UPLOAD,60'), 'downlink', +s.args.now() - 1000);
  const id = await s.api.request('owner', input);
  s.advance(500); noteDeviceWrite(s.socket, s.session, frame('LK'), 'protocol_ack', s.args.now());
  s.advance(500); noteDeviceWrite(s.socket, s.session, frame('hrtstart,1'), 'downlink', s.args.now());
  s.advance(120_000); await s.api.sweep();
  assert.equal(s.auth(id).reason, 'image_timeout');
  const timeline = s.auth(id).receiveDiagnostics.commandTimeline;
  assert.deepEqual(timeline.events.map(row => row.command), ['UPLOAD', 'RCAPTURE', 'LK', 'HRTSTART']);
  assert.deepEqual(timeline.events.map(row => row.afterMs), [-1000, 0, 500, 1000]);
  assert.equal(timeline.endReason, 'expired');
  assert.equal(s.writes.length, 1); assert.equal(s.objects.size, 0);
});

test('image arrival stops the command timeline before asynchronous storage, without changing the image', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.advance(5000); await receive(s, id);
  const saved = structuredClone(s.auth(id));
  assert.equal(saved.state, 'available');
  assert.equal(saved.receiveDiagnostics.commandTimeline.endReason, 'image_received');
  assert.equal(saved.receiveDiagnostics.commandTimeline.duringWriteAttempts, 1);
  noteDeviceWrite(s.socket, s.session, frame('CR'), 'downlink', s.args.now());
  assert.deepEqual(s.auth(id), saved); assert.equal(s.writes.length, 1);
});
