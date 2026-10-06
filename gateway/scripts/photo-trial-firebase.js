'use strict';

// Operator-only pilot import, never loaded by gateway startup. A received
// image is not proof that a particular remote command triggered the camera.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

function safeId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\x00-\x1f]/.test(value); }

function readValidatedReceipt(receiptPath, python) {
  if (!path.isAbsolute(receiptPath) || fs.lstatSync(receiptPath).isSymbolicLink() || fs.statSync(receiptPath).size > 8192) throw new Error('invalid_receipt');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.version !== 1 || !/^\d{15}$/.test(receipt.imei) || !/^\d{10}$/.test(receipt.protocolId) ||
      receipt.source !== 'ftp_trial' || receipt.validation !== 'pillow_full_decode' ||
      !Number.isFinite(receipt.receivedAt) || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '') ||
      !new RegExp(`^(?:${receipt.imei}|${receipt.protocolId})_\\d{14}\\.jpg$`, 'i').test(receipt.fileName || '')) throw new Error('invalid_receipt');
  const file = path.join(path.dirname(receiptPath), 'incoming', receipt.fileName);
  const decoded = JSON.parse(execFileSync(python, [path.join(__dirname, 'photo_ftp_receiver.py'), '--validate', file],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 8192 }));
  const jpeg = fs.readFileSync(file);
  if (jpeg.length > 512 * 1024 || decoded.sha256 !== receipt.sha256 || decoded.bytes !== jpeg.length ||
      crypto.createHash('sha256').update(jpeg).digest('hex') !== receipt.sha256) throw new Error('receipt_bytes_changed');
  return { receipt, jpeg, decoded };
}

async function linkedUser(db, imei, uid) {
  if (!/^\d{15}$/.test(imei)) throw new Error('invalid_imei');
  if (!uid) {
    const matches = await db.collection('users').where('linkedImeis', 'array-contains', imei).limit(2).get();
    if (matches.docs.length !== 1) throw new Error('provide_uid_for_exact_linked_user');
    uid = matches.docs[0].id;
  }
  if (!safeId(uid)) throw new Error('invalid_uid');
  const user = await db.collection('users').doc(uid).get();
  if (!user.exists || !Array.isArray(user.data().linkedImeis) || !user.data().linkedImeis.includes(imei)) throw new Error('device_not_linked');
  return uid;
}

async function inspectBucket(bucket) {
  const [metadata] = await bucket.getMetadata();
  const [policy] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
  if ((policy.bindings || []).some(binding => (binding.members || []).some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member)))) throw new Error('public_bucket_not_allowed_for_trial');
  return { uniform: metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled === true };
}

async function importPhoto({ db, bucket }, { receipt, jpeg, decoded, uid, consent, write = false }) {
  if (consent !== true) throw new Error('trial_consent_required');
  if (!receipt || !/^\d{10}$/.test(receipt.protocolId || '') ||
      !Number.isFinite(receipt.receivedAt) || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '') ||
      !Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg.length > 512 * 1024 ||
      crypto.createHash('sha256').update(jpeg).digest('hex') !== receipt.sha256 ||
      decoded?.validation !== 'pillow_full_decode' || decoded.sha256 !== receipt.sha256 ||
      decoded.bytes !== jpeg.length || ![decoded.width, decoded.height].every(n => Number.isInteger(n) && n > 0 && n <= 1024)) {
    throw new Error('validated_image_required');
  }
  uid = await linkedUser(db, receipt.imei, uid);
  const privacy = await inspectBucket(bucket);
  const id = crypto.createHash('sha256').update([receipt.imei, uid, receipt.sha256].join(':')).digest('hex');
  const objectPath = `privatePhotoTrials/${receipt.imei}/${id}.jpg`;
  if (!write) return { outcome: 'preview', importId: id, bucket: bucket.name, objectPath, bytes: jpeg.length,
    linkedUserVerified: true, firebaseWrites: 0, remoteCaptureVerified: false, customerVisible: false };
  const ref = db.collection('photoTrialImports').doc(id);
  const existing = await ref.get();
  if (existing.exists) return { outcome: 'already_recorded', importId: id, state: existing.data().state, firebaseWrites: 0 };
  const file = bucket.file(objectPath);
  let generation = null;
  await ref.create({ version: 1, imei: receipt.imei, protocolId: receipt.protocolId, requestedBy: uid,
    source: 'ftp_trial_operator_import', sha256: receipt.sha256, bytes: jpeg.length,
    width: decoded.width, height: decoded.height, validation: 'pillow_full_decode',
    state: 'uploading', objectPath, bucket: bucket.name, consentConfirmed: true,
    receivedAt: new Date(receipt.receivedAt * 1000), importedAt: new Date(),
    remoteCaptureVerified: false, requestCorrelationVerified: false, customerVisible: false,
    automaticExpiry: false, cleanupRequiredAfterTrial: true });
  try {
    await file.save(jpeg, { resumable: false, validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      ...(!privacy.uniform ? { predefinedAcl: 'private' } : {}),
      metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store',
        metadata: { guardianTrialId: id, guardianSha256: receipt.sha256 } } });
    const [metadata] = await file.getMetadata();
    generation = metadata.generation;
    if (!generation) throw new Error('generation_missing');
    await ref.update({ state: 'stored', generation, updatedAt: new Date() });
    return { outcome: 'photo_stored', importId: id, bytes: jpeg.length, customerVisible: false,
      remoteCaptureVerified: false, automaticExpiry: false, cleanupRequiredAfterTrial: true };
  } catch {
    let cleaned = false;
    if (generation) {
      try { await file.delete({ ifGenerationMatch: generation }); cleaned = true; } catch { /* keep cleanup evidence */ }
    }
    await ref.update({ state: cleaned ? 'failed_cleaned' : 'cleanup_required', generation,
      updatedAt: new Date() }).catch(() => {});
    throw new Error(cleaned ? 'import_failed_object_removed' : 'import_failed_cleanup_required');
  }
}

