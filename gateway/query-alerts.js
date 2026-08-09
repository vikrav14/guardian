const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_PATH ||
  require('path').join(__dirname, 'firebase-service-account.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'guardian-fbadd'
  });
} catch (err) {
  console.error('Could not load service account:', err.message);
  process.exit(1);
}

const db = admin.firestore();

(async () => {
  try {
    const imei = '861397053139877'; // Dexter

    // Get recent alerts
    console.log(`\n=== CHECKING ALERTS FOR DEXTER (${imei}) ===\n`);

    const alertsRef = db.collection('alerts');
    const query = alertsRef
      .where('imei', '==', imei)
      .orderBy('createdAt', 'desc')
      .limit(20);

    const snapshot = await query.get();

    if (snapshot.empty) {
      console.log('❌ NO ALERTS FOUND');
    } else {
      console.log(`✅ Found ${snapshot.size} alerts:\n`);
      snapshot.forEach((doc, idx) => {
        const data = doc.data();
        const ageMs = Date.now() - data.createdAt.toDate().getTime();
        const ageSec = Math.round(ageMs / 1000);
        const ageMin = Math.round(ageMs / 60000);

        console.log(`${idx + 1}. ${data.type.toUpperCase()}`);
        console.log(`   Age: ${ageSec < 60 ? ageSec + 's' : ageMin + 'm'} ago`);
        console.log(`   Severity: ${data.severity}`);
        console.log(`   Status: ${data.notifyStatus}`);
        console.log(`   Location: ${data.location?.placeName || 'Unknown'}`);
        console.log('');
      });
    }

    // Also show device status
    console.log('=== DEVICE STATUS ===\n');
    const deviceDoc = await db.collection('devices').doc(imei).get();
    if (deviceDoc.exists) {
      const device = deviceDoc.data();
      console.log('Online:', device.online ? '🟢' : '🔴');
      console.log('Battery:', device.batteryPercent + '%');
      console.log('Location:', device.lastLocation?.placeName || 'Unknown');
      console.log('Coordinates:', device.lastLocation?.lat, device.lastLocation?.lng);
      console.log('Last Update:', device.lastSeenAt?.toDate?.().toISOString());
    }

    process.exit(0);
  } catch (err) {
    console.error('Query error:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
