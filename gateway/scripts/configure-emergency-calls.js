'use strict';
const { configureEmergencyCalls } = require('../src/watch-emergency-calls');
async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--imei', '--manager-uid', '--apply'].includes(key) || key in options) throw new Error('invalid_arguments');
    options[key] = key === '--apply' ? true : args[++i];
  }
  if (!/^\d{15}$/.test(options['--imei'] || '') || (options['--manager-uid'] != null && !/^[A-Za-z0-9_-]{1,128}$/.test(options['--manager-uid']))) throw new Error('invalid_arguments');
  if (!options['--apply']) return { outcome: 'preview', windowMinutes: 5, enabled: false, watchCommandSent: false };
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('firestore_unavailable');
  try { return await configureEmergencyCalls(db, { imei: options['--imei'], managerUid: options['--manager-uid'] }); }
  finally { await db.terminate(); }
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => {
    const reasons = ['invalid_arguments', 'firestore_unavailable', 'primary_contact_mismatch', 'manager_access_changed',
      'call_settings_changed', 'primary_owner_ambiguous', 'service_unavailable', 'identity_mismatch', 'change_in_progress'];
    console.error(reasons.includes(error.message) ? error.message : 'Emergency call setup unavailable. Private details withheld.');
    process.exitCode = 1;
  });
module.exports = { main };
