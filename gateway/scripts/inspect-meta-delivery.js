'use strict';

const { initFirestore, getDb } = require('../src/firestore');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function asIso(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null;
}

async function main() {
  const messageId = String(argument('--message-id') || '').trim();
  if (!messageId) {
    throw new Error('Usage: node scripts/inspect-meta-delivery.js --message-id <wamid>');
  }

  initFirestore({ startWatchers: false });
  const snapshot = await getDb()
    .collection('metaDeliveryEvents')
    .where('messageId', '==', messageId)
    .get();
  const events = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .map((event) => ({
      id: event.id,
      status: event.status || null,
      occurredAt: asIso(event.occurredAt),
      errors: event.errors || [],
    }))
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));

  console.log(JSON.stringify({
    messageId,
    delivered: events.some((event) =>
      event.status === 'delivered' || event.status === 'read'
    ),
    events,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
