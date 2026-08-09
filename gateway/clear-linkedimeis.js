#!/usr/bin/env node

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(type, message) {
  const prefix = {
    info: `${colors.cyan}ℹ${colors.reset}`,
    success: `${colors.green}✅${colors.reset}`,
    warning: `${colors.yellow}⚠${colors.reset}`,
    error: `${colors.red}❌${colors.reset}`,
    step: `${colors.bright}→${colors.reset}`,
  };
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

async function initFirebase() {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../firebase-key.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account not found: ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  return admin.firestore();
}

async function main() {
  console.log(`\n${colors.bright}Clear linkedImeis - Keep Only Device Ending in 92${colors.reset}\n`);

  try {
    log('step', 'Initializing Firebase...');
    const db = await initFirebase();

    const email = 'vikrav14@gmail.com';
    log('step', `Fetching user profile for ${email}...`);

    const snap = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new Error(`User not found: ${email}`);
    }

    const user = snap.docs[0];
    const userId = user.id;
    const userData = user.data();
    const currentLinkedImeis = userData.linkedImeis || [];

    log('success', `Found user: ${userData.displayName}`);

    console.log(`\n${colors.bright}Current linkedImeis:${colors.reset}`);
    if (currentLinkedImeis.length === 0) {
      console.log('  (empty)');
    } else {
      currentLinkedImeis.forEach(imei => {
        const ending = imei.slice(-2);
        const marker = ending === '92' ? ` ${colors.green}← KEEP${colors.reset}` : ` ${colors.red}← DELETE${colors.reset}`;
        console.log(`  - ${imei}${marker}`);
      });
    }

    const toKeep = currentLinkedImeis.filter(imei => imei.endsWith('92'));
    const toRemove = currentLinkedImeis.filter(imei => !imei.endsWith('92'));

    console.log(`\n${colors.bright}Action:${colors.reset}`);
    console.log(`  Keep:   ${toKeep.length} IMEI(s)`);
    console.log(`  Remove: ${toRemove.length} IMEI(s)`);

    if (toRemove.length === 0) {
      log('success', 'linkedImeis already contains only the device ending in 92!');
      process.exit(0);
    }

    log('step', 'Updating linkedImeis...');

    await db.collection('users').doc(userId).update({
      linkedImeis: toKeep,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log('success', 'linkedImeis updated!');

    // Verify
    log('step', 'Verifying update...');
    const updated = await db.collection('users').doc(userId).get();
    const newLinkedImeis = updated.data().linkedImeis || [];

    console.log(`\n${colors.bright}Updated linkedImeis:${colors.reset}`);
    if (newLinkedImeis.length === 0) {
      console.log('  (empty)');
    } else {
      newLinkedImeis.forEach(imei => console.log(`  - ${imei}`));
    }

    log('success', 'Done! Refresh the app to see changes.');
    process.exit(0);
  } catch (err) {
    log('error', err.message);
    process.exit(1);
  }
}

main();
