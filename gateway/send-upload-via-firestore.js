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

async function sendUploadCommand() {
  const imei = '861397052547492';

  const commandDoc = {
    imei,
    type: 'set_upload_interval',
    params: {
      seconds: 300  // Upload every 5 minutes
    },
    status: 'pending',
    createdBy: 'system',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const docRef = await db.collection('deviceCommands').add(commandDoc);
    console.log(`✅ Command queued: ${docRef.id}`);
    console.log(`   IMEI: ${imei}`);
    console.log(`   Type: set_upload_interval`);
    console.log(`   Interval: 300 seconds (5 minutes)`);
    console.log(`   Status: pending (gateway will send to device)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to queue command:', err.message);
    process.exit(1);
  }
}

sendUploadCommand();
