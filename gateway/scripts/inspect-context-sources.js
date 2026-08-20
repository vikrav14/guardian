#!/usr/bin/env node

/** Read-only health check for Guardian's official context sources. */

const config = require('../src/config');
const { CapAlertProvider } = require('../src/context/capAlertProvider');

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function formatDate(value) {
  if (!value) return 'not supplied';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

async function main() {
  const provider = new CapAlertProvider(config);
  const poll = await provider.poll();
  const snapshot = provider.getSnapshot();
  const report = {
    readOnly: true,
    observeOnly: true,
    automaticDelivery: false,
    poll: {
      ok: poll.ok,
      notModified: poll.notModified,
      error: poll.error || null,
      alertsSeen: poll.alerts.length,
      activeAlerts: poll.activeAlerts.length,
      changedAlerts: poll.changedAlerts.length,
    },
    source: snapshot,
  };

  if (hasFlag('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Guardian Official Context Sources');
  console.log('=================================');
  console.log(`Source:       ${snapshot.source.name}`);
  console.log(`Authority:    ${snapshot.source.authority}`);
  console.log(`Feed:         ${snapshot.source.feedUrl}`);
  console.log(`Poll:         ${poll.ok ? 'OK' : 'FAILED'}`);
  console.log(`Last success: ${formatDate(snapshot.lastSuccessAt)}`);
  console.log(`Alerts seen:  ${poll.alerts.length}`);
  console.log(`Active now:   ${poll.activeAlerts.length}`);
  console.log('Delivery:     observe-only (no automatic WhatsApp)');
  if (poll.error) console.log(`Error:        ${poll.error}`);
  for (const alert of poll.activeAlerts) {
    console.log('');
    console.log(`- ${alert.headline || alert.event}`);
    console.log(`  ${alert.severity}/${alert.urgency}/${alert.certainty}`);
    console.log(`  Effective: ${formatDate(alert.effectiveAt)}`);
    console.log(`  Expires:   ${formatDate(alert.expiresAt)}`);
    console.log(`  Areas:     ${(alert.areas || []).map((area) => area.description).join('; ') || 'not supplied'}`);
  }
  if (!poll.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Context source inspection failed: ${error.message}`);
  process.exitCode = 1;
});
