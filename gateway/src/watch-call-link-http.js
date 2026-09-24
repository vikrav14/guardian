'use strict';

const { resolveWatchCallLink, bounded } = require('./watch-call-links');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function page(target) {
  const content = target
    ? `<h1>Call ${escapeHtml(target.name)}’s watch</h1>
       <p>Use your phone to call the watch.</p>
       <a class="call" href="tel:${escapeHtml(target.number)}">Call watch</a>
       <p class="number">${escapeHtml(target.number)}</p>
       <p>Your carrier’s call charges may apply. On a computer, dial this number from your phone.</p>
       <p>Opening this page does not enable handsfree answering. The watch follows its current call settings.</p>`
    : '<h1>Call link unavailable</h1><p>This link may have expired or the watch’s contact details may have changed.</p><p>Open Guardian or call the watch number you have saved.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guardian · Call watch</title>
    <style>body{font:18px/1.55 system-ui,sans-serif;background:#edf3ef;color:#14332a;margin:0;padding:24px}main{max-width:480px;margin:8vh auto;background:white;border-radius:24px;padding:28px}h1{font-size:28px;line-height:1.25}.call{display:block;background:#187c5d;color:white;text-align:center;padding:16px;border-radius:12px;text-decoration:none;font-weight:700}.number{text-align:center}p{color:#405c52}a:focus-visible{outline:3px solid #173b81;outline-offset:4px}</style></head><body><main>${content}</main></body></html>`;
}

async function handleWatchCallLink(req, res, { db, pathname, timeoutMs = 5000 }) {
  if (!pathname.startsWith('/call-watch/')) return false;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    res.writeHead(405); res.end(page(null)); return true;
  }
  // Previews/HEAD do not consume the link or trigger any action.
  if (req.method === 'HEAD') { res.writeHead(200); res.end(); return true; }
  let target = null;
  try { target = await bounded(resolveWatchCallLink(db, pathname.slice('/call-watch/'.length)), timeoutMs); }
  catch { /* Never log the URL, token or underlying provider error. */ }
  res.writeHead(target ? 200 : 410);
  res.end(page(target));
  return true;
}

module.exports = { handleWatchCallLink, page };
