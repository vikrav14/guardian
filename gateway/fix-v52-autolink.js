#!/usr/bin/env node

/**
 * Fix auto-linked V52 device in user's linkedImeis
 *
 * PROBLEM: V52 device (861397052547492) appears in dashboard even though
 * user never explicitly linked it. This means it was auto-added to linkedImeis.
 *
 * SOLUTION: Remove it from linkedImeis to prevent unlinked devices from appearing.
 * The device will still exist in Firestore, but won't be accessible until
 * the user explicitly links it via linkPendant().
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

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

async function getUserByEmail(db, email) {
  const snap = await db.collection('users').where('email', '==', email).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { uid: doc.id, ...doc.data() };
}

async function main() {
  console.log(`\n${colors.bright}Guardian - Fix V52 Auto-Linking Bug${colors.reset}\n`);

  try {
    log('step', 'Initializing Firebase...');
    const db = await initFirebase();

    const email = await prompt(`${colors.cyan}Enter user email (the guardian account):${colors.reset} `);
    if (!email || !email.includes('@')) {
      throw new Error('Invalid email address');
    }

    log('step', 'Fetching user profile...');
    const user = await getUserByEmail(db, email.trim());

    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    log('success', `Found user: ${user.displayName} (${user.email})`);

    const linkedImeis = (user.linkedImeis || []);
    console.log(`\n${colors.bright}Current linkedImeis:${colors.reset}`);
    if (linkedImeis.length === 0) {
      console.log('  (empty)');
    } else {
      linkedImeis.forEach(imei => {
        const isV52 = imei === '861397052547492';
        const marker = isV52 ? ` ${colors.yellow}← V52 AUTO-LINKED DEVICE (will remove)${colors.reset}` : '';
        console.log(`  - ${imei}${marker}`);
      });
    }

    // Check if V52 device is linked
    if (!linkedImeis.includes('861397052547492')) {
      log('success', 'V52 device is NOT in linkedImeis. No fix needed!');
      rl.close();
      process.exit(0);
    }

    console.log();
    const proceed = await prompt(
      `${colors.yellow}Remove V52 device (861397052547492) from linkedImeis? (yes/no):${colors.reset} `
    );

    if (proceed.toLowerCase() !== 'yes') {
      log('info', 'Cancelled.');
      rl.close();
      process.exit(0);
    }

    log('step', 'Removing V52 device from linkedImeis...');

    await db.collection('users').doc(user.uid).update({
      linkedImeis: admin.firestore.FieldValue.arrayRemove(['861397052547492']),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log('success', 'V52 device removed from linkedImeis');

    // Verify removal
    log('step', 'Verifying removal...');
    const updated = await db.collection('users').doc(user.uid).get();
    const newLinkedImeis = (updated.data()?.linkedImeis || []);

    console.log(`\n${colors.bright}Updated linkedImeis:${colors.reset}`);
    if (newLinkedImeis.length === 0) {
      console.log('  (empty)');
    } else {
      newLinkedImeis.forEach(imei => console.log(`  - ${imei}`));
    }

    if (!newLinkedImeis.includes('861397052547492')) {
      log('success', 'V52 device successfully removed!');
      console.log(`\n${colors.bright}Next Steps:${colors.reset}\n`);
      console.log('1. Refresh the Flutter app\n');
      console.log('2. V52 device should no longer appear in the dashboard\n');
      console.log('3. To link it again, use the app\'s "Link Device" feature\n');
      console.log('   and enter the 15-digit IMEI: 861397052547492\n');
    } else {
      log('error', 'Removal verification failed!');
      process.exit(1);
    }

    rl.close();
    process.exit(0);
  } catch (err) {
    log('error', err.message);
    rl.close();
    process.exit(1);
  }
}

main();
