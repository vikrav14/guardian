'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhotoIngressObserver, MAX_TRACES, MAX_SESSIONS, MAX_EVENTS } = require('../src/photo-ingress-observer');
const { createSnapshotController, isPhotoFrame } = require('../src/safety-snapshot-live');
const { extractFrames } = require('../src/protocol/gt06');
const { setup, frame, until, imei, protocolId } = require('./helpers/photo-harness');
const input = { imei, purpose: 'Observe immediate surroundings', consentConfirmed: true, safetyPurposeConfirmed: true };
const records = logs => logs.filter(s => s.startsWith('[photo-ingress] ')).map(s => JSON.parse(s.slice(16)));
function ingest(s, socket, session, chunk) {
  s.api.observeIngress(socket, session, chunk.length);
  const result = extractFrames(Buffer.concat([session.buffer || Buffer.alloc(0), chunk]));
  session.buffer = Buffer.from(result.rest);
  s.api.observeTraffic(socket, session, { chunkBytes: chunk.length, ...result });
  for (const bytes of result.frames) if (isPhotoFrame(bytes)) s.api.observe(bytes, socket, session);
}
function observer() {
  let at = Date.parse('2026-10-02T11:00:00Z');
  const logs = [], timers = new Set();
  const o = createPhotoIngressObserver({ now: () => at, log: s => logs.push(s),
    schedule: (fn, delay) => { const t = { fn, delay }; timers.add(t); return t; }, cancel: t => timers.delete(t) });
  const socket = {}, session = { imei, protocolId };
  const begin = (id = 'request-1', target = socket) => o.begin({ id, imei, protocolId, socket: target, expiresAt: at + 120_000 });
  return { o, logs, timers, socket, session, begin, advance: ms => { at += ms; } };
}

test('late image after pending removal is diagnosed without accepting, retrying or extending authorization', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.advance(250); ingest(s, s.socket, s.session, Buffer.from('[3G*9705254749*0008*rcapture]'));
  s.advance(120_000); await s.api.sweep();
  const expiry = +s.auth(id).authorizationExpiresAt;
  const bytes = frame();
  ingest(s, s.socket, s.session, bytes.subarray(0, 40));
  s.advance(1000); ingest(s, s.socket, s.session, bytes.subarray(40));
  const rows = records(s.logs);
  assert(rows.some(r => r.kind === 'photo_header' && r.form === 'incomplete_frame' && r.afterCaptureExpiry));
  assert(rows.some(r => r.kind === 'photo_disposition' && r.reason === 'no_pending_request' && r.pendingRequest === 'none'));
  assert.equal(s.auth(id).reason, 'image_timeout'); assert.equal(+s.auth(id).authorizationExpiresAt, expiry);
  assert.equal(s.writes.length, 1); assert.equal(s.objects.size, 0);
  s.advance(120_000); await s.api.sweep();
  const end = records(s.logs).find(r => r.kind === 'observation_finished');
  assert.equal(end.sessions[0].bytes, 29 + bytes.length); assert.equal(end.sessions[0].photoHeaders, 1);
  assert.equal(s.api.ingressDiagnosticsStatus().activeObservations, 0);
  const count = s.logs.length;
  ingest(s, s.socket, s.session, bytes); assert.equal(s.logs.length, count, 'observation deadline is finite');
});

test('identified and unidentified replacement connections expose header/drop evidence but cannot migrate capture', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  ingest(s, {}, { imei, protocolId }, frame());
  const unknown = {}, anonymous = {};
  ingest(s, unknown, anonymous, frame());
  s.api.disconnect(unknown);
  const rows = records(s.logs);
  for (const relation of ['other_identified_connection', 'unidentified_connection']) {
    assert(rows.some(r => r.kind === 'photo_header' && r.relation === relation && r.headerMatchesRequest));
    assert(rows.some(r => r.reason === 'no_pending_request' && r.relation === relation));
  }
  assert(rows.some(r => r.kind === 'connection_closed' && r.observedBytes === frame().length));
  assert.equal(s.auth(id).state, 'waiting_for_image'); assert.equal(s.objects.size, 0);
  assert.equal(s.writes.length, 1); assert.equal(anonymous.imei, undefined);
  const text = JSON.stringify(rows);
  for (const secret of [imei, protocolId, input.purpose, '260925002653', frame().toString('hex')]) assert(!text.includes(secret));
});

