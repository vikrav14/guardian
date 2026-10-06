'use strict';
// Local-only review: real family handlers and Firebase emulator authorization.
// Intentionally does not import gateway startup, provider clients or schedulers.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { createFamilyHandler } = require('../src/family-http');
const { createFamilyStore } = require('../src/family-store');
const { provisionFamilyService } = require('../src/family-provision');
const { handleFamilyWhatsApp } = require('../src/family-whatsapp');
const PROJECT = 'demo-guardian-family';
const ACCOUNTS = ['vikesh', 'neelam', 'ravi'];
const IMEI = '999999999999991';

function assertIsolated(env = process.env) {
  if (env.GCLOUD_PROJECT !== PROJECT ||
      env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185' ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9195' ||
      env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9295') {
    throw new Error('Review server requires the fixed demo project and all three local emulators.');
  }
}

async function seed(db, auth) {
  for (const person of ACCOUNTS) {
    const uid = `review-${person}`, displayName = person[0].toUpperCase() + person.slice(1);
    const values = { email: `${person}@guardian.test`, displayName, emailVerified: true,
      password: 'Guardian-review-2026!' };
    try { await auth.getUser(uid); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; await auth.createUser({ uid, ...values }); }
    const ref = db.doc(`users/${uid}`);
    if (!(await ref.get()).exists) await ref.set({ displayName, email: values.email, linkedImeis: [],
      familyServiceImeis: [], subscription: { version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active' } });
  }
  for (const [imei, name, plan] of [[IMEI, 'Amira (sample)', 'family'], ['999999999999992', 'Marcel (sample)', 'care']]) {
    if ((await db.doc(`familyServices/${imei}`).get()).exists) continue;
    await db.doc(`devices/${imei}`).set({ name, nickname: name, relationship: plan === 'family' ? 'Child' : 'Parent',
      batteryPercent: 82, lastSeenAt: new Date(),
      lastSatelliteLocation: { lat: -20.2644, lng: 57.4791, recordedAt: new Date() } });
    await provisionFamilyService(db, { imei, ownerUid: 'review-vikesh', plan, contractId: `review-contract-${imei}` }, { apply: true });
    if (imei === IMEI) {
      const store = createFamilyStore(db);
      const invitation = await store.invite('review-vikesh', imei, { email: 'ravi@guardian.test', role: 'viewer' });
      await store.accept({ uid: 'review-ravi', email: 'ravi@guardian.test', email_verified: true, name: 'Ravi' }, invitation.code);
      await db.doc('alerts/review-sos').set({ imei, type: 'sos', resolved: false,
        createdAt: new Date(), triggeredAt: new Date(), message: 'Sample SOS for family response testing',
        notifyStatus: 'review_only', location: { lat: -20.2644, lng: 57.4791 } });
    }
  }
}

async function start() {
  assertIsolated();
  // Firebase Admin bypasses OAuth for these explicit emulator endpoints. Never
  // load a service-account file into this standalone review process.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  admin.initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
  const db = admin.firestore(), auth = admin.auth();
  await seed(db, auth);
  const family = createFamilyHandler({ getDb: () => db, enabled: true });
  const root = path.resolve(__dirname, '../../apps/mobile/build/family-review');
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Build the review web app first.');
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
    '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const handler = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:9080');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/review/health') return json(200, { project: PROJECT, isolated: true });
      if (url.pathname === '/review/whatsapp' && req.method === 'POST') {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
        const identity = await auth.verifyIdToken(token || '', true);
        const account = ACCOUNTS.findIndex(person => identity.uid === `review-${person}`);
        if (account < 0) return json(403, { error: 'review_account_required' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw new Error('Request too large'); }
        const text = JSON.parse(raw).text;
        if (typeof text !== 'string' || text.length > 500) return json(400, { error: 'invalid_text' });
        const replies = [];
        const handled = await handleFamilyWhatsApp({ db,
          message: { from: `1555555010${account}`, text, id: `review-${crypto.randomUUID()}` },
          send: async (_to, answer) => { replies.push(answer); return { ok: true }; } });
        return json(200, { simulated: true, handled, replies });
      }
      if (await family(req, res, url)) return;
      if (url.pathname.startsWith('/app/')) return json(503, { error: 'not_available_in_local_review' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'method_not_allowed' });
      const requested = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!requested.startsWith(root + path.sep) && requested !== root) return json(403, { error: 'invalid_path' });
      const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch (error) { if (!res.headersSent) json(400, { error: 'review_request_failed' }); else res.end(); }
  };
  for (const port of [9011, 9080]) http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`Review ready on http://127.0.0.1:${port}`));
}
if (require.main === module) start().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { assertIsolated };
