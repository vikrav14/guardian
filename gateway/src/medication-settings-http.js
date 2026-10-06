'use strict';
const admin = require('firebase-admin');
const { MedicationError, medicationRuntime, authorizeMedication, medicationRequest } = require('./medication-settings-policy');
const { createMedicationStore } = require('./medication-settings-store');
const { medicationTransport } = require('./medication-settings-transport');
const { validatePcm, encodeMedicationAudio, wav } = require('./medication-audio');
async function readMedicationJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 220000) throw new MedicationError('request_too_large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new MedicationError('invalid_json', 400); }
}
async function executeMedication({ access, request, store, transport,
  authorizeAgain, encode = encodeMedicationAudio, now = Date.now,
  wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const payload = medicationRequest(request);
  let encoded, pcm;
  if (payload.pcm != null) {
    try { pcm = validatePcm(Buffer.from(payload.pcm, 'base64')); encoded = await encode(pcm); }
    catch { throw new MedicationError('recording_processing_failed', 400); }
  }
  const claim = await store.claim({ access, request: payload, encoded, pcm });
  if (claim.replay) return claim.reminder;
  const value = claim.value;
  let attempted = false;
  try {
    // Bind once; a routine setting may wait for photography, but may not jump
    // to a replacement connection or survive an expired request/restart.
    const bound = transport.bind(access.imei, value);
    const until = Math.min(value.leaseUntilMs - 12000, now() + 25000);
    while (true) {
      await authorizeAgain();
      try { transport.ready(access.imei, value); break; }
      catch (error) {
        if (error.code !== 'camera_busy' || now() >= until) throw error;
        await wait(500);
      }
    }
    await store.update(value, 'sending'); // Durable ambiguity marker BEFORE write.
    await authorizeAgain();
    if (now() >= value.leaseUntilMs) throw new MedicationError('request_expired');
    // send() rechecks session, expiry and the shared coordinator synchronously.
    const pending = bound.send(claim.audio);
    attempted = true;
    const result = await pending;
    return await store.update(value, result.status, result.reason, result);
  } catch (error) {
    return store.update(value, attempted ? 'unconfirmed' : 'not_sent',
      error instanceof MedicationError ? error.code : 'gateway_interrupted');
  }
}
function createMedicationHandler({ getDb, runtime = medicationRuntime(), transport = medicationTransport,
  verifyToken = token => admin.auth().verifyIdToken(token, true), storeFactory = createMedicationStore } = {}) {
  const active = new Set();
  return async (req, res, url) => {
    if (!['/app/medication-reminders', '/app/medication-reminders/audio'].includes(url.pathname)) return false;
    const headers = { 'Cache-Control': 'no-store, private', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, ngrok-skip-browser-warning',
      'X-Content-Type-Options': 'nosniff' };
    const reply = (status, data) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let activeKey;
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new MedicationError('method_not_allowed', 405);
      if (!runtime.enabled || !transport.available) throw new MedicationError('feature_unavailable', 403);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) throw new MedicationError('sign_in_required', 401);
      let token;
      try { token = await verifyToken(bearer[1]); } catch { throw new MedicationError('sign_in_required', 401); }
      const db = getDb();
      if (!db) throw new MedicationError('gateway_unavailable', 503);
      const imei = url.searchParams.get('imei') || '';
      const authorizeAgain = () => authorizeMedication({ db, uid: token.uid, imei, runtime });
      const access = await authorizeAgain(), store = storeFactory(db);
      if (url.pathname.endsWith('/audio')) {
        if (req.method !== 'GET') throw new MedicationError('method_not_allowed', 405);
        const id = url.searchParams.get('id') || '';
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new MedicationError('invalid_request', 400);
        const asset = await store.audio({ ...access, id });
        const bytes = wav(validatePcm(Buffer.from(asset.pcm, 'base64')));
        res.writeHead(200, { ...headers, 'Content-Type': 'audio/wav', 'Content-Length': bytes.length }); res.end(bytes);
      } else if (req.method === 'GET') {
        reply(200, { reminders: await store.list(imei), connected: transport.connected(imei), maxSeconds: 10 });
      } else {
        if (active.has(imei)) throw new MedicationError('change_in_progress');
        activeKey = imei; active.add(imei);
        const request = await readMedicationJson(req);
        reply(200, { reminder: await executeMedication({ access, request, store, transport, authorizeAgain }) });
      }
    } catch (error) {
      reply(error instanceof MedicationError ? error.status : 503,
        { error: error instanceof MedicationError ? error.code : 'gateway_unavailable' });
    } finally { if (activeKey) active.delete(activeKey); }
    return true;
  };
}
module.exports = { createMedicationHandler, executeMedication, readMedicationJson };
