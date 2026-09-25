'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRejectedPhotoCapture } = require('../src/safety-snapshot-rejected-frame');
const { MAX_FRAME_BYTES } = require('../src/protocol/v52-photo');

async function target(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-rejected-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'one.jsonl');
}
const evidence = { frame: Buffer.from('synthetic-private-frame'), requestId: 'synthetic-request',
  protocolId: '9705254749', at: '2026-09-25T13:15:00.000Z' };

test('diagnostic file is opt-in, exclusive, bounded and limited to one frame', async t => {
  assert.equal(createRejectedPhotoCapture(undefined), null);
  assert.throws(() => createRejectedPhotoCapture('relative.jsonl'), /absolute/);
  const file = await target(t), capture = createRejectedPhotoCapture(file);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.equal(await capture({ ...evidence, frame: Buffer.alloc(MAX_FRAME_BYTES + 1) }), 'frame_too_large');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const outcomes = await Promise.all([capture(evidence), capture(evidence)]);
  assert.deepEqual(outcomes, ['saved', 'already_used']);
  const row = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(row.requestId, evidence.requestId);
  assert.deepEqual(Buffer.from(row.frameHex, 'hex'), evidence.frame);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('restart or existing file never overwrites captured evidence', async t => {
  const file = await target(t);
  await fs.writeFile(file, 'keep-existing-evidence');
  assert.equal(await createRejectedPhotoCapture(file)(evidence), 'write_failed');
  assert.equal(await fs.readFile(file, 'utf8'), 'keep-existing-evidence');
});
