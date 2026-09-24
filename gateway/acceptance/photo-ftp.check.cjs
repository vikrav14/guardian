'use strict';
// Explicit acceptance test: Python is not a dependency of ordinary npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { readValidatedReceipt } = require('../scripts/photo-trial-firebase');

test('isolated FTP receiver: real transfers through distinct control/data proxies', { timeout: 30000 }, () => {
  const python = process.env.GUARDIAN_PHOTO_PYTHON;
  assert.ok(python, 'Set GUARDIAN_PHOTO_PYTHON to Python with photo-ftp-requirements.txt installed.');
  const result = spawnSync(python, [path.resolve(__dirname, '../scripts/check_photo_ftp.py')],
    { encoding: 'utf8', timeout: 25000, maxBuffer: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout.trim());
  assert.equal(evidence.event, 'ftp_self_test_passed');
  assert.ok(evidence.checks.length >= 9);
  assert.equal(evidence.watchCommandsSent, false);
  assert.equal(evidence.firebaseWrites, 0);
});

test('Firebase receipt reader fully decodes the JPEG and rejects changed bytes', () => {
  const python = process.env.GUARDIAN_PHOTO_PYTHON;
  assert.ok(python);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-receipt-check-'));
  try {
    const jpeg = require('../test/fixtures/photo-synthetic');
    fs.mkdirSync(path.join(root, 'incoming'));
    const fileName = '9705254749_20260924223000.JPG';
    const file = path.join(root, 'incoming', fileName), receiptPath = path.join(root, 'receipt.json');
    fs.writeFileSync(file, jpeg);
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, imei: '861397052547492', protocolId: '9705254749',
      source: 'ftp_trial', validation: 'pillow_full_decode', receivedAt: Date.now() / 1000, fileName,
      sha256: crypto.createHash('sha256').update(jpeg).digest('hex') }));
    const result = readValidatedReceipt(receiptPath, python);
    assert.equal(result.decoded.validation, 'pillow_full_decode');
    assert.equal(result.decoded.width, 32);
    assert.deepEqual(result.jpeg, jpeg);
    fs.writeFileSync(file, Buffer.from('not a photo'));
    assert.throws(() => readValidatedReceipt(receiptPath, python));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
