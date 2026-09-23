'use strict';

const fs = require('node:fs');
const { validateInventory, configureWatchPhonebook } = require('../src/watch-phonebook');

async function main(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--inventory-file', '--apply'].includes(key) || key in values) throw new Error('invalid_arguments');
    values[key] = key === '--apply' ? true : args[++i];
    if (!values[key]) throw new Error('invalid_arguments');
  }
  let input;
  try {
    const stat = fs.statSync(values['--inventory-file']);
    if (!stat.isFile() || stat.size > 16000) throw new Error();
    input = validateInventory(JSON.parse(fs.readFileSync(values['--inventory-file'], 'utf8').replace(/^\uFEFF/, '')));
  } catch { throw new Error('invalid_inventory'); }
  if (!values['--apply']) return { outcome: 'preview', emptySlots: input.emptySlots,
    importedContacts: input.contacts.length, watchCommandSent: false };
  const db = require('../src/firestore').initFirestore({ startWatchers: false });
  if (!db) throw new Error('firestore_unavailable');
  try { return await configureWatchPhonebook(db, input); }
  finally { await db.terminate(); }
}
if (require.main === module) main(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => {
    const allowed = ['invalid_arguments', 'invalid_inventory', 'already_configured', 'change_in_progress',
      'identity_or_manager_invalid', 'firestore_unavailable'];
    console.error(allowed.includes(error.message) ? error.message : 'Phonebook setup unavailable; private details withheld.');
    process.exitCode = 1;
  });
module.exports = { main };
