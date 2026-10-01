'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { storageFailureDetails, storageRuntimeDetails } = require('../src/safety-snapshot-storage-diagnostics');

test('storage diagnostics distinguish provider, transport and checksum failures without private text', () => {
  const error = Object.assign(new Error('secret object path and credential'), {
    name: 'ApiError', code: 403,
    errors: [{ reason: 'forbidden', message: 'secret provider response' }],
    response: { statusCode: 403, body: 'secret body', headers: { authorization: 'secret token' } },
  });
  assert.deepEqual(storageFailureDetails(error), {
    statusCode: 403, code: null, reason: 'forbidden', name: 'ApiError',
  });
  assert.deepEqual(storageFailureDetails({ response: { status: 503 }, errors: [{ reason: 'backendError' }] }), {
    statusCode: 503, code: null, reason: 'backendError', name: null,
  });
  assert.equal(storageFailureDetails({ cause: { code: 'ECONNRESET' } }).code, 'ECONNRESET');
  for (const code of ['FILE_NO_UPLOAD', 'FILE_NO_UPLOAD_DELETE', 'ETIMEDOUT']) {
    assert.equal(storageFailureDetails({ code }).code, code);
  }
  assert.equal(storageFailureDetails({ code: '404' }).statusCode, 404);
  assert.equal(JSON.stringify(storageFailureDetails(error)).includes('secret'), false);
});

test('unrecognized error fields stay redacted and sanitized stored diagnostics can be inspected again', () => {
  const empty = { statusCode: null, code: null, reason: null, name: null };
  for (const error of [null, undefined, 'secret', { code: 'secret', reason: 'secret', name: 'secret' },
    { statusCode: 999 }, { statusCode: true }, { statusCode: '403 secret' }]) {
    assert.deepEqual(storageFailureDetails(error), empty);
  }
  const stored = { statusCode: 412, code: null, reason: 'conditionNotMet', name: 'ApiError' };
  assert.deepEqual(storageFailureDetails({ ...stored, message: 'secret', privateExtra: 'secret' }), stored);
});

test('startup diagnostics identify the actual bucket and emulator without exposing the environment', () => {
  assert.deepEqual(storageRuntimeDetails({ bucketName: 'example-project.firebasestorage.app',
    projectId: 'example-project', emulatorEnabled: false, credential: 'secret' }), {
    bucket: 'example-project.firebasestorage.app', projectId: 'example-project',
    standardProjectBucket: true, emulatorEnabled: false,
  });
  assert.equal(storageRuntimeDetails({ bucketName: 'custom-private-bucket',
    projectId: 'example-project', emulatorEnabled: true }).standardProjectBucket, false);
  assert.deepEqual(storageRuntimeDetails({ bucketName: 'https://secret', projectId: 'secret@example.com' }), {
    bucket: null, projectId: null, standardProjectBucket: null, emulatorEnabled: false,
  });
});
