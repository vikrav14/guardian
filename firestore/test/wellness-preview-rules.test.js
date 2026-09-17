'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy } = require('firebase/firestore');
const { wellnessDayStart } = require('../../gateway/src/wellness-access');
const { enablePreview } = require('../../gateway/scripts/manage-wellness-preview');
const imei = '359633100123456';
let env, today, created, expires;
before(async () => {
  created = new Date(); expires = new Date(+created + 3600_000); today = wellnessDayStart(created);
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-preview-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['pilot', 'other']) {
      await setDoc(doc(db, 'users', uid), { linkedImeis: [imei] });
      await setDoc(doc(db, 'serviceSubscriptions', uid), { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' });
    }
    await setDoc(doc(db, 'wellnessPilots', imei), { version: 1, managedBy: 'guardian_admin', viewerUid: 'pilot', enabled: true, createdAt: created, expiresAt: expires });
    await setDoc(doc(db, 'wellbeingConsents', imei), { version: 1, managedBy: 'guardian_admin', status: 'granted', wearerAcknowledgedAt: today });
    await setDoc(doc(db, 'devices', imei, 'wellbeingReadings', 'temperature'), {
      metricSet: 'skin_temperature', values: { skinTemperatureCelsius: 34.56 },
      displayable: false, privatePreviewOnly: true, observedAt: today,
      sourceCommand: 'btemp2', sourceVariant: '1',
    });
    for (const [kind, timeField] of [['activityDays','lastObservedAt'],['wellbeingReadings','observedAt']]) {
      for (const [id, offset] of [['today',0],['yesterday',-1],['too-old',-7]]) {
        await setDoc(doc(db,'devices',imei,kind,id), {displayable:false,[timeField]:new Date(+today+offset*86400_000)});
      }
    }
  });
});
after(async () => env?.cleanup());
const read = (uid, kind='activityDays', id='today') => getDoc(doc(env.authenticatedContext(uid).firestore(),'devices',imei,kind,id));
const patch = async (collectionName, id, values) => env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), collectionName, id), values));
test('only the explicitly granted viewer can query shadow data within the edition window', async () => {
  await assertSucceeds(read('pilot', 'wellbeingReadings', 'temperature'));
  await assertFails(read('other', 'wellbeingReadings', 'temperature'));
  await assertFails(updateDoc(doc(env.authenticatedContext('pilot').firestore(),
    'devices', imei, 'wellbeingReadings', 'temperature'), { displayable: true }));
  for (const [kind,timeField] of [['activityDays','lastObservedAt'],['wellbeingReadings','observedAt']]) {
    await assertSucceeds(read('pilot',kind));
    await assertSucceeds(read('pilot',kind,'yesterday'));
    await assertFails(read('pilot',kind,'too-old'));
    await assertFails(read('other',kind));
    const base=collection(env.authenticatedContext('pilot').firestore(),'devices',imei,kind);
    await assertSucceeds(getDocs(query(base,where(timeField,'>=',today),where(timeField,'<',new Date(+today+86400_000)),orderBy(timeField,'desc'))));
    await assertFails(getDocs(base));
  }
  await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(),'wellnessPilots',imei)));
  await assertFails(updateDoc(doc(env.authenticatedContext('pilot').firestore(),'wellnessPilots',imei),{expiresAt:new Date(+expires+86400_000)}));
  await assertFails(setDoc(doc(env.authenticatedContext('pilot').firestore(),'devices',imei,'activityDays','forged'),{displayable:true}));
});
test('expired, disabled, future and oversized grants cannot release private readings', async () => {
  for (const values of [{expiresAt:new Date(+created-1000)},{enabled:false},
    {createdAt:new Date(+created+60_000)}, {expiresAt:new Date(+created+2*86400_000)}]) {
    await patch('wellnessPilots',imei,{createdAt:created,expiresAt:expires,enabled:true,...values});
    await assertFails(read('pilot'));
    await assertFails(read('pilot','wellbeingReadings'));
    await assertFails(read('pilot','wellbeingReadings','temperature'));
  }
  await patch('wellnessPilots',imei,{createdAt:created,expiresAt:expires,enabled:true});
});
test('consent, membership, subscription and Essential calendar boundaries still apply', async () => {
  await patch('wellbeingConsents',imei,{status:'revoked'});
  await assertFails(read('pilot','wellbeingReadings'));
  await assertFails(read('pilot','wellbeingReadings','temperature'));
  await assertSucceeds(read('pilot'));
  await patch('wellbeingConsents',imei,{status:'granted'});
  await patch('users','pilot',{linkedImeis:[]});
  await assertFails(read('pilot'));
  await patch('users','pilot',{linkedImeis:[imei]});
  await patch('serviceSubscriptions','pilot',{plan:'essential'});
  await assertSucceeds(read('pilot'));
  await assertFails(read('pilot','activityDays','yesterday'));
  await assertFails(read('pilot','wellbeingReadings','yesterday'));
  await patch('serviceSubscriptions','pilot',{status:'cancelled',currentPeriodEnd:new Date(+created-1000)});
  await assertFails(read('pilot'));
});
test('admin preview creation changes only the grant, validates consent and membership', async () => {
  const writes=[];
  const records={
    'users/pilot':{linkedImeis:[imei]},
    'serviceSubscriptions/pilot':{version:1,managedBy:'guardian_admin',status:'active',plan:'family'},
    ['wellbeingConsents/'+imei]:{version:1,managedBy:'guardian_admin',status:'granted',wearerAcknowledgedAt:today},
  };
  const db={collection:name=>({doc:id=>({path:name+'/'+id})}),runTransaction:fn=>fn({
    get:async ref=>({exists:!!records[ref.path],data:()=>records[ref.path]}),set:(ref,data)=>writes.push([ref.path,data])})};
  const result=await enablePreview(db,imei,'pilot',created);
  require('node:assert/strict').equal(result.outcome,'preview_enabled');
  require('node:assert/strict').equal(writes[0][0],'wellnessPilots/'+imei);
  require('node:assert/strict').equal(+writes[0][1].expiresAt-+created,86400_000);
  records['wellbeingConsents/'+imei].status='revoked';
  await require('node:assert/strict').rejects(enablePreview(db,imei,'pilot',created),/consent/);
  require('node:assert/strict').equal(writes.length,1);
});
