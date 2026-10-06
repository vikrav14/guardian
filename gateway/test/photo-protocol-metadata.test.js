'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { frameMetadata } = require('../src/photo-protocol-metadata');
const { createPhotoIngressObserver } = require('../src/photo-ingress-observer');
const { createPhotoCommandObserver } = require('../src/photo-command-timeline');
const id = '1234567890', imei = '123456789012345';
function frame(body, prefix = '3G') {
  return Buffer.from(`[${prefix}*${id}*${Buffer.byteLength(body, 'latin1').toString(16).padStart(4, '0')}*${body}]`, 'latin1');
}

test('metadata separates heartbeat, location, alarm and bare capture reply without retaining payloads', () => {
  const pairs = [['LK,secret_steps,secret_rolls,81', 'heartbeat'], ['TKQ', 'heartbeat'],
    ['UD_LTE,private_location_radio_data', 'location'], ['AL_LTE,private_alarm_data', 'alarm'],
    ['rcapture', 'capture_reply'], ['rcapture,0', 'other'], ['secret_unknown,private', 'other']];
  for (const [body, kind] of pairs) {
    const result = frameMetadata(frame(body));
    assert.equal(result.kind, kind); assert.equal(result.lengthMatches, true);
    for (const secret of [id, 'secret', 'private']) assert(!JSON.stringify(result).includes(secret));
  }
  assert.equal(frameMetadata(Buffer.from('[3G*1234567890*0001*LK]')).lengthMatches, false);
  assert.equal(frameMetadata(frame('LK', 'ZZ')).prefix, 'other');
  assert.equal(frameMetadata(Buffer.from('malformed private bytes')).kind, 'unclassified');
});

test('photo timestamp is a validated unverified wall-clock label, never copied media or assumed UTC', () => {
  const r = frameMetadata(frame('img,5,261002174731,private_image_bytes'));
  assert.equal(r.deviceWallTimeUnverified, '2026-10-02T17:47:31');
  assert(!JSON.stringify(r).includes('private_image'));
  for (const stamp of ['261032174731', '261302174731', '261002244731', '261002176031', '260229174731']) {
    assert.equal(frameMetadata(frame(`img,5,${stamp},bytes`)).deviceWallTimeUnverified, undefined);
  }
});

test('long capture and late window retain bounded per-kind counters and exact first reply time', () => {
  let at = Date.parse('2026-10-02T12:00:00Z'); const logs = [];
  const socket = {}, session = { imei, protocolId: id };
  const o = createPhotoIngressObserver({now:()=>at,log:x=>logs.push(JSON.parse(x.slice(16))),schedule:()=>({}),cancel:()=>{}});
  o.begin({id:'request',imei,protocolId:id,socket,expiresAt:at+240000});
  at += 250;
  const ingest = bytes => {o.chunk(socket,session,bytes.length);o.frames(socket,session,{frames:[bytes],rest:Buffer.alloc(0)});};
  ingest(frame('rcapture'));
  for (let i = 0; i < 200; i++) ingest(frame('LK,secret,private,81'));
  at += 250000;
  ingest(frame('img,5,261002160410,private_image_bytes'));
  const reply=logs.find(r=>r.kind==='first_frame_kind' && r.frameKind==='capture_reply');
  assert.equal(reply.at,'2026-10-02T12:00:00.250Z');
  assert.equal(reply.prefix,'3G'); assert.equal(reply.lengthMatches,true);
  assert.equal(logs.filter(r=>r.kind==='first_frame_kind' && r.frameKind==='heartbeat').length,1);
  const photo = logs.find(r=>r.kind==='photo_header');
  assert.equal(photo.deviceWallTimeUnverified,'2026-10-02T16:04:10'); assert.equal(photo.afterCaptureExpiry,true);
  at += 110000; o.sweep();
  const end=logs.find(r=>r.kind==='observation_finished');
  assert.deepEqual(end.sessions[0].frameKinds,{capture_reply:1,heartbeat:200,photo:1});
  assert.equal(end.suppressedEvents,0); assert.equal(end.untrackedBytes,0);
  assert(logs.length<15); assert.equal(o.getStatus().activeObservations,0);
  for(const secret of [id,imei,'private_image_bytes','secret']) assert(!JSON.stringify(logs).includes(secret));
});

test('write trace records actual frame prefix and length validity without identity or argument leakage', () => {
  const o=createPhotoCommandObserver(), socket={}, session={imei,protocolId:id};
  const start=Date.parse('2026-10-02T12:00:00Z');
  o.noteWrite(socket,session,frame('LK','SG'),'protocol_ack',start-300);
  const trace=o.begin({socket,session,startedAt:new Date(start),expiresAt:new Date(start+240000)});
  o.noteWrite(socket,session,frame('rcapture'),'photo_capture',start+2);
  trace.stop('failed',start+10);
  const rows=trace.snapshot().events;
  assert.deepEqual(rows.map(r=>[r.command,r.prefix,r.lengthMatches]),[['LK','SG',true],['RCAPTURE','3G',true]]);
  assert(!JSON.stringify(rows).includes(id));
});
