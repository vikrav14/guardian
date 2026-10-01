'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createHomeWifiStore, createWifiDiscovery, setupBinding } = require('../../gateway/src/home-wifi-setup');
let app, db;
const imei = '359633100123456', uid = 'owner';
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Real transaction test requires the emulator');
  app = admin.initializeApp({ projectId: 'guardian-home-wifi-transaction' }, 'home-wifi-transaction');
  db = app.firestore();
});
after(async () => app?.delete());

test('real transactions serialize concurrent enrollment and retain removal after restart', async () => {
  await db.doc(`users/${uid}`).set({ linkedImeis: [imei] });
  await db.doc(`serviceSubscriptions/${uid}`).set({ version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' });
  await db.doc('geofences/home').set({ imei, name: 'Home', active: true, createdBy: uid,
    center: { lat: -20.1, lng: 57.1 }, radiusMeters: 150 });
  await db.doc(`devices/${imei}`).set({ homeWifiPresence: { old: true }, lastHomeWifiDetection: { old: true } });
  const access = { uid, imei };
  const binding = await setupBinding(db, access, 'home', Date.now());
  const discovery = createWifiDiscovery();
  const scope = { ...access, geofenceId: 'home', homeKey: binding.homeKey };
  discovery.open(scope);
  const clock = new Date();
  discovery.observe({ imei, type: 'location', location: { recordedAt: clock } }, clock,
    ['011026', '100000', 'V', '20.1', 'S', '57.1', 'E', '0', '0', '0', '0', '70', '80',
      '0', '0', '00000000', '0', '1', 'My Home', '02:00:00:00:00:01', '-60']);
  const payload = { candidateId: discovery.open(scope)[0].id, expectedVersion: 0,
    geofenceId: 'home', homeKey: binding.homeKey };
  const results = await Promise.allSettled([
    createHomeWifiStore(db).save(access, payload, discovery),
    createHomeWifiStore(db).save(access, payload, discovery),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /settings_changed/);
  assert.equal((await db.doc(`devices/${imei}`).get()).data().homeWifiPresence, null);
  const restored = await createHomeWifiStore(db).read(imei);
  assert.equal(restored.version, 1); assert.equal(restored.enabled, true);
  assert.ok(!JSON.stringify(restored).includes('02:00:00:00:00:01'));
  await createHomeWifiStore(db).save(access, { expectedVersion: 1 }, discovery, { remove: true });
  assert.deepEqual(await createHomeWifiStore(db).read(imei), {
    version: 2, enabled: false, ownerUid: uid,
    updatedAt: (await db.doc(`homeWifiEnrollments/${imei}`).get()).data().updatedAt,
  });
  assert.equal((await db.doc('geofences/home').get()).exists, true);
  await assert.rejects(createHomeWifiStore(db).save(access, payload, discovery), /settings_changed/);
});
