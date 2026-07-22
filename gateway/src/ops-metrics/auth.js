const config = require('../config');

function isProduction() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getAdminApiKey() {
  return process.env.ADMIN_API_KEY || config.adminApiKey || '';
}

/**
 * Ops API auth:
 * - production + no ADMIN_API_KEY → blocked (503)
 * - production + key set → require X-Admin-Key or Authorization: Bearer
 * - non-production → open when no key; require key when ADMIN_API_KEY is set
 *
 * Future: Firebase ID token with custom claim admin:true, or email in ADMIN_EMAILS.
 */
function checkAdminAuth(req) {
  const configuredKey = getAdminApiKey();

  if (isProduction() && !configuredKey) {
    return {
      ok: false,
      status: 503,
      error: 'Ops endpoints disabled: set ADMIN_API_KEY in production',
    };
  }

  if (!configuredKey && !isProduction()) {
    return { ok: true };
  }

  const headerKey = req.headers['x-admin-key'];
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const provided = headerKey || bearer;

  if (!provided || provided !== configuredKey) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
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
};
