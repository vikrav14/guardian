const admin = require('firebase-admin');

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
const imei = '861397053140768';

(async () => {
  try {
    console.log(`Clearing test location cache for Jeshna (${imei})...\n`);

    await db.collection('devices').doc(imei).update({
      lastLocation: admin.firestore.FieldValue.delete()
    });

    console.log('✅ Test location cleared');
    console.log('Device will now show real location on next update\n');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
