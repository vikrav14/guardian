'use strict';
const fs = require('node:fs'), path = require('node:path');
const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createFamilyStore } = require('../../gateway/src/family-store');
const { createAllowanceStore } = require('../../gateway/src/family-allowance');
const { POLICY_VERSION, permissions } = require('../../gateway/src/family-policy');
const { linkNumber, handleFamilyWhatsApp } = require('../../gateway/src/family-whatsapp');
const { managedContacts, claimSafetyDelivery } = require('../../gateway/src/family-notifications');
const { provisionFamilyService } = require('../../gateway/src/family-provision');
const { acknowledge } = require('../../gateway/src/family-response');
const projectId = 'guardian-family-sharing-test', imei = '999999999999991';
let env, app, db, store;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore(); store = createFamilyStore(db);
});
beforeEach(async () => {
  await env.clearFirestore();
  await db.doc(`familyServices/${imei}`).set({ ownerUid: 'owner', wearerName: 'Test wearer', policyVersion: POLICY_VERSION,
    subscription: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' },
    members: { owner: { name: 'Owner', email: 'owner@example.test', status: 'active', role: 'owner', permissions: {}, whatsapp: false } }, invites: {} });
  await db.doc('users/owner').set({ linkedImeis: [imei], familyServiceImeis: [imei] });
  for (const uid of ['member', 'other', 'attacker']) await db.doc(`users/${uid}`).set({ linkedImeis: [] });
  await db.doc(`devices/${imei}`).set({ nickname: 'Test wearer', stepsRaw: 100, batteryPercent: 82,
    lastSatelliteLocation: { lat: -20.2, lng: 57.5, recordedAt: new Date() } });
  await db.doc(`familyDeviceViews/${imei}`).set({ nickname: 'Test wearer', batteryPercent: 82 });
  await db.doc(`familyDeviceProfiles/${imei}`).set({ nickname: 'Test wearer', batteryPercent: 82 });
  await db.doc(`devices/${imei}/locations/today`).set({ lat: -20, lng: 57, recordedAt: new Date() });
  await db.doc('alerts/sos').set({ imei, type: 'sos', resolved: false });
});
after(async () => { await app?.delete(); await env?.cleanup(); });
const identity = uid => ({ uid, email: `${uid}@example.test`, email_verified: true, name: uid });
async function join(uid, extra = {}) {
  const invite = await store.invite('owner', imei, { email: `${uid}@example.test`, role: 'viewer', ...extra });
  await store.accept(identity(uid), invite.code); return invite;
}

test('managed profile changes atomically synchronize identity and cleared avatar without exposing telemetry', async () => {
  await store.profile('owner', imei, { nickname: 'Amira', avatarUrl: 'https://example.test/avatar.png' });
  for (const collection of ['devices', 'familyDeviceViews', 'familyDeviceProfiles']) {
    const row = (await db.doc(`${collection}/${imei}`).get()).data();
    assert.equal(row.nickname, 'Amira'); assert.equal(row.avatarUrl, 'https://example.test/avatar.png');
    if (collection !== 'devices') assert.equal(row.stepsRaw, undefined);
  }
  assert.equal((await db.doc(`familyServices/${imei}`).get()).data().wearerName, 'Amira');
  await store.profile('owner', imei, { avatarUrl: null });
  for (const collection of ['devices', 'familyDeviceViews', 'familyDeviceProfiles'])
    assert.equal((await db.doc(`${collection}/${imei}`).get()).data().avatarUrl, undefined);
  await join('member', { permissions: { settings: true } });
  await assert.rejects(store.profile('member', imei, { nickname: 'Forged' }), /owner_required/);
  const owner = env.authenticatedContext('owner').firestore();
  await assertFails(updateDoc(doc(owner, `devices/${imei}`), { nickname: 'Bypassed sync' }));
  await assertSucceeds(updateDoc(doc(owner, `devices/${imei}`), { simNumber: '+23057000000' }));
});

