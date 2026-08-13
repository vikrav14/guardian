const { formatAge } = require('./battery-freshness');

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function formatDailySummaryReply(result) {
  if (!result || result.error) {
    return 'I could not retrieve the daily summary right now. Try again in a moment.';
  }
  const name = result.name || 'Your loved one';
  const period = result.periodLabel || 'today';
  const distance = Math.round((Number(result.distanceKm) || 0) * 10) / 10;
  const lines = [`*${name} — ${period}:*`];

  lines.push(
    result.journeyCount > 0
      ? `• ${plural(result.journeyCount, 'confirmed journey')} · ${distance} km recorded`
      : '• No confirmed journeys recorded',
  );

  if (result.criticalAlertCount > 0) {
    lines.push(`• ${plural(result.criticalAlertCount, 'SOS/fall alert')}`);
  } else if (result.safeZoneEventCount > 0) {
    const criticalText = result.alertCoverageComplete === false
      ? 'no SOS/fall alerts in the most recent checked records'
      : 'no SOS/fall alerts';
    lines.push(`• ${plural(result.safeZoneEventCount, 'safe-zone update')} · ${criticalText}`);
  } else {
    lines.push(
      result.alertCoverageComplete === false
        ? '• No SOS, fall, or safe-zone alerts in the most recent checked records'
        : '• No SOS, fall, or safe-zone alerts recorded',
    );
  }

  const age = formatAge(result.batteryAgeSeconds);
  if (result.batteryPercent == null) {
    lines.push(`• Watch ${result.online ? 'online' : 'offline'} · no battery reading available`);
  } else {
    const warning = result.batteryStale ? ' · reading may be stale' : '';
    lines.push(
      `• Watch ${result.online ? 'online' : 'offline'} · battery last reported ${Math.round(result.batteryPercent)}%${age ? ` ${age}` : ''}${warning}`,
    );
  }
  if (Number(result.omittedLowQualityCount) > 0) {
    lines.push('_Low-quality movement records were omitted._');
  }
  return lines.join('\n');
}

module.exports = { formatDailySummaryReply };
