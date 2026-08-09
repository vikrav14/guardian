#!/usr/bin/env node

/**
 * Guardian Device Onboarding Script
 *
 * Seamlessly onboard a new V28C or V52 device by:
 * 1. Collecting device info
 * 2. Generating SMS commands
 * 3. Registering in Firestore
 * 4. Updating IMEI mapping
 * 5. Testing connectivity
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Colors for CLI output
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
    myt: { apn: 'internet', user: '', pass: '', mcc: '46', mnc: '00' },
    emtel: { apn: 'web', user: '', pass: '', mcc: '64', mnc: '01' },
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
      command: `pw,123456,apn,${carrierConfig.apn},,,${carrierConfig.mcc}${carrierConfig.mnc}#`,
      description: `Set APN for ${carrier.toUpperCase()} carrier`,
    },
    status: {
      command: `ts#`,
      description: 'Verify configuration (should reply with device status)',
    },
  };
}

async function registerDeviceInFirestore(db, imei, nickname, simPhone, protocolId, carrier) {
  const deviceData = {
    imei,
    nickname: nickname || `V52 Device (${imei.slice(-4)})`,
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

  // Check if already present
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

async function main() {
  console.log(`\n${colors.bright}Guardian Device Onboarding${colors.reset}\n`);

  try {
    // Collect device information
    log('step', 'Collecting device information...\n');

    const deviceType = await prompt(
      `Device type (${colors.cyan}V28C${colors.reset} or ${colors.cyan}V52${colors.reset}): `
    );
    if (!['V28C', 'V52', 'v28c', 'v52'].includes(deviceType)) {
      throw new Error('Invalid device type. Use V28C or V52.');
    }

    const protocolId = await prompt('Protocol ID (10 digits, e.g., 9705254749): ');
    if (!validateProtocolId(protocolId)) {
      throw new Error('Invalid protocol ID. Must be 10 digits.');
    }

    const imei = await prompt('Full IMEI (15 digits): ');
    if (!validateImei(imei)) {
      throw new Error('Invalid IMEI. Must be 15 digits.');
    }

    const simPhone = await prompt('Device SIM phone number (E.164, e.g., +23073332567): ');
    if (!validatePhone(simPhone)) {
      throw new Error('Invalid phone number.');
    }

    const adminPhone = await prompt('Admin phone for SMS commands (e.g., +23073332567): ');
    if (!validatePhone(adminPhone)) {
      throw new Error('Invalid phone number.');
    }

    const carrier = await prompt('SIM carrier (${colors.cyan}myt${colors.reset} or ${colors.cyan}emtel${colors.reset}): ');
    if (!['myt', 'emtel', 'MYT', 'EMTEL'].includes(carrier)) {
      throw new Error('Invalid carrier. Use myt or emtel.');
    }

    const nickname = await prompt('Device nickname (optional, press Enter to skip): ');

    const ngrokHost = await prompt(
      `ngrok host (${colors.cyan}0.tcp.in.ngrok.io${colors.reset}): `
    );
    const finalNgrokHost = ngrokHost || '0.tcp.in.ngrok.io';

    const ngrokPort = await prompt('ngrok port (e.g., 25295): ');
    if (!ngrokPort || !/^\d{4,5}$/.test(ngrokPort)) {
      throw new Error('Invalid ngrok port.');
    }

    // Generate SMS commands
    log('step', '\nGenerating SMS commands...\n');
    const commands = generateSmsCommands(
      protocolId,
      finalNgrokHost,
      ngrokPort,
      adminPhone,
      carrier
    );

    console.log(`${colors.bright}Send these SMS commands IN ORDER:${colors.reset}\n`);
    Object.entries(commands).forEach(([key, { command, description }], index) => {
      console.log(`${index + 1}. ${description}`);
      console.log(`   ${colors.yellow}${command}${colors.reset}\n`);
    });

    const proceed = await prompt(`${colors.cyan}Ready to register in Firestore? (yes/no):${colors.reset} `);
    if (proceed.toLowerCase() !== 'yes') {
      log('info', 'Cancelled. Send the SMS commands manually.');
      rl.close();
      return;
    }

    // Register in Firestore
    log('step', 'Registering device in Firestore...');
    const db = await initFirebase();
    const registered = await registerDeviceInFirestore(
      db,
      imei,
      nickname,
      simPhone,
      protocolId,
      carrier
    );

    if (!registered) {
      throw new Error('Failed to register device in Firestore');
    }
    log('success', `Device registered: ${imei}`);

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
    console.log(`Device Type:     ${deviceType.toUpperCase()}`);
    console.log(`Protocol ID:     ${protocolId}`);
    console.log(`IMEI:            ${imei}`);
    console.log(`SIM:             ${simPhone}`);
    console.log(`Carrier:         ${carrier.toUpperCase()}`);
    console.log(`Nickname:        ${nickname || '(default)'}`);
    console.log(`ngrok:           ${finalNgrokHost}:${ngrokPort}`);

    console.log(`\n${colors.bright}Next Steps:${colors.reset}\n`);
    console.log('1. Send SMS commands above to the device SIM\n');
    console.log('2. Power cycle the device\n');
    console.log('3. Device should connect and appear in Firestore within 60 seconds\n');
    console.log('4. Monitor in Firestore: connectionState should change to "live"\n');

    log('success', 'Onboarding complete!');

    rl.close();
    process.exit(0);
  } catch (err) {
    log('error', err.message);
    rl.close();
    process.exit(1);
  }
}

main();
