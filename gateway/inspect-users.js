const admin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config();

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialsPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is missing from gateway/.env');
  process.exit(1);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(credentialsPath, 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

function typeOf(value) {
  if (Array.isArray(value)) return 'ARRAY';
  if (value === null) return 'NULL';
  if (value?.constructor?.name === 'Timestamp') return 'TIMESTAMP';
  if (typeof value === 'object') return 'MAP/OBJECT';
  return typeof value;
}

(async () => {
  const snapshot = await db.collection('users').get();

  for (const doc of snapshot.docs) {
    console.log('\n================================================');
    console.log('USER DOCUMENT:', doc.id);
    console.log('================================================');

    const data = doc.data();

    for (const [key, value] of Object.entries(data)) {
      console.log(`\n${key} -> ${typeOf(value)}`);
      console.dir(value, { depth: 5 });
    }
  }

  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
