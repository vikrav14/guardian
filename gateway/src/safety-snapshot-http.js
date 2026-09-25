'use strict';
const { getIncidentPhotos } = require('./incident-photos-live');
const { getSnapshotController } = require('./safety-snapshot-live');

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw Object.assign(new Error('body_too_large'), { status: 413, code: 'body_too_large' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400, code: 'invalid_json' }); }
}

function createSnapshotHttpHandler({ controller = getSnapshotController, incidents = getIncidentPhotos, verifyToken = token => require('firebase-admin').auth().verifyIdToken(token, true) } = {}) {
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/safety-snapshots') && !url.pathname.startsWith('/api/incident-photos/')) return false;
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, ngrok-skip-browser-warning',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const json = (code, data) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return true; }
    try {
      const bearer = /^Bearer (\S{1,8192})$/.exec(req.headers.authorization || '');
      if (!bearer) { json(401, { error: 'sign_in_required' }); return true; }
      let identity;
      try { identity = await verifyToken(bearer[1]); }
      catch { json(401, { error: 'sign_in_required' }); return true; }
      const api = controller();
      if (!api) { json(503, { error: 'camera_unavailable' }); return true; }
      const incidentMatch = /^\/api\/incident-photos\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
      if (incidentMatch && req.method === 'GET') {
        const service = incidents();
        if (!service) json(503, { error: 'camera_unavailable' });
        else json(200, await service.gallery(identity.uid, incidentMatch[1]));
        return true;
      }
      const match = /^\/api\/safety-snapshots\/([a-f0-9-]{36})(\/image)?$/.exec(url.pathname);
      if (url.pathname === '/api/safety-snapshots' && req.method === 'GET') {
        json(200, await api.list(identity.uid, String(url.searchParams.get('imei') || '')));
      } else if (url.pathname === '/api/safety-snapshots' && req.method === 'POST') {
        const id = await api.request(identity.uid, await readJson(req));
        json(202, { requestId: id });
      } else if (match && match[2] && req.method === 'GET') {
        const bytes = await api.image(identity.uid, match[1]);
        res.writeHead(200, { ...headers, 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length }); res.end(bytes);
      } else if (match && !match[2] && req.method === 'DELETE') {
        await api.remove(identity.uid, match[1]); json(200, { deleted: true });
      } else json(404, { error: 'not_found' });
    } catch (error) {
      json(error.status || 500, { error: error.code || 'photo_service_error', ...(error.retryAt ? { retryAt: error.retryAt } : {}) });
    }
    return true;
  };
}
module.exports = { createSnapshotHttpHandler };
