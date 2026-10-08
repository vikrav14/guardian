'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jpeg = require('jpeg-js');
const { setup, frame, receive, imei } = require('./helpers/photo-harness');
const { createIncidentPhotos } = require('../src/incident-photos');
const { createSnapshotController } = require('../src/safety-snapshot-live');
const { CONSENT_VERSION, CAPTURE_POLICY } = require('../src/incident-photo-policy');
async function ready() {
 const s=setup(); let followups=0;
 s.db.rows.set(`incidentPhotoSettings/${imei}`,{ownerUid:'owner',enabled:true,consentConfirmed:true,aiConsentConfirmed:true,consentVersion:CONSENT_VERSION});
 const eventAt=s.args.now();
 s.db.rows.set('alerts/alarm',{imei,type:'fall',eventAt,incidentPhotoEligible:true,incidentPhotoPending:true,notifyStatus:'accepted'});
 s.advance(1);s.session.lastPacketAt=+s.args.now();
 const options={db:s.db,snapshots:s.api,now:s.args.now,enabled:true,trialOnly:false,
  analyze:async()=>({status:'ready',visibleDetails:['A chair is visible.'],uncertainDetails:[],limitations:['Condition cannot be determined.']}),
  onComplete:async()=>{followups++;return {ok:true};}};
 const incidents=createIncidentPhotos(options);
 await incidents.enqueue('alarm');
 const incident=()=>s.db.rows.get('incidentPhotos/alarm');
 const packet=ms=>{s.advance(ms);s.session.lastPacketAt=+s.args.now();};
 const image=n=>frame({image:jpeg.encode({width:16,height:16,data:Buffer.alloc(1024,n*25)},50).data});
 const request=(uid='owner',requestKey=crypto.randomUUID())=>incidents.requestByGuardian(uid,'alarm',{requestKey});
 return {...s,incidents,options,incident,packet,image,request,eventAt,followups:()=>followups};
}
test('one automatic photo, then only explicit guardian requests, with AI after the initial follow-up',async()=>{
 const s=await ready();
 assert.equal(s.incident().capturePolicy,CAPTURE_POLICY);
 assert.equal(+s.incident().requestWindowEndsAt-+s.eventAt,3600000);
 await s.incidents.tick('alarm');const first=s.incident().requestIds[0];
 await receive(s,first,s.image(1));
 await s.incidents.sweep();await s.incidents.drain();
 assert.equal(s.followups(),1);assert.equal(s.auth(first).analysis.status,'ready');
 for(let n=0;n<3;n++){s.packet(60000);await s.incidents.sweep();await s.incidents.drain();}
 assert.equal(s.writes.length,1);
 for(let n=2;n<=7;n++){
  const id=await s.request('member');await receive(s,id,s.image(n));
  await s.incidents.sweep();await s.incidents.drain();
  assert.equal(s.auth(id).analysis.status,'ready');assert.equal(s.auth(id).captureSource,'guardian');
  s.packet(60000);
 }
 assert.equal(s.writes.length,7);assert.equal(s.followups(),1);
 const gallery=await s.incidents.gallery('member','alarm');
 assert.equal(gallery.photos.length,7);assert.equal(gallery.photoAccess.canRequest,true);
});

