'use strict';
const { HomeWifiError, authorizeHomeWifi, setupBinding, publicEnrollment,
  createHomeWifiStore } = require('./home-wifi-setup');

async function smallJson(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2048) throw new HomeWifiError('request_too_large', 413);
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new HomeWifiError('invalid_json', 400); }
}
function createHomeWifiHandler({ getDb, getRuntime,
  verifyToken = token => require('firebase-admin').auth().verifyIdToken(token, true),
  connected = imei => require('./sessions').findSocketsForDevice(imei).some(({ socket }) => !socket.destroyed),
  now = Date.now } = {}) {
  return async (req, res, url) => {
    if (url.pathname !== '/app/home-wifi') return false;
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, ngrok-skip-browser-warning',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { reply(204, null); return true; }
    try {
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw new HomeWifiError('method_not_allowed', 405);
      const bearer = /^Bearer (\S{1,8192})$/.exec(req.headers.authorization || '');
      if (!bearer) throw new HomeWifiError('sign_in_required', 401);
      let identity;
      try { identity = await verifyToken(bearer[1]); } catch { throw new HomeWifiError('sign_in_required', 401); }
      const db = getDb(); const runtime = getRuntime();
      if (!db || !runtime?.ready) throw new HomeWifiError('setup_unavailable', 503);
      const access = await authorizeHomeWifi({ db, uid: identity.uid, imei: url.searchParams.get('imei') });
      const store = createHomeWifiStore(db, { now });
      if (req.method !== 'GET') {
        const saved = await store.save(access, await smallJson(req), runtime.discovery, { remove: req.method === 'DELETE' });
        reply(200, { saved }); return true;
      }
      const saved = await store.read(access.imei);
      if (saved?.ownerUid && saved.ownerUid !== access.uid) throw new HomeWifiError('owner_required', 403);
      let binding; let homeProblem = null;
      try { binding = await setupBinding(db, access, url.searchParams.get('geofenceId'), now()); }
      catch (error) { if (!(error instanceof HomeWifiError)) throw error; homeProblem = error.code; }
      // Authorize again after reads; a revoked owner must not receive radio data.
      await authorizeHomeWifi({ db, ...access });
      const networks = binding ? runtime.discovery.open({ ...access,
        geofenceId: binding.anchor.geofenceId, homeKey: binding.homeKey }) : [];
      const status = runtime.status(access.imei);
      reply(200, { saved: publicEnrollment(saved), connected: connected(access.imei),
        home: binding?.anchor || null, homeKey: binding?.homeKey || null, homeProblem,
        networks, observedAt: saved?.enabled && status.version === saved.version
          ? status.publisher?.lastHomeDetection?.observedAt || null : null,
        detectedNow: saved?.enabled === true && status.version === saved.version &&
          status.publisher?.publishedHomeFresh === true,
        asOf: new Date(now()).toISOString() });
    } catch (error) {
      reply(error instanceof HomeWifiError ? error.status : 503,
        { error: error instanceof HomeWifiError ? error.code : 'setup_unavailable' });
    }
    return true;
  };
}
module.exports = { createHomeWifiHandler };
