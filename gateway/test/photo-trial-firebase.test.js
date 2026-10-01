'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { importPhoto, deletePhoto, linkedUser, parseArgs } = require('../scripts/photo-trial-firebase');
const jpeg = require('./fixtures/photo-synthetic');
const imei = '861397052547492';

function input(overrides = {}) {
  return { uid: 'owner', consent: true, jpeg,
    receipt: { imei, protocolId: '9705254749', sha256: crypto.createHash('sha256').update(jpeg).digest('hex'), receivedAt: Date.now() / 1000 },
    decoded: { width: 32, height: 24, validation: 'pillow_full_decode', bytes: jpeg.length,
      sha256: crypto.createHash('sha256').update(jpeg).digest('hex') }, ...overrides };
}

function fake({ linked = true, uniform = true, publicBucket = false, failCommit = false, failMetadata = false } = {}) {
  const rows = new Map(), objects = new Map(), calls = [];
  const db = { collection(name) {
    return { where() { return { limit() { return { get: async () => ({ docs: [{ id: 'owner' }] }) }; } }; },
      doc(id) { return {
        get: async () => name === 'users' ? { exists: true, data: () => ({ linkedImeis: linked ? [imei] : [] }) }
          : { exists: rows.has(id), data: () => rows.get(id) },
        create: async value => { if (rows.has(id)) throw Error('already_exists'); rows.set(id, value); calls.push('create'); },
        update: async value => { if (failCommit && value.state === 'stored') throw Error('commit_failure'); rows.set(id, { ...rows.get(id), ...value }); calls.push('update'); },
      }; } };
  } };
  const bucket = { name: 'guardian-fbadd.firebasestorage.app',
    getMetadata: async () => [{ iamConfiguration: { uniformBucketLevelAccess: { enabled: uniform } } }],
    iam: { getPolicy: async () => [{ bindings: publicBucket ? [{ members: ['allUsers'] }] : [] }] },
    file(key) { return {
      save: async (bytes, opts) => { assert.equal(opts.preconditionOpts.ifGenerationMatch, 0); if (objects.has(key)) throw Error('exists'); objects.set(key, { bytes, opts }); calls.push('save'); },
      getMetadata: async () => { if (failMetadata) throw Error('metadata_failure'); const file = objects.get(key); if (!file) throw Object.assign(Error('missing'), { code: 404 }); return [{ generation: '17', metadata: file.opts.metadata.metadata }]; },
      delete: async opts => { assert.equal(opts.ifGenerationMatch, '17'); objects.delete(key); calls.push('delete'); },
    }; } };
  return { db, bucket, rows, objects, calls };
}

test('Firebase preview verifies linkage/privacy and makes no writes', async () => {
  const deps = fake();
  const result = await importPhoto(deps, input());
  assert.equal(result.outcome, 'preview'); assert.equal(result.remoteCaptureVerified, false);
  assert.deepEqual(deps.calls, []);
});

test('altered image or missing full-decoder evidence cannot reach cloud writes', async () => {
  for (const values of [input({ jpeg: Buffer.from('changed') }), input({ decoded: { width: 32, height: 24 } })]) {
    const deps = fake();
    await assert.rejects(importPhoto(deps, { ...values, write: true }), /validated_image_required/);
    assert.deepEqual(deps.calls, []);
  }
});

test('private import is immutable, does not issue a public URL, and deletion is explicit/idempotent', async () => {
  const deps = fake({ uniform: false });
  const result = await importPhoto(deps, input({ write: true }));
  assert.equal(result.outcome, 'photo_stored');
  const record = deps.rows.get(result.importId), object = [...deps.objects.values()][0];
  assert.equal(record.customerVisible, false); assert.equal(record.automaticExpiry, false);
  assert.equal(object.opts.predefinedAcl, 'private');
  assert.equal(object.opts.metadata.metadata.firebaseStorageDownloadTokens, undefined);
  assert.equal((await importPhoto(deps, input({ write: true }))).outcome, 'already_recorded');
  assert.equal(deps.calls.filter(x => x === 'save').length, 1);
  assert.equal((await deletePhoto(deps, { id: result.importId, uid: 'owner' })).outcome, 'delete_preview');
  assert.equal(deps.objects.size, 1);
  assert.equal((await deletePhoto(deps, { id: result.importId, uid: 'owner', write: true })).outcome, 'photo_deleted');
  assert.equal((await deletePhoto(deps, { id: result.importId, uid: 'owner', write: true })).outcome, 'already_deleted');
});

test('consent, device linkage and public-bucket failures precede any cloud writes', async () => {
  for (const [deps, values, reason] of [[fake(), input({ consent: false }), /consent/],
    [fake({ linked: false }), input(), /not_linked/], [fake({ publicBucket: true }), input(), /public_bucket/]]) {
    await assert.rejects(importPhoto(deps, { ...values, write: true }), reason);
    assert.deepEqual(deps.calls, []);
  }
});

test('Firestore completion failure removes only the just-written object generation', async () => {
  const deps = fake({ failCommit: true });
  await assert.rejects(importPhoto(deps, input({ write: true })), /object_removed/);
  assert.equal(deps.objects.size, 0);
  assert.equal([...deps.rows.values()][0].state, 'failed_cleaned');
});

test('uncertain storage completion retains a cleanup-required record, never a success', async () => {
  const deps = fake({ failMetadata: true });
  await assert.rejects(importPhoto(deps, input({ write: true })), /cleanup_required/);
  assert.equal([...deps.rows.values()][0].state, 'cleanup_required');
  assert.ok(!deps.calls.includes('delete'));
});

test('deletion refuses an object whose identity was replaced', async () => {
  const deps = fake();
  const result = await importPhoto(deps, input({ write: true }));
  [...deps.objects.values()][0].opts.metadata.metadata.guardianTrialId = 'another';
  await assert.rejects(deletePhoto(deps, { id: result.importId, uid: 'owner', write: true }), /identity_changed/);
  assert.equal(deps.objects.size, 1);
});

test('ambiguous linked users are not auto-selected; CLI has no watch-send action', async () => {
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [{ id: 'a' }, { id: 'b' }] }) }) }) }) };
  await assert.rejects(linkedUser(db, imei), /provide_uid/);
  assert.throws(() => parseArgs(['--action', 'send', '--project-dir', '/tmp']), /invalid_arguments/);
  assert.throws(() => parseArgs(['--action', 'check', '--project-dir', '/tmp', '--send']), /invalid_arguments/);
});