test('family response is authorized, idempotent, readable by alert members and independent of resolution/quota', async () => {
  await join('member', { role: 'alerts' });
  await Promise.all(Array.from({ length: 4 }, () => acknowledge(db, { uid: 'member', imei, alertId: 'sos' })));
  assert.equal((await db.collection('familyAcknowledgements').get()).size, 1);
  assert.equal((await db.collection('alerts/sos/responses').get()).size, 1);
  assert.equal((await db.doc('alerts/sos').get()).data().resolved, false);
  assert.equal((await db.collection(`familyServices/${imei}/usage`).get()).size, 0);
  const member = env.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(member, 'alerts/sos/responses/member')));
  await assertFails(setDoc(doc(member, 'alerts/sos/responses/owner'), { uid: 'owner' }));
  await assert.rejects(acknowledge(db, { uid: 'other', imei, alertId: 'sos' }), /access_not_shared/);
  await assert.rejects(acknowledge(db, { uid: 'owner', imei: '999999999999992', alertId: 'sos' }), /alert_unavailable/);
  await db.doc('alerts/sos').update({ resolved: true });
  await assert.rejects(acknowledge(db, { uid: 'owner', imei, alertId: 'sos' }), /alert_already_resolved/);
  await store.update('owner', imei, { action: 'revoke', uid: 'member' });
  await assertFails(getDoc(doc(member, 'alerts/sos/responses/member')));
  await assert.rejects(acknowledge(db, { uid: 'member', imei, alertId: 'sos' }), /access_not_shared/);
});

test('WhatsApp response rechecks the verified phone before recording a response', async () => {
  const link = await store.link('owner'); await linkNumber(db, link.code, '23057000000', Date.now());
  await assert.rejects(acknowledge(db, { uid: 'owner', imei, alertId: 'sos', source: 'whatsapp', phone: '+23057000001' }), /access_not_shared/);
  await acknowledge(db, { uid: 'owner', imei, alertId: 'sos', source: 'whatsapp', phone: '+23057000000' });
  assert.equal((await db.doc('alerts/sos/responses/owner').get()).data().source, 'whatsapp');
});
test('personal invitations require exact verified recipient, acceptance is one-use, owner immutable', async () => {
  const invitation = await store.invite('owner', imei, { email: 'member@example.test', role: 'caregiver' });
  await assert.rejects(store.accept(identity('other'), invitation.code), /invitation_not_available/);
  await assert.rejects(store.accept({ ...identity('member'), email_verified: false }, invitation.code), /verified_email_required/);
  await store.accept(identity('member'), invitation.code);
  await assert.rejects(store.accept(identity('member'), invitation.code), /invitation_expired_or_cancelled/);
  await assert.rejects(store.update('member', imei, { action: 'revoke', uid: 'owner' }), /owner_required/);
  await assert.rejects(store.update('owner', imei, { action: 'revoke', uid: 'owner' }), /owner_access_cannot_change/);
  assert.equal((await db.doc(`familyServices/${imei}`).get()).data().members.member.whatsappConsent, false);
});
test('pending invitations reserve slots and parallel acceptance cannot exceed capacity', async () => {
  const one = await store.invite('owner', imei, { email: 'member@example.test', role: 'viewer' });
  const two = await store.invite('owner', imei, { email: 'other@example.test', role: 'viewer' });
  await assert.rejects(store.invite('owner', imei, { email: 'attacker@example.test', role: 'viewer' }), /pending_invitations_fill_circle/);
  await Promise.all([store.accept(identity('member'), one.code), store.accept(identity('other'), two.code)]);
  await assert.rejects(store.invite('owner', imei, { email: 'attacker@example.test', role: 'viewer' }), /people_limit_reached/);
});
test('cancelled/expired invites cannot join and members cannot invite or change grants', async () => {
  const invitation = await store.invite('owner', imei, { email: 'member@example.test', role: 'alerts' });
  const pending = (await store.list('owner')).services[0].pending[0];
  await store.update('owner', imei, { action: 'cancelInvite', id: pending.id });
  await assert.rejects(store.accept(identity('member'), invitation.code), /invitation_expired_or_cancelled/);
  await join('member');
  await assert.rejects(store.invite('member', imei, { email: 'other@example.test', role: 'viewer' }), /owner_required/);
  const expired = await store.invite('owner', imei, { email: 'other@example.test', role: 'viewer' });
  const later = createFamilyStore(db, { now: () => Date.now() + 8 * 86400000 });
  await assert.rejects(later.accept(identity('other'), expired.code), /invitation_expired_or_cancelled/);
});
test('rules enforce granularity, block raw telemetry, self-issued links and grant writes; revocation is immediate', async () => {
  await join('member');
  const client = env.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(client, `familyDeviceViews/${imei}`)));
  await assertFails(getDoc(doc(client, `devices/${imei}`)));
  await assertFails(getDoc(doc(client, `devices/${imei}/locations/today`)));
  await assertSucceeds(getDoc(doc(client, 'alerts/sos')));
  await assertFails(updateDoc(doc(client, `devices/${imei}`), { nickname: 'Forged' }));
  await assertFails(updateDoc(doc(client, 'users/member'), { familyAccess: { [imei]: { owner: true } } }));
  await assertFails(setDoc(doc(client, `familyServices/${imei}`), { ownerUid: 'member' }));
  await assertFails(getDoc(doc(client, 'familyChannels/owner')));
  await store.update('owner', imei, { action: 'permissions', uid: 'member', role: 'viewer', permissions: { history: true } });
  await assertSucceeds(getDoc(doc(client, `devices/${imei}/locations/today`)));
  await store.update('owner', imei, { action: 'revoke', uid: 'member' });
  await assertFails(getDoc(doc(client, `familyDeviceViews/${imei}`)));
  await assertFails(getDoc(doc(client, 'alerts/sos')));
  const attacker = env.authenticatedContext('attacker').firestore();
  await updateDoc(doc(attacker, 'users/attacker'), { linkedImeis: [imei] });
  await assertFails(getDoc(doc(attacker, `familyDeviceViews/${imei}`)));
});
test('alerts-only cannot read location and explicit expiry is checked on every read', async () => {
  await join('member', { role: 'alerts', untilMs: Date.now() + 60000 });
  const client = env.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(client, 'alerts/sos')));
  await assertSucceeds(getDoc(doc(client, `familyDeviceProfiles/${imei}`)));
  await assertFails(getDoc(doc(client, `familyDeviceViews/${imei}`)));
  await db.doc(`familyServices/${imei}`).update({ 'members.member.untilMs': Date.now() - 86400000 });
  await assertFails(getDoc(doc(client, 'alerts/sos')));
  await assertFails(getDoc(doc(client, `familyDeviceProfiles/${imei}`)));
});
test('last answer is reserved once across parallel requests and duplicate webhooks, failed work refunds', async () => {
  const quota = createAllowanceStore(db);
  const month = require('../../gateway/src/family-policy').monthKey();
  await db.doc(`familyServices/${imei}/usage/${month}`).set({ used: 49, reserved: 0 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => quota.reserve({ uid: 'owner', imei, messageId: `m${i}` })));
  assert.equal(results.filter(r => r.allowed).length, 1);
  const id = `m${results.findIndex(r => r.allowed)}`;
  assert.equal((await quota.reserve({ uid: 'owner', imei, messageId: id })).reason, 'duplicate');
  await quota.transition(id, 'sending'); await quota.transition(id, 'sent'); await quota.transition(id, 'sent');
  assert.deepEqual((await db.doc(`familyServices/${imei}/usage/${month}`).get()).data(), { used: 50, reserved: 0 });
  const next = createAllowanceStore(db, { now: () => Date.now() + 32 * 86400000 });
  await next.reserve({ uid: 'owner', imei, messageId: 'later' });
  await next.transition('later', 'failed');
  const futureMonth = require('../../gateway/src/family-policy').monthKey(Date.now() + 32 * 86400000);
  assert.equal((await db.doc(`familyServices/${imei}/usage/${futureMonth}`).get()).data().used, 0);
});

