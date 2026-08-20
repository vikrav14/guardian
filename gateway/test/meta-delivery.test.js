'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMetaDeliveryStatus,
  summarizeMetaDelivery,
  recordMetaDeliveryStatus,
} = require('../src/meta-delivery');

function resultsWith(status = 'accepted') {
  return [{
    name: 'Husband',
    channels: {
      whatsapp: {
        ok: true,
        accepted: true,
        provider: 'meta',
        messageId: 'wamid.1',
        deliveryStatus: status,
      },
    },
  }];
}

test('delivery receipt upgrades matching Meta outcome without changing identity', () => {
  const occurredAt = new Date('2026-08-15T10:00:00.000Z');
  const applied = applyMetaDeliveryStatus(resultsWith(), {
    messageId: 'wamid.1',
    status: 'delivered',
    recipientId: '23058590100',
    occurredAt,
    errors: [],
  });

  assert.equal(applied.matched, true);
  const outcome = applied.results[0].channels.whatsapp;
  assert.equal(outcome.messageId, 'wamid.1');
  assert.equal(outcome.deliveryStatus, 'delivered');
  assert.equal(outcome.recipientId, '23058590100');
  assert.equal(outcome.deliveredAt, occurredAt);
  assert.equal(summarizeMetaDelivery(applied.results).status, 'delivered');
});

test('older delivery webhook cannot regress a newer read receipt', () => {
  const results = resultsWith('read');
  results[0].channels.whatsapp.deliveryUpdatedAt =
    new Date('2026-08-15T10:01:00.000Z');

  const applied = applyMetaDeliveryStatus(results, {
    messageId: 'wamid.1',
    status: 'sent',
    occurredAt: new Date('2026-08-15T10:00:00.000Z'),
    errors: [],
  });

  assert.equal(applied.results[0].channels.whatsapp.deliveryStatus, 'read');
});

test('persistence updates notification log, linked alert and reminder', async () => {
  const writes = [];
  const logData = {
    alertId: 'a1',
    results: resultsWith(),
  };
  const reminderData = {
    lastDelivery: {
      provider: 'meta',
      messageId: 'wamid.1',
      deliveryStatus: 'accepted',
    },
  };

  const db = {
    collection(name) {
      if (name === 'notificationLogs') {
        return {
          where() { return this; },
          async get() {
            return { docs: [{
              data: () => logData,
              ref: { async set(value) { writes.push({ name: 'log', value }); } },
            }] };
          },
        };
      }
      if (name === 'metaDeliveryEvents') {
        return {
          doc() {
            return { async set(value) { writes.push({ name: 'event', value }); } };
          },
        };
      }
      if (name === 'medicationReminders') {
        return {
          where() { return this; },
          async get() {
            return { docs: [{
              data: () => reminderData,
              ref: { async set(value) { writes.push({ name: 'reminder', value }); } },
            }] };
          },
        };
      }
      if (name === 'alerts') {
        return {
          doc() {
            return { async set(value) { writes.push({ name: 'alert', value }); } };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };

  const outcome = await recordMetaDeliveryStatus(db, {
    messageId: 'wamid.1',
    status: 'delivered',
    occurredAt: new Date('2026-08-15T10:00:00.000Z'),
    errors: [],
  });

  assert.equal(outcome.matchedLogs, 1);
  assert.equal(outcome.matchedReminders, 1);
  assert.equal(writes.find((write) => write.name === 'event').value.status, 'delivered');
  assert.equal(writes.find((write) => write.name === 'log').value.deliveryStatus, 'delivered');
  assert.equal(writes.find((write) => write.name === 'alert').value.notifyStatus, 'delivered');
  assert.equal(writes.find((write) => write.name === 'reminder').value.deliveryStatus, 'delivered');
});
