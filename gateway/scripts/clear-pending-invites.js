'use strict';

const { initFirestore, getDb } = require('../src/firestore');

async function main() {
  initFirestore();
  const db = getDb();

  if (!db) {
    throw new Error(
      'Firestore is not initialized. Run this with the same gateway environment you use for Guardian.',
    );
  }

  const snap = await db.collection('invites')
    .where('status', '==', 'pending')
    .get();

  if (snap.empty) {
    console.log('No pending invites found.');
    return;
  }

  console.log(`Found ${snap.size} pending invite(s):`);
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    console.log(
      `- ${doc.id} code=${data.code || '?'} createdBy=${data.createdBy || '?'} ` +
      `expiresAt=${data.expiresAt?.toDate?.()?.toISOString?.() || 'unknown'}`
    );
  }

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();

  console.log(`Deleted ${snap.size} pending invite(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
