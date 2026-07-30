/**
 * Build minimal context packet for LLM per Master Context section 12.
 *
 * Do not send full device docs or unnecessary history.
 * Sends only what the LLM needs to answer safely.
 */

/**
 * Build a minimal context packet.
 *
 * @param {Object} params
 * @param {string} params.requestId - Request correlation ID
 * @param {Object} params.requester - {uid, displayName, role, linkedImeis}
 * @param {Object} params.wearer - {id, displayName, profileType}
 * @param {Object} params.device - {imei, online, batteryPercent, location}
 * @param {Object} params.intent - Result from classifyIntent()
 * @param {string} params.locale - Language code (en, fr, mfe)
 * @returns {Object} Context packet
 */
function buildContextPacket({
  requestId,
  requester,
  wearer,
  device,
  intent,
  locale = 'en',
}) {
  return {
    requestId,
    mode: 'guardian',
    locale,
    requester: {
      uid: requester.uid,
      displayName: requester.displayName,
      role: requester.role || 'guardian',
      permissions: ['location.read'], // Will expand per Master Context section 10
    },
    wearer: {
      wearerId: wearer?.id,
      displayName: wearer?.displayName,
      profileType: wearer?.profileType || 'unknown',
    },
    currentStateSummary: {
      online: device?.online || false,
      batteryPercent: device?.batteryPercent,
      lastHeartbeat: device?.lastHeartbeatAt,
      activeIncident: false, // Will expand in Phase 2
    },
    allowedTools: selectAllowedTools(intent),
    conversationSummary: intent?.type || 'UNCLEAR',
    constraints: {
      maxResponseSentences: 3,
      medicalClaimsAllowed: false,
      inIncidentMode: false,
    },
  };
}

/**
 * Select which tools to offer based on intent.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {string[]} Tool names
 */
function selectAllowedTools(intent) {
  if (!intent) return ['list_devices'];

  const tools = [];

  // Always allow device list
  tools.push('list_devices');

  // Location tools for location requests
  if (intent.type === 'LOCATION_REQUEST' || intent.type === 'SAFE_ZONE_CHECK') {
    tools.push('get_last_location');
    if (intent.type === 'SAFE_ZONE_CHECK') {
      tools.push('is_at_geofence');
    }
  }

  // Status tools for device status requests
  if (intent.type === 'DEVICE_STATUS') {
    tools.push('get_battery');
    tools.push('get_device_intelligence');
  }

  // Alerts for general help
  if (intent.type === 'GENERAL_HELP') {
    tools.push('get_recent_alerts');
  }

  // During critical/urgent
  if (intent.type === 'CRITICAL') {
    // Critical intent: may not use LLM at all (handled earlier)
    // But if we reach here, offer essential tools only
    tools.push('get_last_location');
    tools.push('get_recent_alerts');
  }

  return tools;
}

/**
 * Build system prompt based on context.
 *
 * Keep brief, focused on constraints.
 *
 * @param {Object} context - Result from buildContextPacket()
 * @returns {string} System prompt
 */
function buildSystemPrompt(context) {
  return `You are Guardian, a calm family safety assistant for Mauritius.
You help families check on loved ones via WhatsApp.
Be brief (${context.constraints.maxResponseSentences} short sentences max).
Use tools to answer with real data.
Report tool facts only — never invent coordinates, battery %, or health readings.
🚨 CRITICAL: Always use placeLabel from location tool if available — it's the recorded location name from the device, more accurate than guessing from coordinates.
If a watch is offline, say so clearly.
Always mention battery % and online status when you provide location data.
Include maps URLs when you have location data.
Speak naturally using place names (e.g., "Lower Vale", "Quatre Bornes"), not raw coordinates.
If tools fail, say you could not reach live data.`;
}

module.exports = {
  buildContextPacket,
  selectAllowedTools,
  buildSystemPrompt,
};