test('incident reading wait delays only the optional follow-up and still sends it once',async()=>{
 const s=await ready();let readingsReady=false;
 const incidents=createIncidentPhotos({...s.options,followupReady:async()=>readingsReady});
 await incidents.tick('alarm');const first=s.incident().requestIds[0];await receive(s,first);
 await incidents.sweep();await incidents.drain();
 assert.equal(s.db.rows.get('alerts/alarm').notifyStatus,'accepted');
 assert.equal(s.followups(),0);assert.equal(s.incident().followupState,'pending');
 readingsReady=true;
 await incidents.sweep();await incidents.drain();
 await incidents.sweep();await incidents.drain();
 assert.equal(s.followups(),1);
});
test('two guardians and duplicate HTTP intent cannot overlap or replay a capture',async()=>{
 const s=await ready();await s.incidents.tick('alarm');await receive(s,s.incident().requestIds[0]);
 await s.incidents.tick('alarm');s.packet(60000);
 const key=crypto.randomUUID();
 const attempts=await Promise.allSettled([s.request('owner',key),s.request('member')]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(s.writes.length,2);
 const id=await s.request('owner',key);assert.equal(id,attempts[0].value);assert.equal(s.writes.length,2);
 const restarted=createIncidentPhotos({...s.options,snapshots:createSnapshotController(s.args)});
 assert.equal(await restarted.requestByGuardian('owner','alarm',{requestKey:key}),id);
 await restarted.tick('alarm');assert.equal(s.writes.length,2);
});
test('automatic timeout leaves window open; waits out late-upload guard then permits a new explicit attempt',async()=>{
 const s=await ready();await s.incidents.tick('alarm');const id=s.incident().requestIds[0];
 s.packet(240001);await s.api.sweep();await s.incidents.tick('alarm');
 assert.equal(s.incident().state,'stopped');
 assert.equal((await s.incidents.current('member',imei)).reason,'incident_photo_settling');
 await assert.rejects(s.request(),/incident_photo_settling/);
 s.packet(120000);const next=await s.request();assert.notEqual(next,id);assert.equal(s.writes.length,2);
});
test('manual grant ends at original hour; expiry, access and consent are enforced on server',async()=>{
 for(const reason of ['expiry','member','consent','subscription','offline']){
  const s=await ready();await s.incidents.tick('alarm');await receive(s,s.incident().requestIds[0]);await s.incidents.tick('alarm');s.packet(60000);
  if(reason==='expiry')s.packet(3600000);
  if(reason==='member')s.db.rows.get('users/owner').memberUids=[];
  if(reason==='consent')s.db.rows.get(`incidentPhotoSettings/${imei}`).enabled=false;
  if(reason==='subscription')s.db.rows.get('serviceSubscriptions/owner').status='cancelled';
  if(reason==='offline')s.matches([]);
  await assert.rejects(s.request('member'));assert.equal(s.writes.length,1,reason);
 }
 const s=await ready();await s.incidents.tick('alarm');await receive(s,s.incident().requestIds[0]);await s.incidents.tick('alarm');
 s.packet(3600000-30001);const id=await s.request();
 assert.equal(+s.auth(id).authorizationExpiresAt,+s.incident().requestWindowEndsAt);
 s.packet(30000);s.api.observe(frame(),s.socket,s.session);await s.api.sweep();assert.notEqual(s.auth(id).state,'available');
 assert.equal(s.objects.size,1);
});
test('duplicate alarm does not renew the hour and fabricated/client SOS cannot unlock photos',async()=>{
 const s=await ready();const ends=+s.incident().requestWindowEndsAt;
 s.db.rows.set('alerts/duplicate',{...s.db.rows.get('alerts/alarm'),incidentPhotoPending:true,photoIncidentId:null});
 await s.incidents.enqueue('duplicate');assert.equal(+s.incident().requestWindowEndsAt,ends);
 s.db.rows.set('alerts/client',{imei,type:'sos',eventAt:s.args.now(),incidentPhotoPending:true});
 await s.incidents.enqueue('client');await assert.rejects(s.incidents.requestByGuardian('owner','client',{requestKey:crypto.randomUUID()}));
 assert.equal(s.writes.length,0);
});

test('initial Photos & AI follow-up does not wait for a guardian-requested image',async()=>{
 const s=await ready();await s.incidents.tick('alarm');await receive(s,s.incident().requestIds[0]);
 await s.incidents.tick('alarm');s.packet(60000);const extra=await s.request();
 await s.incidents.sweep();await s.incidents.drain();
 assert.equal(s.followups(),1);assert.equal(s.auth(extra).state,'waiting_for_image');
 assert.equal(s.incident().analysisPending,true);
});

test('rollout stops a legacy collecting incident without dispatching another automatic capture',async()=>{
 const s=await ready();delete s.incident().capturePolicy;
 await s.incidents.tick('alarm');assert.equal(s.writes.length,0);
 assert.equal(s.incident().reason,'policy_replaced');
 await assert.rejects(s.request(),/incident_not_active/);
});

test('pre-approval restart retains the approved legacy policy and cannot unlock the new request endpoint',async()=>{
 const s=await ready();
 s.db.rows.delete('incidentPhotos/alarm');s.db.rows.delete(`safetySnapshotDeviceLocks/${imei}`);
 s.db.rows.get('alerts/alarm').incidentPhotoPending=true;
 const legacy=createIncidentPhotos({...s.options,guardianWindowEnabled:false});
 await legacy.enqueue('alarm');assert.equal(s.incident().target,5);
 await legacy.tick('alarm');await receive(s,s.incident().requestIds[0]);s.packet(60000);
 await legacy.tick('alarm');assert.equal(s.writes.length,2);
 await assert.rejects(legacy.requestByGuardian('owner','alarm',{requestKey:crypto.randomUUID()}),/incident_not_active/);
});
