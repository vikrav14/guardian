const admin = require('firebase-admin');
const config = require('../config');

function isProduction() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getAdminApiKey() {
  return process.env.ADMIN_API_KEY || config.adminApiKey || '';
}

function looksLikeJwt(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

async function verifyFirebaseToken(idToken) {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin not initialized');
  }
  return admin.auth().verifyIdToken(idToken);
}

/**
 * Ops API auth:
 * - Firebase ID token with admin claim or allowlisted email
 * - X-Admin-Key / Bearer API key (dev fallback)
 * - production + no ADMIN_API_KEY and no Firebase → blocked (503)
 * - non-production → open when no key; require key when ADMIN_API_KEY is set
 */
async function checkAdminAuth(req) {
  const configuredKey = getAdminApiKey();
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerKey = req.headers['x-admin-key'];

  if (bearer && looksLikeJwt(bearer)) {
    try {
      const decoded = await verifyFirebaseToken(bearer);
      if (decoded.admin === true || isAdminEmail(decoded.email)) {
        return { ok: true, user: decoded, method: 'firebase' };
      }
      return { ok: false, status: 403, error: 'Admin access required' };
    } catch (err) {
      return { ok: false, status: 401, error: `Invalid Firebase token: ${err.message}` };
    }
  }

  if (isProduction() && !configuredKey && !admin.apps.length) {
    return {
      ok: false,
      status: 503,
      error: 'Ops endpoints disabled: set ADMIN_API_KEY or enable Firebase Admin',
    };
  }

  if (!configuredKey && !isProduction()) {
    return { ok: true, method: 'dev-open' };
  }

  const provided = headerKey || (bearer && !looksLikeJwt(bearer) ? bearer : '');

  if (!provided || provided !== configuredKey) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true, method: 'api-key' };
}

function isAdminEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return config.adminEmails.includes(normalized);
}

module.exports = {
  checkAdminAuth,
  isAdminEmail,
  isProduction,
  verifyFirebaseToken,
  looksLikeJwt,
};
