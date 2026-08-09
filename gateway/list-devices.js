const admin = require('firebase-admin');
const path = require('path');

// Use environment variable for credentials
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

const serviceAccount = require(credPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'guardian-fbadd'
});

const db = admin.firestore();

(async () => {
  try {
    console.log('\n=== DEVICES IN FIRESTORE ===\n');

    const snapshot = await db.collection('devices').get();

    if (snapshot.empty) {
      console.log('No devices found');
      process.exit(0);
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      const imei = doc.id;
      const name = data.displayName || 'Unknown';
      const online = data.online ? '🟢' : '🔴';
      const battery = data.batteryPercent || '?';
      const lastSeen = data.lastSeenAt?.toDate?.().toISOString() || 'Never';

      console.log(`${name} (${imei})`);
      console.log(`  Status: ${online} ${online ? 'Online' : 'Offline'}`);
      console.log(`  Battery: ${battery}%`);
      console.log(`  Last Seen: ${lastSeen}`);
      console.log('');
    });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
