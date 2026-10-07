'use strict';
// Static, loopback-only replay of synthetic qualification. No gateway imports,
// credentials, database access, provider calls or device/notification endpoints.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
function start(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.synthetic !== true || !report.complete || !Array.isArray(report.results)) throw Error('Completed synthetic qualification required');
  const root = path.resolve(__dirname, '../../apps/mobile/build/intelligence-review');
  if (!fs.existsSync(path.join(root, 'index.html'))) throw Error('Build the separate intelligence review entry point first');
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
    '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1:9084');
      if (url.pathname === '/qa-results.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.method === 'HEAD' ? '' : JSON.stringify(report)); return;
      }
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(400); res.end(); }
  });
  return server.listen(9084, '127.0.0.1', () => console.log('Synthetic Intelligence review: http://127.0.0.1:9084'));
}
if (require.main === module) {
  if (process.argv.length !== 3) throw Error('Use serve-intelligence-review.js REPORT_JSON');
  start(path.resolve(process.argv[2]));
}
module.exports = { start };
