'use strict';

// Replace npm start for one private diagnostic run. The existing packet census
// distinguishes missing sensor uploads from a disconnected watch. Both captures
// expire independently; the gateway continues. No watch command is added.
if (process.argv.length > 2) {
  console.error('Usage: npm run wear:sensor-capture (in place of npm start)');
  process.exitCode = 1;
} else {
  process.env.GUARDIAN_WEAR_CAPTURE = '1';
  process.env.GUARDIAN_WEAR_SENSOR_CAPTURE = '1';
  require('../src/server');
}
