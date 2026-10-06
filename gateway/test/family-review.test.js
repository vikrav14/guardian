'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolated } = require('../scripts/family-review-server');
const isolated = { GCLOUD_PROJECT: 'demo-guardian-family', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9195', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9295' };
test('review server cannot start with production or incomplete emulator configuration', () => {
  assert.doesNotThrow(() => assertIsolated(isolated));
  for (const key of Object.keys(isolated)) {
    assert.throws(() => assertIsolated({ ...isolated, [key]: '' }), /fixed demo project/);
  }
  assert.throws(() => assertIsolated({ ...isolated, GCLOUD_PROJECT: 'guardian-fbadd' }));
  assert.throws(() => assertIsolated({ ...isolated, FIRESTORE_EMULATOR_HOST: 'cloud.example:8185' }));
});
