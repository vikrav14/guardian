const admin = require('firebase-admin');
const fs = require('fs');
const config = require('./src/config');

const serviceAccount = JSON.parse(fs.readFileSync(config.googleApplicationCredentials, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: config.firebaseProjectId });
const db = admin.firestore();

db.collection('devices').get().then(snap => {
  snap.docs.forEach(doc => {
    const d = doc.data();
    console.log(`\n=== ${d.name || 'Device'} (IMEI: ${doc.id}) ===`);
    console.log(`Online: ${d.online}`);
    console.log(`Battery: ${d.batteryPercent}%`);
    console.log(`LastHeartbeat: ${d.lastHeartbeatAt?.toDate?.()?.toISOString?.() || d.lastHeartbeatAt}`);
    console.log(`Location: lat=${d.location?.lat}, lng=${d.location?.lng}`);
    console.log(`LocationUpdatedAt: ${d.location?.updatedAt?.toDate?.()?.toISOString?.() || d.location?.updatedAt}`);
    console.log(`SpeedKmh: ${d.speedKmh}`);
  });
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
