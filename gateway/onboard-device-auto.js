#!/usr/bin/env node

/**
 * Guardian Device Onboarding Script (Non-Interactive)
 * Usage: node onboard-device-auto.js <protocolId> <imei> <simPhone> <adminPhone> <carrier> [nickname] [ngrokHost] [ngrokPort] [guardianEmail]
 *
 * If guardianEmail is provided, the device will be automatically linked to that user's account.
 * Otherwise, the device is registered in Firestore but not linked — user must link it manually in the app.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Colors for CLI output
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

function validateImei(imei) {
  return /^\d{15}$/.test(imei);
}

function validateProtocolId(id) {
  return /^\d{10}$/.test(id);
}

function validatePhone(phone) {
  return /^\+?[0-9]{7,15}$/.test(phone);
}

function generateSmsCommands(protocolId, ngrokHost, ngrokPort, simPhone, carrier = 'myt') {
  const apnMap = {
    myt: { apn: 'internet', mccmnc: '46000' },  // MCC 46 + MNC 00
    emtel: { apn: 'web', mccmnc: '64001' },     // MCC 64 + MNC 01
  };

  const carrierConfig = apnMap[carrier.toLowerCase()] || apnMap.myt;

  return {
    centerNumber: {
      command: `pw,123456,center,${simPhone}#`,
      description: 'Set admin phone number (center number)',
    },
    serverIp: {
      command: `pw,123456,ip,${ngrokHost},${ngrokPort}#`,
      description: 'Point device to ngrok server',
    },
    apn: {
      command: `pw,123456,apn,${carrierConfig.apn},,,${carrierConfig.mccmnc}#`,
      description: `Set APN for ${carrier.toUpperCase()} carrier`,
    },
    status: {
      command: `ts#`,
      description: 'Verify configuration',
    },
  };
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

async function registerDeviceInFirestore(db, imei, nickname, simPhone, protocolId, carrier) {
  const deviceData = {
    imei,
    nickname: nickname || `Device (${imei.slice(-4)})`,
    simNumber: simPhone,
    protocolId,
    online: false,
    batteryPercent: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection('devices').doc(imei).set(deviceData);
    return true;
  } catch (err) {
    log('error', `Firestore registration failed: ${err.message}`);
    return false;
  }
}

function getEnvPath() {
  return path.join(__dirname, '.env');
}

function readEnv() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach((line) => {
    const [key, ...valueParts] = line.split('=');
    if (key && key.trim() && !key.startsWith('#')) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });
  return env;
}

function updateEnvImeiMap(protocolId, imei) {
  const envPath = getEnvPath();
  const env = readEnv();
  const currentMap = env.IMEI_MAP || '';

  if (currentMap.includes(protocolId)) {
    log('info', `IMEI_MAP already contains protocol ID ${protocolId}`);
    return false;
  }

  const newMapping = `${protocolId}:${imei}`;
  const updatedMap = currentMap ? `${currentMap},${newMapping}` : newMapping;

  let content = fs.readFileSync(envPath, 'utf8');
  const imeiMapLine = `IMEI_MAP=${updatedMap}`;

  if (content.includes('IMEI_MAP=')) {
    content = content.replace(/IMEI_MAP=.*/, imeiMapLine);
  } else {
    content += `\n# Device IMEI mappings\n${imeiMapLine}\n`;
  }

  fs.writeFileSync(envPath, content);
  return true;
}

async function findGuardianByEmail(db, email) {
  try {
    const snap = await db.collection('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return {
      uid: doc.id,
      displayName: doc.data().displayName,
      email: doc.data().email,
    };
  } catch (err) {
    log('error', `Failed to find guardian: ${err.message}`);
    return null;
  }
}

