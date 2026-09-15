'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Local pilot diagnostic state only: no temperatures or wearer acceptance.
// Keep the exclusion across gateway restarts and reconnects. There is no timer:
// only an explicit, successfully dispatched worn trial resumes normal intake.
function createTemperatureTrialQuarantine({ pilotImei, directory = path.join(__dirname, '../data/temperature-trials'), fileSystem = fs } = {}) {
  const configured = /^\d{15}$/.test(pilotImei || '');
  const marker = configured ? path.join(directory, `${pilotImei}.quarantine`) : null;
  let cleanupFailed = false;
  function isSuppressed() {
    if (cleanupFailed) return true;
    if (!marker) return false;
    try { fileSystem.statSync(marker); return true; }
    catch (error) { return error.code !== 'ENOENT'; }
  }
  function suppress() {
    if (!marker) throw new Error('A configured pilot is required for temperature trial exclusion.');
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fileSystem.writeFileSync(marker, '', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  function resume() {
    if (!marker) return;
    try { fileSystem.unlinkSync(marker); }
    catch (error) {
      if (error.code !== 'ENOENT') { cleanupFailed = true; throw error; }
    }
    cleanupFailed = false;
  }
  function excludes(imei) { return imei === pilotImei && isSuppressed(); }
  function markEvents(events) {
    for (const event of events) {
      if (event.type === 'health_reading' && event.metric === 'skin_temperature' && excludes(event.imei)) {
        event.temperatureTrialOnly = true;
      }
    }
  }
  return { isSuppressed, suppress, resume, excludes, markEvents };
}

module.exports = { createTemperatureTrialQuarantine };
