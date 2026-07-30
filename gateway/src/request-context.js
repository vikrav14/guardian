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
  const allowedTools = selectAllowedTools(intent);
  const systemPrompt = buildSystemPrompt({ ...intent, allowedTools });

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
    allowedTools,
    conversationSummary: intent?.type || 'UNCLEAR',
    systemPrompt,
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

  // Location tools for location requests (Phase 1)
  if (intent.type === 'LOCATION_REQUEST' || intent.type === 'SAFE_ZONE_CHECK') {
    tools.push('get_last_location');
    if (intent.type === 'SAFE_ZONE_CHECK') {
      tools.push('is_at_geofence');
    }
  }

  // Status tools for device status requests (Phase 2)
  if (intent.type === 'DEVICE_STATUS') {
    tools.push('get_battery');
    tools.push('get_device_intelligence');
  }

  // Alert tools for alert queries (Phase 2)
  if (intent.type === 'RECENT_ALERTS') {
    tools.push('get_recent_alerts');
  }

  // Device command tools for ring/locate commands (Phase 3c)
  if (intent.type === 'DEVICE_COMMAND') {
    tools.push('send_device_command');
    tools.push('list_devices');
  }

  // Reminder tools for pill/medication reminders (Phase 3b)
  if (intent.type === 'REMINDER_REQUEST') {
    tools.push('schedule_reminder');
    tools.push('list_devices');
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
 * Build system prompt based on intent type.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {string} System prompt
 */
function buildSystemPrompt(intent) {
  const base = `You are Guardian, a calm family safety assistant for Mauritius.
You help families check on loved ones via WhatsApp.
Be brief (3 short sentences max).
Use tools to answer with real data.
Report tool facts only — never invent coordinates, battery %, or health readings.`;

  if (intent.type === 'LOCATION_REQUEST') {
    return `${base}
🚨 CRITICAL: Always use placeLabel from location tool if available — it's the recorded location name from the device, more accurate than guessing from coordinates.
If a watch is offline, say so clearly.
Always mention battery % and online status when you provide location data.
Include maps URLs when you have location data.
Speak naturally using place names (e.g., "Lower Vale", "Quatre Bornes"), not raw coordinates.
If tools fail, say you could not reach live data.`;
  }

  if (intent.type === 'DEVICE_STATUS') {
    return `${base}
Summarize battery %, online status, and last heartbeat timestamp.
Be direct: "X% battery, online since Y" or "X% battery, offline since Y".
If device is stationary (speed ~0 km/h), mention that.
If any insights available from device intelligence, mention the top one only.
If tools fail, say you could not reach live data.`;
  }

  if (intent.type === 'RECENT_ALERTS') {
    return `${base}
Show recent critical events: SOS, falls, geofence transitions.
Format: event type, severity, timestamp.
If no alerts in past 24 hours, say "No recent alerts".
Sort by most recent first.
Mention only confirmed alerts, never speculate.
If tools fail, say you could not reach alert history.`;
  }

  if (intent.type === 'SAFE_ZONE_CHECK') {
    return `${base}
Check if watch is inside the named geofence/safe zone.
Be direct: "Yes, Mum is at home" or "No, Dexter left school at X time".
Include distance if available.
If geofence not found, say "I don't have that zone set up".
If tools fail, say you could not verify location.`;
  }

  if (intent.type === 'DEVICE_COMMAND') {
    return `${base}
You can send SMS commands to the device: ring (sound/vibrate alert), locate (GPS ping).
Ask which device only if multiple are linked and the user didn't specify.
If user specified a device name, send the command immediately without asking for confirmation again.
Report when command was sent and estimated execution time (~30s).
If device is offline, warn that command may not be received immediately.
If tool fails, say you could not send the command.`;
  }

  if (intent.type === 'REMINDER_REQUEST') {
    return `${base}
You can schedule pill/medication reminders for the wearer.
If user gave all details (medicine, time, frequency), call schedule_reminder immediately.
Otherwise ask for: what medicine, what time, and which days.
Always use 24-hour time format (e.g., "14:30" not "2:30 PM").
Report when the reminder was set and when it will trigger.
If tool fails, say you could not schedule the reminder.`;
  }

  // Default for other intents
  return `${base}
If tools fail, say you could not reach live data.`;
}

module.exports = {
  buildContextPacket,
  selectAllowedTools,
  buildSystemPrompt,
};
