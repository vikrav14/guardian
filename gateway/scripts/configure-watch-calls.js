'use strict';

const { readCapture } = require('./trial-captured-answer-mode');
const { prepareCapturedAnswerTrial } = require('../src/captured-answer-mode-trial');
const { configureWatchCalls } = require('../src/watch-calls');

async function main(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--imei', '--capture-file', '--apply'].includes(key) || key in values) throw new Error('invalid_arguments');
    values[key] = key === '--apply' ? true : args[++i];
    if (!values[key]) throw new Error('invalid_arguments');
  }
  const input = { imei: values['--imei'], capture: readCapture(values['--capture-file']) };
  const { metadata } = prepareCapturedAnswerTrial({ ...input, mode: 'auto' });
  if (!values['--apply']) return { outcome: 'preview', protocolId: metadata.protocolId, watchCommandSent: false };
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('firestore_unavailable');
  try { return await configureWatchCalls(db, input); }
  finally { await db.terminate(); }
}

if (require.main === module) main(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => {
    const allowed = ['invalid_arguments', 'private_capture_unavailable_or_invalid', 'invalid_reference_capture',
      'device_identity_mismatch', 'change_in_progress', 'firestore_unavailable'];
    console.error(allowed.includes(error.message) ? error.message : 'Calls setup failed. Check local configuration; private details withheld.');
    process.exitCode = 1;
  });

module.exports = { main };
