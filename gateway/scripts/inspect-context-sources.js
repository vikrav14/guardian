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

function formatMauritiusDate(value) {
  if (!value) return 'time not supplied';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Indian/Mauritius',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function buildDefiMediaReview(items = []) {
  const sorted = [...items].sort((a, b) => (
    String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
  ));
  const actionable = (item) => item.actionable ?? (item.safetyCandidate && item.fresh);
  return {
    candidates: sorted.filter(actionable),
    safetyExcluded: sorted.filter((item) => (
      !actionable(item)
      && (item.matchedEventTypes || []).length > 0
    )),
    otherNews: sorted.filter((item) => (
      !actionable(item)
      && (item.matchedEventTypes || []).length === 0
    )),
  };
}

function friendlyDecision(item) {
  const actionable = item.actionable ?? (item.safetyCandidate && item.fresh);
  if (actionable) {
    const scope = item.placeMentions?.length
      ? `recognised place: ${item.placeMentions.join(', ')}`
      : 'explicit Mauritius-wide wording';
    return `Guardian review candidate — ${item.eventType}; ${scope}.`;
  }
  if (item.safetyCandidate && !actionable) {
    return 'Not current — outside the event-specific actionability window.';
  }
  if (item.reason === 'no_mauritius_location_signal') {
    return 'Excluded — safety wording found, but no Mauritius place or Mauritius-wide scope.';
  }
  if (item.reason === 'excluded_editorial_section') {
    return 'Excluded — editorial section is outside Guardian safety monitoring.';
  }
  return 'Not applicable — no supported Guardian safety signal in the RSS title or summary.';
}

function formatDefiMediaReview(items = []) {
  const review = buildDefiMediaReview(items);
  const lines = [
    '',
    'All Defi Media RSS articles — human review',
    '==========================================',
    `Total: ${items.length} | Guardian candidates: ${review.candidates.length} | Safety-related but excluded: ${review.safetyExcluded.length} | Other news: ${review.otherNews.length}`,
    'These are RSS headline decisions only. No article was opened and no user impact was inferred.',
  ];

  const appendSection = (title, sectionItems) => {
    lines.push('', `${title} (${sectionItems.length})`, '-'.repeat(Math.min(72, title.length + 8)));
    if (!sectionItems.length) {
      lines.push('None.');
      return;
    }
    sectionItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`   Published:  ${formatMauritiusDate(item.publishedAt)} MUT`);
      if (item.actionableUntil) {
        lines.push(`   Relevant until: ${formatMauritiusDate(item.actionableUntil)} MUT`);
      }
      lines.push(`   Categories: ${(item.categories || []).join(', ') || 'not supplied'}`);
      lines.push(`   Decision:   ${friendlyDecision(item)}`);
      if (item.placeMentions?.length) {
        lines.push(`   Places:     ${item.placeMentions.join(', ')}`);
      }
      if ((item.matchedEventTypes || []).length) {
        lines.push(`   Signals:    ${item.matchedEventTypes.join(', ')}`);
      }
      lines.push(`   Source:     ${item.sourceUrl}`);
    });
  };

  appendSection('A. Guardian review candidates', review.candidates);
  appendSection('B. Safety-related headlines excluded', review.safetyExcluded);
  appendSection('C. Other RSS news', review.otherNews);
  return lines.join('\n');
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
  console.log('Delivery:     observe-only matching (no automatic WhatsApp)');
  if (defiMediaPoll.error) console.log(`Error:        ${defiMediaPoll.error}`);
  if (hasFlag('--all') || hasFlag('--all-news')) {
    console.log(formatDefiMediaReview(defiMediaPoll.items));
  } else {
    for (const item of defiMediaPoll.candidateItems.slice(0, 10)) {
      console.log('');
      console.log(`- [${item.eventType}] ${item.title}`);
      console.log(`  Published: ${formatDate(item.publishedAt)}`);
      console.log(`  Places:    ${item.placeMentions.join(', ') || 'not resolved'}`);
      console.log(`  Source:    ${item.sourceUrl}`);
    }
  }
  if (!capPoll.ok || !defiMediaPoll.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Context source inspection failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDefiMediaReview,
  formatDefiMediaReview,
  formatMauritiusDate,
  friendlyDecision,
};
