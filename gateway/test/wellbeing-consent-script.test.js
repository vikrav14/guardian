'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildConsentPatch,
  deleteDeviceReadings,
} = require('../scripts/manage-wellbeing-consent');

test('consent script records explicit grant and revocation authority', () => {
  const now = new Date('2026-08-23T14:00:00.000Z');
  const granted = buildConsentPatch({
    operation: 'grant', recordedBy: 'admin@example.test', now,
  });
  assert.equal(granted.status, 'granted');
  assert.equal(granted.managedBy, 'guardian_admin');
  assert.equal(granted.wearerAcknowledgedAt, now);

  const revoked = buildConsentPatch({
    operation: 'revoke', recordedBy: 'admin@example.test', now,
  });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedAt, now);
});

test('revocation helper deletes every retained reading in bounded batches', async () => {
  const remaining = [
    { id: 'a', ref: { id: 'a' } },
    { id: 'b', ref: { id: 'b' } },
  ];
  const db = {
    collection(name) {
      assert.equal(name, 'devices');
      return {
        doc() {
          return {
            collection(name) {
              assert.equal(name, 'wellbeingReadings');
              return {
                limit() {
                  return {
                    async get() {
                      return {
                        empty: remaining.length === 0,
                        size: remaining.length,
                        docs: [...remaining],
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    batch() {
      const deleted = [];
      return {
        delete(ref) { deleted.push(ref.id); },
        async commit() {
          for (const id of deleted) {
            const index = remaining.findIndex((doc) => doc.id === id);
            if (index >= 0) remaining.splice(index, 1);
          }
        },
      };
    },
  };

  assert.equal(await deleteDeviceReadings(db, '000000000000001'), 2);
  assert.deepEqual(remaining, []);
});
