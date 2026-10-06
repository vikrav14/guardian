#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { initFirestore } = require('../src/firestore');
const { provisionFamilyService } = require('../src/family-provision');
async function main() {
  const args = process.argv.slice(2), file = args[args.indexOf('--manifest') + 1];
  if (!args.includes('--manifest') || !file) throw new Error('Use --manifest <reviewed JSON file>. Default is preview only.');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const apply = args.includes('--apply-reviewed-migration');
  if (apply && process.env.FAMILY_SHARING_ENABLED !== 'true') throw new Error('Deploy and verify sharing before activating a service.');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('Firestore unavailable.');
  console.log(JSON.stringify(await provisionFamilyService(db, manifest, { apply }), null, 2));
}
if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
