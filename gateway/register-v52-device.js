const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__dirname, '../firebase-key.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Service account file not found: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();

async function registerDevice() {
  const imei = '861397052547492';
  const simNumber = '+23073332567';
  const protocolId = '9705254749';
  const nickname = 'V52 Device 1';

  const deviceData = {
    imei,
    nickname,
    simNumber,
    protocolId,
    online: false,
    batteryPercent: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection('devices').doc(imei).set(deviceData);
    console.log(`✅ Device registered: ${imei}`);
    console.log(`   Nickname: ${nickname}`);
    console.log(`   SIM: ${simNumber}`);
    console.log(`   Protocol ID: ${protocolId}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to register device:', err.message);
    process.exit(1);
  }
}

registerDevice();
