'use strict';

// Replaces npm start for one diagnostic run. No persistent .env change and no
// additional watch command. Expiry stops capture only; the gateway stays live.
if (process.argv.length > 2) {
  console.error('Usage: npm run wear:capture (in place of npm start)');
  process.exitCode = 1;
} else {
  process.env.GUARDIAN_WEAR_CAPTURE = '1';
  require('../src/server');
}