async function linkDeviceToGuardian(db, guardianUid, imei) {
  try {
    await db.collection('users').doc(guardianUid).set({
      linkedImeis: admin.firestore.FieldValue.arrayUnion([imei]),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (err) {
    log('error', `Failed to link device: ${err.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 5) {
    console.log(`${colors.bright}Usage:${colors.reset}`);
    console.log('node onboard-device-auto.js <protocolId> <imei> <simPhone> <adminPhone> <carrier> [nickname] [ngrokHost] [ngrokPort] [guardianEmail]\n');
    console.log(`${colors.bright}Example:${colors.reset}`);
    console.log('node onboard-device-auto.js 9705254749 861397052547492 +23073332567 +23073332567 myt "V52 Device 1" 0.tcp.in.ngrok.io 25295 user@example.com\n');
    process.exit(1);
  }

  try {
    const [protocolId, imei, simPhone, adminPhone, carrier, nickname = '', ngrokHost = '0.tcp.in.ngrok.io', ngrokPort = '25295', guardianEmail = ''] = args;

    log('step', 'Validating inputs...');

    if (!validateProtocolId(protocolId)) throw new Error('Invalid protocol ID (must be 10 digits)');
    if (!validateImei(imei)) throw new Error('Invalid IMEI (must be 15 digits)');
    if (!validatePhone(simPhone)) throw new Error('Invalid device SIM phone');
    if (!validatePhone(adminPhone)) throw new Error('Invalid admin phone');
    if (!['myt', 'emtel'].includes(carrier.toLowerCase())) throw new Error('Invalid carrier (myt or emtel)');
    if (!/^\d{4,5}$/.test(ngrokPort)) throw new Error('Invalid ngrok port');

    log('success', 'All inputs valid\n');

    // Generate SMS commands
    log('step', 'Generating SMS commands...\n');
    const commands = generateSmsCommands(protocolId, ngrokHost, ngrokPort, adminPhone, carrier);

    console.log(`${colors.bright}Send these SMS commands IN ORDER:${colors.reset}\n`);
    Object.entries(commands).forEach(([key, { command, description }], index) => {
      console.log(`${index + 1}. ${description}`);
      console.log(`   ${colors.yellow}${command}${colors.reset}\n`);
    });

    // Register in Firestore
    log('step', 'Registering device in Firestore...');
    const db = await initFirebase();
    const registered = await registerDeviceInFirestore(db, imei, nickname, simPhone, protocolId, carrier);

    if (!registered) throw new Error('Failed to register device in Firestore');
    log('success', `Device registered: ${imei}`);

    // Link to guardian account if email provided
    if (guardianEmail && guardianEmail.trim()) {
      log('step', `Linking device to guardian: ${guardianEmail}`);
      const guardian = await findGuardianByEmail(db, guardianEmail.trim());

      if (guardian) {
        const linked = await linkDeviceToGuardian(db, guardian.uid, imei);
        if (linked) {
          log('success', `Device linked to ${guardian.displayName} (${guardian.email})`);
        } else {
          log('warning', 'Device registered but linking failed');
        }
      } else {
        log('warning', `Guardian account not found: ${guardianEmail}`);
        log('warning', 'Device registered but NOT linked. User must link it manually in the app.');
      }
    } else {
      log('info', 'No guardian email provided. Device registered but NOT linked.');
      log('info', 'User must link it manually in the app: Link Device → Enter 15-digit IMEI');
    }

    // Update IMEI mapping
    log('step', 'Updating IMEI mapping in .env...');
    const updated = updateEnvImeiMap(protocolId, imei);
    if (updated) {
      log('success', `IMEI_MAP updated: ${protocolId} → ${imei}`);
    } else {
      log('info', 'IMEI_MAP already up to date');
    }

    // Summary
    console.log(`\n${colors.bright}Onboarding Summary${colors.reset}\n`);
    console.log(`Protocol ID:     ${protocolId}`);
    console.log(`IMEI:            ${imei}`);
    console.log(`Device SIM:      ${simPhone}`);
    console.log(`Admin Phone:     ${adminPhone}`);
    console.log(`Carrier:         ${carrier.toUpperCase()}`);
    console.log(`Nickname:        ${nickname || '(default)'}`);
    console.log(`ngrok:           ${ngrokHost}:${ngrokPort}`);
    if (guardianEmail) {
      console.log(`Guardian:        ${guardianEmail}`);
    }

    console.log(`\n${colors.bright}Next Steps:${colors.reset}\n`);
    console.log('1. Send SMS commands above to the device SIM\n');
    console.log('2. Power cycle the device\n');
    console.log('3. Device should connect within 60 seconds\n');
    console.log('4. Check Firestore: connectionState should be "live"\n');
    if (!guardianEmail) {
      console.log('5. Guardian must link the device in the app: Link Device → Enter 15-digit IMEI\n');
    }

    log('success', 'Onboarding complete!');
    process.exit(0);
  } catch (err) {
    log('error', err.message);
    process.exit(1);
  }
}

main();
