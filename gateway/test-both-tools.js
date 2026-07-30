const admin = require('firebase-admin');
const fs = require('fs');
const config = require('./src/config');
const { runTool, resolveCallerContext } = require('./src/assistant/tools');

const serviceAccount = JSON.parse(fs.readFileSync(config.googleApplicationCredentials, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: config.firebaseProjectId });
const db = admin.firestore();

(async () => {
  const ctx = await resolveCallerContext(db, '+23058590100');

  console.log('=== Tool Output ===\n');

  const jeshna = await runTool(db, ctx, 'get_last_location', { device_name: 'Jeshna' });
  console.log('Jeshna:');
  console.log(JSON.stringify(jeshna, null, 2));

  const dexter = await runTool(db, ctx, 'get_last_location', { device_name: 'Dexter' });
  console.log('\nDexter:');
  console.log(JSON.stringify(dexter, null, 2));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
