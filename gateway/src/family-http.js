'use strict';
const admin = require('firebase-admin');
const { FamilyError, fail } = require('./family-policy');
const { createFamilyStore } = require('./family-store');
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) fail('request_too_large', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request', 400);
    return value;
  } catch { fail('invalid_request', 400); }
}
function createFamilyHandler({ getDb, verifyToken = token => admin.auth().verifyIdToken(token, true),
  enabled = process.env.FAMILY_SHARING_ENABLED === 'true', storeFactory = createFamilyStore } = {}) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/app/family')) return false;
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private',
      'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
    const reply = (status, data) => { res.writeHead(status, headers); res.end(JSON.stringify(data)); };
    try {
      if (!enabled) fail('family_setup_pending', 503);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) fail('sign_in_required', 401);
      let identity;
      try { identity = await verifyToken(bearer[1]); } catch { fail('sign_in_required', 401); }
      const db = getDb(); if (!db) fail('gateway_unavailable', 503);
      const store = storeFactory(db), imei = url.searchParams.get('imei') || '';
      if (req.method === 'GET' && url.pathname === '/app/family') reply(200, await store.list(identity.uid));
      else if (req.method === 'POST') {
        const input = await body(req);
        let result;
        switch (url.pathname) {
          case '/app/family/invite': result = await store.invite(identity.uid, imei, input); break;
          case '/app/family/accept': result = await store.accept(identity, input.code); break;
          case '/app/family/member': result = await store.update(identity.uid, imei, input); break;
          case '/app/family/whatsapp': result = await store.whatsapp(identity.uid, imei, input); break;
          case '/app/family/link': result = await store.link(identity.uid); break;
          case '/app/family/settings': result = await store.settings(identity.uid, imei); break;
          case '/app/family/profile': result = await store.profile(identity.uid, imei, input); break;
          case '/app/family/respond': result = await require('./family-response').acknowledge(db, { uid: identity.uid, imei, alertId: input.alertId }); break;
          default: fail('not_found', 404);
        }
        reply(200, result || { ok: true });
      } else fail('method_not_allowed', 405);
    } catch (error) {
      reply(error instanceof FamilyError ? error.status : 503,
        { error: error instanceof FamilyError ? error.code : 'gateway_unavailable' });
    }
    return true;
  };
}
module.exports = { createFamilyHandler };
