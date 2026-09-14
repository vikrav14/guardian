'use strict';
const fs = require('node:fs');
const config = require('../src/config');
const { JourneyJournal } = require('../src/journey-journal');

function inspect(journal, imei) {
  const data = journal.read(imei), counts = {};
  for (const p of Object.values(data.points)) counts[p.status] = (counts[p.status] || 0) + 1;
  return { outcome: 'read_only', activeJourney: Boolean(data.checkpoint?.currentJourney),
    activePoints: data.checkpoint?.currentJourney?.points?.length || 0,
    pendingJourneyWrites: Object.keys(data.outbox).length, gpsEvidence: counts,
    pendingHistoricalGps: (counts.recorded || 0) + (counts.historical || 0),
    latestGpsAt: Object.values(data.points).map(p => p.point.recordedAt).sort().at(-1) || null };
}
if (require.main === module) {
  try {
    if (!fs.existsSync(config.journeyJournalDirectory)) console.log(JSON.stringify({ outcome: 'journal_not_created', enabled: config.journeyJournalEnabled }));
    else {
      const imei = process.argv[2] || config.wifiHomePilotImei;
      if (!/^\d{15}$/.test(imei || '')) throw new Error('Supply a 15-digit IMEI or configure the existing pilot.');
      console.log(JSON.stringify(inspect(new JourneyJournal(config.journeyJournalDirectory), imei), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { inspect };
