#!/usr/bin/env node

const { initFirestore, getDb } = require('../src/firestore');
const { PLAN } = require('../src/entitlements');

function valueAfter(flag, args) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/set-service-subscription.js --uid <firebase-uid> --plan <essential|family|care> --status <active|trialing|grace_period|past_due|cancelled> [--until <ISO>] --confirm');
  console.log('');
  console.log('Without --confirm this command performs a read-only preview.');
}

function subscriptionPatch({ plan, status, until }) {
  const patch = {
    version: 1,
    managedBy: 'guardian_admin',
    plan,
    status,
    updatedAt: new Date(),
  };
  if (until) {
    if (status === 'trialing') patch.trialEndsAt = until;
    else if (status === 'grace_period' || status === 'past_due') patch.graceEndsAt = until;
    else patch.currentPeriodEnd = until;
  }
  return patch;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) return usage();
  const uid = String(valueAfter('--uid', args) || '').trim();
  const plan = String(valueAfter('--plan', args) || '').trim().toLowerCase();
  const status = String(valueAfter('--status', args) || 'active').trim().toLowerCase();
  const untilRaw = valueAfter('--until', args);
  const confirmed = args.includes('--confirm');

  if (!uid || !Object.values(PLAN).includes(plan)) {
    usage();
    throw new Error('A Firebase UID and canonical plan are required.');
  }
  if (!['active', 'trialing', 'grace_period', 'past_due', 'cancelled'].includes(status)) {
    throw new Error(`Unsupported subscription status: ${status}`);
  }
  const until = untilRaw ? new Date(untilRaw) : null;
  if (untilRaw && !Number.isFinite(until.getTime())) throw new Error('Invalid --until timestamp.');
  if (['trialing', 'grace_period', 'past_due', 'cancelled'].includes(status) && !until) {
    throw new Error(`${status} requires --until so access has an explicit boundary.`);
  }

  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new Error(`User does not exist: ${uid}`);

  const patch = subscriptionPatch({ plan, status, until });
  console.log(JSON.stringify({ uid, ...patch, updatedAt: patch.updatedAt.toISOString() }, null, 2));
  if (!confirmed) {
    console.log('PREVIEW ONLY: rerun with --confirm to write serviceSubscriptions.');
    return;
  }

  await db.collection('serviceSubscriptions').doc(uid).set(patch, { merge: true });
  await db.collection('users').doc(uid).set({
    serviceOwnerUid: uid,
    updatedAt: new Date(),
  }, { merge: true });
  console.log(`Subscription updated for ${uid}.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { subscriptionPatch };
