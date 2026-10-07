'use strict';
const admin = require('firebase-admin');
const { IntelligenceError, fail } = require('./policy');
const { createIntelligenceService } = require('./service');
function createIntelligenceHandler({ getDb, enabled = process.env.GUARDIAN_INTELLIGENCE_ENABLED === 'true',
  verifyToken = token => admin.auth().verifyIdToken(token, true), factory = createIntelligenceService } = {}) {
  let service, database; const requests = new Map();
  return async (req, res, url) => {
    if (!['/app/intelligence', '/app/intelligence/ask'].includes(url.pathname)) return false;
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json',
      'Cache-Control': 'no-store, private', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (url.pathname.endsWith('/ask')) fail('ask_removed', 410);
      if (req.method !== 'GET') fail('method_not_allowed', 405);
      if ([...url.searchParams.keys()].some(key => !['imei', 'incidentId'].includes(key))) fail('invalid_request', 400);
      if (!enabled) fail('intelligence_unavailable', 503);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) fail('sign_in_required', 401);
      let identity; try { identity = await verifyToken(bearer[1]); } catch { fail('sign_in_required', 401); }
      const minute = Math.floor(Date.now() / 60000), key = `${identity.uid}:${minute}`;
      for (const [oldKey, value] of requests) if (value.minute < minute) requests.delete(oldKey);
      const count = requests.get(key)?.count || 0;
      if (count >= 20 || requests.size >= 5000) fail('please_wait', 429);
      requests.set(key, { minute, count: count + 1 });
      const db = getDb(); if (!db) fail('gateway_unavailable');
      if (database !== db) { database = db; service = factory({ db }); }
      let input;
      if (req.method === 'GET' && url.pathname === '/app/intelligence') input = { incidentId: url.searchParams.get('incidentId') || null };
      else fail('method_not_allowed', 405);
      reply(200, await service.answer({ uid: identity.uid, imei: url.searchParams.get('imei'), ...input }));
    } catch (error) { reply(error instanceof IntelligenceError ? error.status : 503,
      { error: error instanceof IntelligenceError ? error.code : 'intelligence_unavailable' }); }
    return true;
  };
}
module.exports = { createIntelligenceHandler };
