const admin = require('firebase-admin');
const fs = require('fs');
const config = require('./src/config');

const serviceAccount = JSON.parse(fs.readFileSync(config.googleApplicationCredentials, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: config.firebaseProjectId });
const db = admin.firestore();

console.log('🔍 Monitoring devices...\n');

let lastSnapshot = null;

const unsubscribe = db.collection('devices').onSnapshot(snap => {
  snap.docs.forEach(doc => {
    const d = doc.data();
    const imei = doc.id;
    const name = d.name || d.nickname || 'Device';

    console.log(`\n📍 ${name} (${imei})`);
    console.log(`   Online: ${d.online ? '✓ YES' : '✗ NO'}`);
    console.log(`   Battery: ${d.batteryPercent}%`);
    console.log(`   Location: (${d.location?.lat?.toFixed(6)}, ${d.location?.lng?.toFixed(6)})`);
    console.log(`   Speed: ${d.speedKmh} km/h ${d.speedKmh >= 5 ? '🚗' : '⏸️ (noise filtered)'}`);
    console.log(`   LastHeartbeat: ${d.lastHeartbeatAt?.toDate?.()?.toLocaleTimeString?.() || 'never'}`);
  });

  console.log('\n---');
});

console.log('Press Ctrl+C to stop monitoring');

// Stop after 15 minutes
setTimeout(() => {
  unsubscribe();
  process.exit(0);
}, 15 * 60 * 1000);