test('selected identity changes and unsupported photo header layouts are visible without widening ingress', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.session.imei = '861397052547490';
  ingest(s, s.socket, s.session, frame());
  assert(records(s.logs).some(r => r.reason === 'identity_mismatch' && r.relation === 'capture_identity_changed'));
  s.session.imei = imei;
  ingest(s, s.socket, s.session, Buffer.from('[3G*861397052547492*0004*IMG,]'));
  assert(records(s.logs).some(r => r.kind === 'photo_header' && r.receiverRecognizesHeader === false));
  assert.equal(s.auth(id).state, 'waiting_for_image'); assert.equal(s.objects.size, 0);
});

test('metadata observation does not turn a valid image into a rejection or add a command', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  ingest(s, s.socket, s.session, frame());
  await until(() => s.auth(id).state === 'available');
  assert.equal(s.objects.size, 1); assert.equal(s.writes.length, 1);
  assert(records(s.logs).some(r => r.reason === 'passed_ingress_guard'));
  s.advance(241_000); await s.api.sweep();
});

test('no request and another identified device produce no scoped traffic logs; restarted observer does not resume', () => {
  const s = observer();
  s.o.chunk(s.socket, s.session, 500); assert.equal(s.logs.length, 0);
  s.begin();
  s.o.chunk({}, { imei: '861397052547490', protocolId: '9705254740' }, 500);
  assert.equal(s.logs.length, 1);
  const restarted = createPhotoIngressObserver({ log: value => s.logs.push(value) });
  restarted.chunk(s.socket, s.session, 3000);
  assert.equal(s.logs.length, 1); assert.equal(restarted.getStatus().activeObservations, 0);
  s.advance(240_000); s.o.sweep(); assert.equal(s.timers.size, 0);
});

test('overlapping observation windows never label a later capture as correlated to the earlier request', () => {
  const s = observer(); s.begin('older'); s.advance(65_000); s.begin('newer');
  s.o.disposition(s.socket, s.session, 'passed_ingress_guard', 'newer');
  const rows = records(s.logs).filter(r => r.kind === 'photo_disposition');
  assert.equal(rows.find(r => r.requestId === 'older').pendingRequest, 'another_request');
  assert.equal(rows.find(r => r.requestId === 'newer').pendingRequest, 'this_observation');
  assert(rows.every(r => r.evidence === 'observation_not_capture_correlation'));
  s.advance(240_000); s.o.sweep(); assert.equal(s.timers.size, 0);
});

test('session, event and trace limits retain loss indicators and release timers', () => {
  const s = observer(); s.begin();
  for (let i = 0; i < MAX_SESSIONS + 5; i++) s.o.chunk({}, {}, 10);
  for (let i = 0; i < MAX_EVENTS + 5; i++) s.o.disposition(s.socket, s.session, 'no_pending_request');
  for (let i = 0; i < MAX_TRACES; i++) s.begin(`more-${i}`);
  assert.equal(s.o.getStatus().activeObservations, MAX_TRACES);
  const evicted = records(s.logs).find(r => r.kind === 'observation_finished');
  assert.equal(evicted.reason, 'trace_limit'); assert.equal(evicted.sessions.length, MAX_SESSIONS);
  assert(evicted.untrackedChunks > 0 && evicted.untrackedBytes > 0 && evicted.suppressedEvents > 0);
  assert(records(s.logs).filter(r => r.requestId === 'request-1').length <= MAX_EVENTS + 1);
  s.advance(240_000); s.o.sweep(); assert.equal(s.timers.size, 0);
});

test('backward clock changes close observation and logger failure does not block image acceptance', async () => {
  const s = observer(); s.begin(); s.advance(-1); s.o.sweep();
  assert.equal(records(s.logs).at(-1).reason, 'clock_changed'); assert.equal(s.timers.size, 0);
  const h = setup();
  h.api = createSnapshotController({ ...h.args, log: value => {
    if (value.startsWith('[photo-ingress]')) throw Error('private diagnostic failure');
    h.logs.push(value);
  } });
  const id = await h.api.request('owner', input);
  ingest(h, h.socket, h.session, frame());
  await until(() => h.auth(id).state === 'available');
  assert.equal(h.writes.length, 1); assert.equal(h.objects.size, 1);
  h.advance(241_000); await h.api.sweep();
});
