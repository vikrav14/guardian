'use strict';

// This is the gateway process, not a client of another running gateway.
if (process.argv.length > 2) {
  console.error('Usage: npm run wear:wire-capture (in place of npm start)');
  process.exitCode = 1;
} else {
  console.log('[wear-wire-capture] Starting the gateway with a five-minute incoming-byte capture. Stop the previous gateway first; keep ngrok running.');
  process.env.GUARDIAN_WEAR_WIRE_CAPTURE = '1';
  require('../src/server');
}
