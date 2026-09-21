'use strict';

// Run in place of npm start, in the gateway tab. The process-local opt-in lasts
// ten minutes; no .env setting, device command or customer flag is changed.
if (process.argv.length > 2) {
  console.error('Usage: npm run temperature:capture (in place of npm start)');
  process.exitCode = 1;
} else {
  process.env.GUARDIAN_TEMPERATURE_CAPTURE = '1';
  require('../src/server');
}
