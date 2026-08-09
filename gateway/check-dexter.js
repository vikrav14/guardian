const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'guardian-fbadd'
});

const db = admin.firestore();

(async () => {
  try {
    // Check both IMEIs
    const imei1 = '861397053139877'; // From status response (Dexter)
    const imei2 = '861397053140768'; // Previous IMEI

    for (const imei of [imei1, imei2]) {
      const doc = await db.collection('devices').doc(imei).get();
      if (doc.exists) {
        const data = doc.data();
        console.log(`\n=== IMEI: ${imei} ===`);
        console.log('Name:', data.displayName || 'N/A');
        console.log('Online:', data.online);
        console.log('Battery:', data.batteryPercent + '%');
        console.log('Last Seen:', data.lastSeenAt?.toDate?.().toISOString() || 'N/A');
        console.log('Location:', data.lastLocation?.placeName || 'N/A');
        console.log('Age (mins):', data.lastSeenAt ? Math.round((Date.now() - data.lastSeenAt.toDate().getTime()) / 60000) : 'N/A');
      } else {
        console.log(`\nIMEI ${imei}: NOT FOUND in Firestore`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
