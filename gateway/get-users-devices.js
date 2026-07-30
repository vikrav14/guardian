const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize (uses GOOGLE_APPLICATION_CREDENTIALS env var)
const db = getFirestore();

async function getSetup() {
  try {
    console.log('\n📋 Fetching users and devices from Firestore...\n');
    
    // Get all users
    const usersSnap = await db.collection('users').limit(5).get();
    console.log(`Found ${usersSnap.size} users:\n`);
    
    const users = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      users.push({
        uid: doc.id,
        email: data.email || 'N/A',
        displayName: data.displayName || 'N/A',
        linkedImeis: data.linkedImeis || [],
      });
      console.log(`UID: ${doc.id}`);
      console.log(`  Email: ${data.email || 'N/A'}`);
      console.log(`  Name: ${data.displayName || 'N/A'}`);
      console.log(`  Linked IMEIs: ${(data.linkedImeis || []).join(', ') || 'None'}`);
      console.log('');
    });
    
    // Get all devices
    const devicesSnap = await db.collection('devices').limit(5).get();
    console.log(`\nFound ${devicesSnap.size} devices:\n`);
    
    devicesSnap.forEach(doc => {
      const data = doc.data();
      console.log(`IMEI: ${doc.id}`);
      console.log(`  Device: ${data.deviceLabel || 'Unknown'}`);
      console.log(`  Online: ${data.online ? 'Yes' : 'No'}`);
      console.log(`  Battery: ${data.batteryPercent || 'N/A'}%`);
      console.log('');
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

getSetup();
