const admin = require('firebase-admin');
const { getDb } = require('./src/firestore');

async function getUsers() {
  try {
    const db = getDb();
    console.log('\n📋 Fetching users and linked devices...\n');
    
    const usersSnap = await db.collection('users').limit(10).get();
    
    console.log(`Found ${usersSnap.size} users:\n`);
    
    usersSnap.forEach(doc => {
      const data = doc.data();
      console.log(`UID: ${doc.id}`);
      console.log(`  Email: ${data.email || 'N/A'}`);
      console.log(`  Name: ${data.displayName || 'N/A'}`);
      console.log(`  Linked IMEIs: ${(data.linkedImeis || []).join(', ') || 'None'}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

getUsers();