async function deletePhoto({ db, bucket }, { id, uid, write = false }) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('invalid_import_id');
  const ref = db.collection('photoTrialImports').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { outcome: 'not_found' };
  const row = snap.data();
  uid = await linkedUser(db, row.imei, uid);
  if (row.requestedBy !== uid || row.bucket !== bucket.name) throw new Error('import_owner_or_path_mismatch');
  if (row.state === 'deleted') return { outcome: 'already_deleted', importId: id };
  if (row.objectPath !== `privatePhotoTrials/${row.imei}/${id}.jpg`) throw new Error('import_owner_or_path_mismatch');
  if (!write) return { outcome: 'delete_preview', importId: id, firebaseWrites: 0 };
  const file = bucket.file(row.objectPath);
  try {
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.guardianTrialId !== id || metadata.metadata?.guardianSha256 !== row.sha256) throw new Error('object_identity_changed');
    if (!metadata.generation) throw new Error('generation_missing');
    await file.delete({ ifGenerationMatch: metadata.generation });
  } catch (error) { if (Number(error.code) !== 404) throw error; }
  await ref.update({ state: 'deleted', objectPath: null, deletedAt: new Date(), cleanupRequiredAfterTrial: false });
  return { outcome: 'photo_deleted', importId: id };
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--action', '--project-dir', '--receipt', '--python', '--uid', '--imei', '--bucket', '--import-id', '--write', '--consent'].includes(key) || key in result) throw new Error('invalid_arguments');
    result[key] = ['--write', '--consent'].includes(key) ? true : args[++i];
    if (result[key] == null || (typeof result[key] === 'string' && result[key].startsWith('--'))) throw new Error('invalid_arguments');
  }
  if (!['check', 'import', 'delete'].includes(result['--action']) || !path.isAbsolute(result['--project-dir'] || '')) throw new Error('invalid_arguments');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = args['--project-dir'];
  const requireProject = createRequire(path.join(directory, 'package.json'));
  requireProject('dotenv').config({ path: path.join(directory, '.env'), quiet: true });
  const admin = requireProject('firebase-admin');
  const project = process.env.FIREBASE_PROJECT_ID;
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!project || !credentials) throw new Error('firebase_environment_missing');
  const key = JSON.parse(fs.readFileSync(path.resolve(directory, credentials), 'utf8'));
  if (key.type !== 'service_account' || key.project_id !== project) throw new Error('firebase_project_mismatch');
  const bucketName = args['--bucket'] || `${project}.firebasestorage.app`;
  if (![`${project}.firebasestorage.app`, `${project}.appspot.com`].includes(bucketName)) throw new Error('bucket_project_mismatch');
  const app = admin.initializeApp({ credential: admin.credential.cert(key), projectId: project, storageBucket: bucketName }, 'photo-trial');
  const db = app.firestore(), bucket = app.storage().bucket();
  try {
    let result;
    if (args['--action'] === 'check') {
      await linkedUser(db, args['--imei'], args['--uid']);
      await inspectBucket(bucket);
      result = { outcome: 'firebase_read_check_passed', bucket: bucket.name, firebaseWrites: 0,
        uploadPermissionVerified: false, customerVisible: false };
    } else if (args['--action'] === 'import') {
      const input = readValidatedReceipt(args['--receipt'], args['--python'] || process.env.GUARDIAN_PHOTO_PYTHON || 'python');
      result = await importPhoto({ db, bucket }, { ...input, uid: args['--uid'], consent: args['--consent'] === true, write: args['--write'] === true });
    } else {
      result = await deletePhoto({ db, bucket }, { id: args['--import-id'], uid: args['--uid'], write: args['--write'] === true });
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.terminate(); await app.delete(); }
}

if (require.main === module) main().catch(error => {
  const safe = /^[a-z_]+$/.test(error.message || '') ? error.message : 'check_environment_permissions_and_arguments';
  console.error(JSON.stringify({ outcome: 'photo_trial_failed', reason: safe }));
  process.exitCode = 1;
});
module.exports = { readValidatedReceipt, linkedUser, inspectBucket, importPhoto, deletePhoto, parseArgs };