test('delegated settings read only configuration, use the wearer plan and retain owner-only identity', async () => {
  await join('member', { role: 'alerts' });
  await assert.rejects(store.settings('member', imei), /access_not_shared/);
  await store.update('owner', imei, { action: 'permissions', uid: 'member', role: 'alerts', permissions: { settings: true } });
  await db.doc(`devices/${imei}`).update({ simNumber: '+23057000000', locationReportingMode: 'manual', manualReportingIntervalSeconds: 300 });
  const result = await store.settings('member', imei);
  assert.equal(result.settings.manualReportingIntervalSeconds, 300);
  for (const key of ['lastSatelliteLocation', 'location', 'simNumber', 'stepsRaw']) assert.equal(result.settings[key], undefined);
  const client = env.authenticatedContext('member').firestore();
  await assertSucceeds(updateDoc(doc(client, `devices/${imei}`), { watchAlertProfile: 'silent' }));
  await assertFails(updateDoc(doc(client, `devices/${imei}`), { simNumber: '+23057000009' }));
  await assertFails(updateDoc(doc(client, `devices/${imei}`), { careProfile: 'senior' }));
  await db.doc(`familyServices/${imei}`).update({ 'subscription.plan': 'care' });
  await assertSucceeds(updateDoc(doc(client, `devices/${imei}`), { careProfile: 'senior' }));
  await store.update('owner', imei, { action: 'revoke', uid: 'member' });
  await assert.rejects(store.settings('member', imei), /access_not_shared/);
});
test('verified number plus consent required, selected recipients capped, SOS independent of allowance', async () => {
  await join('member'); await join('other');
  await assert.rejects(store.whatsapp('owner', imei, { action: 'select', uid: 'member', enabled: true }), /recipient_must_link_and_consent/);
  for (const [i, uid] of ['owner', 'member', 'other'].entries()) {
    const code = await store.link(uid);
    await linkNumber(db, code.code, `2305700000${i}`, Date.now());
    await store.whatsapp(uid, imei, { action: 'consent', enabled: true });
  }
  await store.whatsapp('owner', imei, { action: 'select', uid: 'owner', enabled: true });
  await store.whatsapp('owner', imei, { action: 'select', uid: 'member', enabled: true });
  await assert.rejects(store.whatsapp('owner', imei, { action: 'select', uid: 'other', enabled: true }), /whatsapp_recipient_limit/);
  assert.equal((await managedContacts(db, imei)).length, 2);
  assert.equal(await claimSafetyDelivery(db, imei, 'sos', 'member', '+23057000001'), true);
  assert.equal(await claimSafetyDelivery(db, imei, 'sos', 'member', '+23057000001'), false);
  const relink = await store.link('member');
  await linkNumber(db, relink.code, '23057000009', Date.now());
  assert.equal(await claimSafetyDelivery(db, imei, 'next-sos', 'member', '+23057000001'), false);
  assert.equal(await claimSafetyDelivery(db, imei, 'next-sos', 'member', '+23057000009'), true);
  await store.whatsapp('member', imei, { action: 'consent', enabled: false });
  assert.equal((await managedContacts(db, imei)).length, 1);
});
test('WhatsApp uses current grant, replies once, keeps acknowledgements separate from resolution', async () => {
  await join('member');
  const link = await store.link('member'); await linkNumber(db, link.code, '23057000001', Date.now());
  const sent = [], send = async (to, text) => { sent.push(text); return { ok: true }; };
  const message = { from: '23057000001', text: 'battery', id: 'inbound' };
  await handleFamilyWhatsApp({ db, message, send }); await handleFamilyWhatsApp({ db, message, send });
  assert.equal(sent.length, 1); assert.match(sent[0], /82%/);
  await handleFamilyWhatsApp({ db, message: { ...message, text: 'ACK sos', id: 'ack' }, send });
  assert.equal((await db.doc('alerts/sos').get()).data().resolved, false);
  assert.equal((await db.collection('familyAcknowledgements').get()).size, 1);
  await store.update('owner', imei, { action: 'revoke', uid: 'member' });
  await handleFamilyWhatsApp({ db, message: { ...message, id: 'new' }, send });
  assert.equal(sent.filter(text => text.includes('82%')).length, 1);
});
test('ambiguous WhatsApp handoff is held for review and never automatically resent', async () => {
  const link = await store.link('owner'); await linkNumber(db, link.code, '23057000000', Date.now());
  let sends = 0;
  const args = { db, message: { from: '23057000000', text: 'battery', id: 'uncertain' },
    send: async () => { sends++; return { ok: false, reason: 'network_error' }; } };
  await handleFamilyWhatsApp(args); await handleFamilyWhatsApp(args);
  assert.equal(sends, 1);
  const usage = (await db.doc(`familyServices/${imei}/usage/${require('../../gateway/src/family-policy').monthKey()}`).get()).data();
  assert.deepEqual(usage, { used: 0, reserved: 1 });
});
test('admin provisioning is preview-first, keeps reviewed members and binds one contract to one watch', async () => {
  const second = '999999999999992', third = '999999999999993';
  await db.doc(`devices/${second}`).set({ nickname: 'Second wearer' });
  await db.doc(`devices/${third}`).set({ nickname: 'Third wearer' });
  await db.doc('users/other').update({ linkedImeis: [second] });
  const manifest = { imei: second, ownerUid: 'owner', plan: 'care', contractId: 'synthetic-contract-2' };
  await assert.rejects(provisionFamilyService(db, manifest), /review_all_existing_members/);
  manifest.verifiedMemberUids = ['other'];
  assert.equal((await provisionFamilyService(db, manifest)).applied, false);
  assert.equal((await db.doc(`familyServices/${second}`).get()).exists, false);
  await db.doc('users/other').update({ emergencyContacts: [{ phone: '+23057000000' }] });
  await assert.rejects(provisionFamilyService(db, manifest, { apply: true }), /existing_notification_migration_required/);
  assert.equal((await db.doc(`familyServices/${second}`).get()).exists, false);
  await db.doc('users/other').update({ emergencyContacts: [] });
  assert.equal((await provisionFamilyService(db, manifest, { apply: true })).people, 2);
  await assert.rejects(provisionFamilyService(db, { ...manifest, imei: third }, { apply: true }), /service_or_contract_already_exists/);
  assert.equal((await db.doc(`familyServices/${imei}`).get()).data().subscription.plan, 'family');
});
