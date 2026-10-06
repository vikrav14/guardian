const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyWebBuild } = require('./verify-guardian-web-build.cjs');

test('hosting stops when the Maps config is missing or replaced by fallback HTML', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-web-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['index.html', 'main.dart.js', 'flutter_bootstrap.js', 'firebase-messaging-sw.js']) {
    fs.writeFileSync(path.join(root, name), 'fixture');
  }
  assert.throws(() => verifyWebBuild(root), /maps_key.js is missing/);
  fs.writeFileSync(path.join(root, 'maps_key.js'), '<!DOCTYPE html><html>Guardian</html>');
  assert.throws(() => verifyWebBuild(root), /Maps configuration is invalid/);
  fs.writeFileSync(path.join(root, 'maps_key.js'), `window.GOOGLE_MAPS_API_KEY = 'AIza${'A'.repeat(35)}';`);
  assert.doesNotThrow(() => verifyWebBuild(root));
});
