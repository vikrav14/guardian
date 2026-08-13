const GUARDIAN_FUNCTIONAL_INTENTS = new Set([
  'LOCATION_REQUEST',
  'DEVICE_STATUS',
  'RECENT_ALERTS',
  'JOURNEY_QUERY',
  'DAILY_SUMMARY',
  'DEVICE_COMMAND',
  'VOICE_MONITOR',
  'REMINDER_REQUEST',
  'SAFE_ZONE_CHECK',
]);

const SCOPE_REPLY =
  "I'm Guardian, your family-safety assistant. I can help with a wearer's location, watch status and battery, safe zones, alerts, journeys, reminders, and watch safety commands.";

function decideInboundRoute(intent = {}) {
  const type = String(intent.type || 'UNCLEAR');

  if (type === 'CRITICAL') {
    return {
      route: 'critical',
      allowAssistant: false,
      reply: null,
      reason: 'critical_safety_path',
    };
  }

  if (GUARDIAN_FUNCTIONAL_INTENTS.has(type)) {
    return {
      route: 'guardian',
      allowAssistant: true,
      reply: null,
      reason: 'guardian_functional_intent',
    };
  }

  // GENERAL_HELP, UNCLEAR, EMPTY and any future unknown intent stay deterministic.
  // This is deliberate cost control: Guardian WhatsApp is not a general chatbot.
  return {
    route: 'scope_reply',
    allowAssistant: false,
    reply: SCOPE_REPLY,
    reason: 'outside_guardian_scope',
  };
}

function normalizeProfileType(value) {
  const profile = String(value || '').trim().toLowerCase();
  if (['child', 'kid', 'kids'].includes(profile)) return 'child';
  if (['elderly', 'senior', 'elder'].includes(profile)) return 'elderly';
  return 'general';
}

function highSeverity(value) {
  return ['high', 'severe', 'critical', 'extreme'].includes(
    String(value || '').trim().toLowerCase()
  );
}

function sendDecision({
  priority,
  reason,
  templateKey,
  requiredContext = [],
}) {
  return {
    sendWhatsApp: true,
    channel: 'whatsapp',
    priority,
    reason,
    templateKey,
    requiredContext,
  };
}

function appOnly(reason) {
  return {
    sendWhatsApp: false,
    channel: 'app',
    priority: 'P2',
    reason,
    templateKey: null,
    requiredContext: [],
  };
}

/**
 * Decide whether a proactive event deserves to interrupt the family on WhatsApp.
 *
 * This function is deliberately pure and cost-aware. It does not send anything.
 * Routine events remain app/push notifications.
 */
function decideProactiveWhatsApp(candidate = {}) {
  const type = String(candidate.type || '').trim().toLowerCase();
  const profileType = normalizeProfileType(candidate.profileType);

  // P0: non-negotiable emergency paths.
  if (type === 'sos') {
    return sendDecision({
      priority: 'P0',
      reason: 'sos_non_negotiable',
      templateKey: 'guardian_sos_v1',
      requiredContext: [
        'wearerName',
        'eventTime',
        'placeLabel',
        'location',
        'mapsUrl',
        'locationFreshness',
        'online',
        'batteryPercent',
      ],
    });
  }

  if (type === 'fall' && candidate.confirmed !== false) {
    return sendDecision({
      priority: 'P0',
      reason: 'confirmed_fall',
      templateKey: 'guardian_fall_v1',
      requiredContext: [
        'wearerName',
        'eventTime',
        'placeLabel',
        'location',
        'mapsUrl',
        'locationFreshness',
        'online',
        'batteryPercent',
      ],
    });
  }

  // P1: service availability is disappearing while the wearer is away.
  if (
    type === 'watch_offline' &&
    candidate.awayFromSafeZone === true &&
    Number(candidate.offlineMinutes || 0) >= 15
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'offline_while_away',
      templateKey: 'guardian_offline_away_v1',
      requiredContext: [
        'wearerName',
        'offlineMinutes',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
        'batteryPercent',
      ],
    });
  }

  if (
    type === 'critical_battery' &&
    candidate.awayFromSafeZone === true &&
    Number(candidate.batteryPercent) <= 15
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'critical_battery_while_away',
      templateKey: 'guardian_critical_battery_away_v1',
      requiredContext: [
        'wearerName',
        'batteryPercent',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  // P1: external danger must materially affect this wearer, not just exist nearby.
  if (
    type === 'environmental_danger' &&
    candidate.affectsWearer === true &&
    highSeverity(candidate.severity)
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'serious_environmental_danger_affects_wearer',
      templateKey: 'guardian_environmental_danger_v1',
      requiredContext: [
        'wearerName',
        'hazardType',
        'hazardSummary',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  // Child-specific escalation candidates.
  if (
    profileType === 'child' &&
    type === 'safe_zone_exit' &&
    candidate.unexpected === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'child_unexpected_safe_zone_departure',
      templateKey: 'guardian_child_unexpected_departure_v1',
      requiredContext: [
        'wearerName',
        'safeZoneName',
        'eventTime',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  if (
    profileType === 'child' &&
    type === 'missed_expected_arrival' &&
    candidate.missedExpectedArrival === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'child_missed_expected_arrival',
      templateKey: 'guardian_child_missed_arrival_v1',
      requiredContext: [
        'wearerName',
        'expectedZoneName',
        'minutesLate',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
        'online',
        'batteryPercent',
      ],
    });
  }

  if (
    profileType === 'child' &&
    type === 'prolonged_stop' &&
    candidate.awayFromSafeZone === true &&
    candidate.unusual === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'child_unusual_prolonged_stop',
      templateKey: 'guardian_child_prolonged_stop_v1',
      requiredContext: [
        'wearerName',
        'stopMinutes',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  // Elderly-specific escalation candidates.
  if (
    profileType === 'elderly' &&
    type === 'safe_zone_exit' &&
    candidate.unusual === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'elderly_unusual_safe_zone_departure',
      templateKey: 'guardian_elderly_unusual_departure_v1',
      requiredContext: [
        'wearerName',
        'safeZoneName',
        'eventTime',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  if (
    profileType === 'elderly' &&
    type === 'prolonged_absence' &&
    candidate.unusual === true &&
    candidate.awayFromSafeZone === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'elderly_unusual_prolonged_absence',
      templateKey: 'guardian_elderly_prolonged_absence_v1',
      requiredContext: [
        'wearerName',
        'awayMinutes',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
        'online',
        'batteryPercent',
      ],
    });
  }

  if (
    profileType === 'elderly' &&
    type === 'prolonged_stop' &&
    candidate.awayFromSafeZone === true &&
    candidate.unusual === true
  ) {
    return sendDecision({
      priority: 'P1',
      reason: 'elderly_unusual_prolonged_stop',
      templateKey: 'guardian_elderly_prolonged_stop_v1',
      requiredContext: [
        'wearerName',
        'stopMinutes',
        'placeLabel',
        'mapsUrl',
        'locationFreshness',
      ],
    });
  }

  // Ordinary geofence transitions, ordinary battery/status updates and normal
  // journeys belong in the app. WhatsApp is an escalation channel, not a feed.
  return appOnly('routine_or_non_actionable_event');
}

module.exports = {
  GUARDIAN_FUNCTIONAL_INTENTS,
  SCOPE_REPLY,
  decideInboundRoute,
  decideProactiveWhatsApp,
  normalizeProfileType,
};
