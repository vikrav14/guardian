#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { initFirestore } = require('../src/firestore');
const { cutoverFamilyNotifications } = require('../src/family-notification-cutover');
async function main() {
  const args = process.argv.slice(2), file = args[args.indexOf('--manifest') + 1];
  if (!args.includes('--manifest') || !file) throw new Error('Use --manifest <reviewed JSON file>. Default is preview only.');
  const apply = args.includes('--apply-reviewed-cutover');
  if (apply && process.env.FAMILY_SHARING_ENABLED !== 'true') throw new Error('Family sharing must be enabled.');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('Firestore unavailable.');
  console.log(JSON.stringify(await cutoverFamilyNotifications(db, JSON.parse(fs.readFileSync(file, 'utf8')), { apply }), null, 2));
}
if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
