#!/usr/bin/env node

const { initFirestore, getDb } = require('../src/firestore');
const { PLAN } = require('../src/entitlements');

function valueAfter(flag, args) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function parseArguments(args) {
  const imei = String(valueAfter('--imei', args) || '').trim();
  const confirmed = args.includes('--confirm');
  const hasOneImei = args.filter(arg => arg === '--imei').length === 1;
  const extraArgs = args.filter(arg => arg !== '--imei' && arg !== imei && arg !== '--confirm');
  if (!hasOneImei || !/^\d{15}$/.test(imei) || extraArgs.length > 0) {
    throw new Error('Use --imei <15-digit-hardware-imei> with optional --confirm.');
  }
  return { imei, confirmed };
}

function nextPlan(currentPlan) {
  return currentPlan === PLAN.ESSENTIAL ? PLAN.FAMILY : currentPlan;
}

async function findProfile(db, imei) {
  const users = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  const owners = new Map();
  for (const user of users.docs) {
    const data = user.data() || {};
    const ownerUid = String(data.serviceOwnerUid || user.id).trim();
    if (!owners.has(ownerUid)) owners.set(ownerUid, []);
    owners.get(ownerUid).push(user.id);
  }
  if (owners.size !== 1) {
    throw new Error(owners.size === 0
      ? 'No linked service profile was found for this watch.'
      : 'More than one linked service profile was found; refuse to choose between them.');
  }
  const ownerUid = [...owners.keys()][0];
  const subscription = await db.collection('serviceSubscriptions').doc(ownerUid).get();
  if (!subscription.exists) throw new Error(`No service subscription was found for ${ownerUid}.`);
  return { ownerUid, linkedUserIds: owners.get(ownerUid), subscription: subscription.data() || {} };
}

async function main() {
  const { imei, confirmed } = parseArguments(process.argv.slice(2));
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const profile = await findProfile(db, imei);
  const currentPlan = String(profile.subscription.plan || '').trim().toLowerCase();
  const targetPlan = nextPlan(currentPlan);
  console.log(JSON.stringify({ imei, ownerUid: profile.ownerUid, currentPlan, targetPlan,
    linkedUserIds: profile.linkedUserIds, changed: targetPlan !== currentPlan }, null, 2));
  if (targetPlan === currentPlan) return;
  if (!confirmed) {
    console.log('PREVIEW ONLY: rerun with --confirm to upgrade an Essential profile to Family.');
    return;
  }
  if (currentPlan !== PLAN.ESSENTIAL) throw new Error(`Refusing to change non-Essential profile: ${currentPlan || 'unknown'}.`);
  await db.collection('serviceSubscriptions').doc(profile.ownerUid).update({
    plan: PLAN.FAMILY,
    updatedAt: new Date(),
  });
  console.log(`Essential profile upgraded to Family for ${profile.ownerUid}.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(error => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});

module.exports = { parseArguments, nextPlan, findProfile };
