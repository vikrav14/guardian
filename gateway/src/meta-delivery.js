'use strict';

const crypto = require('crypto');

const DELIVERY_RANK = Object.freeze({
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  deleted: 4,
});

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldApplyStatus(outcome, event) {
  const previousAt = asDate(outcome.deliveryUpdatedAt);
  const nextAt = asDate(event.occurredAt);
  if (!previousAt || !nextAt) return true;
  if (nextAt.getTime() !== previousAt.getTime()) {
    return nextAt.getTime() > previousAt.getTime();
  }
  return (DELIVERY_RANK[event.status] ?? -1) >=
    (DELIVERY_RANK[outcome.deliveryStatus] ?? -1);
}

function applyMetaDeliveryStatus(results, event) {
  let matched = false;
  const occurredAt = asDate(event.occurredAt) || new Date();

  const updatedResults = (Array.isArray(results) ? results : []).map((result) => {
    const channels = { ...(result.channels || {}) };
    const whatsapp = channels.whatsapp;
    if (!whatsapp || whatsapp.messageId !== event.messageId) {
      return result;
    }

    matched = true;
    if (!shouldApplyStatus(whatsapp, event)) return result;

    const updated = {
      ...whatsapp,
      provider: 'meta',
      deliveryStatus: event.status,
      deliveryUpdatedAt: occurredAt,
      recipientId: event.recipientId || whatsapp.recipientId || null,
      deliveryErrors: event.errors || [],
    };

    if (event.status === 'sent') updated.sentAt = occurredAt;
    if (event.status === 'delivered') updated.deliveredAt = occurredAt;
    if (event.status === 'read') {
      updated.readAt = occurredAt;
      updated.deliveredAt = updated.deliveredAt || occurredAt;
    }
    if (event.status === 'failed' || event.status === 'deleted') {
      updated.failedAt = occurredAt;
    }

    channels.whatsapp = updated;
    return { ...result, channels };
  });

  return { matched, results: updatedResults };
}

function summarizeMetaDelivery(results) {
  const outcomes = [];
  for (const result of Array.isArray(results) ? results : []) {
    const whatsapp = result.channels?.whatsapp;
    if (!whatsapp || whatsapp.provider !== 'meta') {
      continue;
    }
    outcomes.push(whatsapp);
  }

  const total = outcomes.length;
  const delivered = outcomes.filter((outcome) =>
    outcome.deliveryStatus === 'delivered' || outcome.deliveryStatus === 'read'
  ).length;
  const failed = outcomes.filter((outcome) =>
    outcome.deliveryStatus === 'failed' || outcome.deliveryStatus === 'deleted'
  ).length;
  const accepted = outcomes.filter((outcome) =>
    outcome.accepted === true || outcome.ok === true
  ).length;

  let status = 'not_requested';
  if (total > 0 && delivered === total) status = 'delivered';
  else if (delivered > 0) status = 'partial';
  else if (total > 0 && failed === total) status = 'failed';
  else if (accepted > 0) status = 'accepted';
  else if (total > 0) status = 'failed';

  return { status, total, accepted, delivered, failed };
}

async function recordMetaDeliveryStatus(db, event) {
  if (!db || !event?.messageId) return { matchedLogs: 0 };

  const occurredAt = asDate(event.occurredAt) || new Date();
  const eventId = crypto
    .createHash('sha256')
    .update(`${event.messageId}|${event.status}|${occurredAt.toISOString()}`)
    .digest('hex');
  await db.collection('metaDeliveryEvents').doc(eventId).set({
    messageId: event.messageId,
    status: event.status,
    recipientId: event.recipientId || null,
    phoneNumberId: event.phoneNumberId || null,
    occurredAt,
    errors: event.errors || [],
    conversationId: event.conversationId || null,
    conversationCategory: event.conversationCategory || null,
    billable: event.billable ?? null,
  }, { merge: false });

  const snapshot = await db
    .collection('notificationLogs')
    .where('metaMessageIds', 'array-contains', event.messageId)
    .get();

  let matchedLogs = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const applied = applyMetaDeliveryStatus(data.results, event);
    if (!applied.matched) continue;

    matchedLogs += 1;
    const summary = summarizeMetaDelivery(applied.results);
    await doc.ref.set({
      results: applied.results,
      deliveryStatus: summary.status,
      deliverySummary: summary,
      deliveryUpdatedAt: asDate(event.occurredAt) || new Date(),
    }, { merge: true });

    if (data.alertId) {
      const notifyStatus = summary.status === 'delivered'
        ? 'delivered'
        : summary.status === 'failed'
          ? 'failed'
          : summary.status;
      await db.collection('alerts').doc(data.alertId).set({
        notifyStatus,
        notifyDeliveryUpdatedAt: asDate(event.occurredAt) || new Date(),
      }, { merge: true });
    }
  }

  const reminders = await db
    .collection('medicationReminders')
    .where('lastDelivery.messageId', '==', event.messageId)
    .get();
  for (const doc of reminders.docs) {
    const data = doc.data() || {};
    const previous = data.lastDelivery || {};
    if (!shouldApplyStatus(previous, event)) continue;
    const occurredAt = asDate(event.occurredAt) || new Date();
    await doc.ref.set({
      deliveryStatus: event.status,
      lastDelivery: {
        ...previous,
        deliveryStatus: event.status,
        deliveryUpdatedAt: occurredAt,
        deliveryErrors: event.errors || [],
      },
      lastDeliveryError:
        event.status === 'failed' || event.status === 'deleted'
          ? event.errors?.[0]?.message || event.status
          : null,
      updatedAt: occurredAt,
    }, { merge: true });
  }

  return { eventId, matchedLogs, matchedReminders: reminders.docs.length };
}

module.exports = {
  DELIVERY_RANK,
  applyMetaDeliveryStatus,
  summarizeMetaDelivery,
  recordMetaDeliveryStatus,
};
