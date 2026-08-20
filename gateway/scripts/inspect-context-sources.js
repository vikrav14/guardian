#!/usr/bin/env node

/** Read-only health check for Guardian's official context sources. */

const config = require('../src/config');
const { CapAlertProvider } = require('../src/context/capAlertProvider');
const { DefiMediaRssProvider } = require('../src/context/defiMediaRssProvider');

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function formatDate(value) {
  if (!value) return 'not supplied';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

async function main() {
  const capProvider = new CapAlertProvider(config);
  const defiMediaProvider = new DefiMediaRssProvider(config);
  const [capPoll, defiMediaPoll] = await Promise.all([
    capProvider.poll(),
    defiMediaProvider.poll(),
  ]);
  const capSnapshot = capProvider.getSnapshot();
  const defiMediaSnapshot = defiMediaProvider.getSnapshot();
  const report = {
    readOnly: true,
    observeOnly: true,
    automaticDelivery: false,
    sources: {
      cap: {
        poll: {
          ok: capPoll.ok,
          notModified: capPoll.notModified,
          error: capPoll.error || null,
          alertsSeen: capPoll.alerts.length,
          activeAlerts: capPoll.activeAlerts.length,
          changedAlerts: capPoll.changedAlerts.length,
        },
        source: capSnapshot,
      },
      defiMedia: {
        poll: {
          ok: defiMediaPoll.ok,
          notModified: defiMediaPoll.notModified,
          error: defiMediaPoll.error || null,
          itemsSeen: defiMediaPoll.items.length,
          changedItems: defiMediaPoll.changedItems.length,
          freshCandidates: defiMediaPoll.candidateItems.length,
          changedCandidates: defiMediaPoll.changedCandidates.length,
        },
        source: defiMediaSnapshot,
      },
    },
  };

  if (hasFlag('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Guardian Official Context Sources');
  console.log('=================================');
  console.log(`Source:       ${capSnapshot.source.name}`);
  console.log(`Authority:    ${capSnapshot.source.authority}`);
  console.log(`Feed:         ${capSnapshot.source.feedUrl}`);
  console.log(`Poll:         ${capPoll.ok ? 'OK' : 'FAILED'}`);
  console.log(`Last success: ${formatDate(capSnapshot.lastSuccessAt)}`);
  console.log(`Alerts seen:  ${capPoll.alerts.length}`);
  console.log(`Active now:   ${capPoll.activeAlerts.length}`);
  console.log('Delivery:     observe-only (no automatic WhatsApp)');
  if (capPoll.error) console.log(`Error:        ${capPoll.error}`);
  for (const alert of capPoll.activeAlerts) {
    console.log('');
    console.log(`- ${alert.headline || alert.event}`);
    console.log(`  ${alert.severity}/${alert.urgency}/${alert.certainty}`);
    console.log(`  Effective: ${formatDate(alert.effectiveAt)}`);
    console.log(`  Expires:   ${formatDate(alert.expiresAt)}`);
    console.log(`  Areas:     ${(alert.areas || []).map((area) => area.description).join('; ') || 'not supplied'}`);
  }

  console.log('');
  console.log('Defi Media local-awareness shadow');
  console.log('=================================');
  console.log(`Source:       ${defiMediaSnapshot.source.name}`);
  console.log(`Authority:    ${defiMediaSnapshot.source.authority}`);
  console.log(`Feed:         ${defiMediaSnapshot.source.feedUrl}`);
  console.log(`Poll:         ${defiMediaPoll.ok ? 'OK' : 'FAILED'}`);
  console.log(`Last success: ${formatDate(defiMediaSnapshot.lastSuccessAt)}`);
  console.log(`Items seen:   ${defiMediaPoll.items.length}`);
  console.log(`Candidates:   ${defiMediaPoll.candidateItems.length}`);
  console.log('Delivery:     observe-only (no device matching or automatic WhatsApp)');
  if (defiMediaPoll.error) console.log(`Error:        ${defiMediaPoll.error}`);
  for (const item of defiMediaPoll.candidateItems.slice(0, 10)) {
    console.log('');
    console.log(`- [${item.eventType}] ${item.title}`);
    console.log(`  Published: ${formatDate(item.publishedAt)}`);
    console.log(`  Places:    ${item.placeMentions.join(', ') || 'not resolved'}`);
    console.log(`  Source:    ${item.sourceUrl}`);
  }
  if (!capPoll.ok || !defiMediaPoll.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Context source inspection failed: ${error.message}`);
  process.exitCode = 1;
});
