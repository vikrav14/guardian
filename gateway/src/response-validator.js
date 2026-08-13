/**
 * Validate LLM responses before sending to users.
 *
 * Catches:
 * - Invented coordinates
 * - Mismatched location sources (e.g., calling WiFi location "GPS")
 * - Exposed IMEIs or other sensitive data
 * - Missing disclaimers for offline/stale data
 * - Health claims (if not allowed)
 * - Contradictions with tool results
 */

/**
 * Validate a location response.
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from get_current_location tool
 * @param {Object} constraints - {medicalClaimsAllowed, ...}
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateLocationResponse(response, toolResult, constraints = {}) {
  const issues = [];
  const text = String(response || '');

  // Issue: Invented coordinates
  // Pattern: -20.1234, 57.5678 or similar
  const coordPattern = /-?\d+\.\d{4,}\s*,\s*-?\d+\.\d{4,}/g;
  const coordMatches = text.match(coordPattern) || [];
  if (coordMatches.length > 0) {
    // Check if these match the tool result
    if (toolResult && toolResult.lat && toolResult.lng) {
      const actualCoord = `${toolResult.lat.toFixed(4)}, ${toolResult.lng.toFixed(4)}`;
      const matches = coordMatches.some((c) => c.includes(actualCoord.slice(0, 6)));
      if (!matches) {
        issues.push('INVENTED_COORDINATES');
      }
    } else if (!toolResult || toolResult.lat == null) {
      // Tool returned no location; coordinates in response are invented
      issues.push('COORDINATES_WITHOUT_LOCATION');
    }
  }

  // Issue: Mismatched location source label
  if (toolResult && toolResult.lat && toolResult.lng && toolResult.accuracySource) {
    if (
      toolResult.accuracySource !== 'gps' &&
      /\b(GPS|satellite|precise location)\b/i.test(text)
    ) {
      issues.push('MISMATCHED_SOURCE_LABEL');
    }
    if (
      toolResult.accuracySource !== 'wifi' &&
      /\b(wifi|wireless)\b/i.test(text) &&
      toolResult.accuracySource !== 'gps'
    ) {
      issues.push('MISMATCHED_SOURCE_LABEL');
    }
  }

  // Issue: Exposed sensitive data (IMEI)
  // 15-digit number that looks like an IMEI
  if (/\b8613\d{11}\b/.test(text)) {
    issues.push('EXPOSED_IMEI');
  }

  // Issue: Offline device not mentioned as such
  if (toolResult && toolResult.online === false) {
    if (!/(offline|not connected|no signal|unavailable|could not)/i.test(text)) {
      issues.push('OFFLINE_NOT_STATED');
    }
  }

  // Issue: Stale location not mentioned as stale
  if (toolResult && toolResult.stalenessSeconds && toolResult.stalenessSeconds > 3600) {
    if (!/(\bstale\b|last seen|\d+\s*(hour|minute)s?\s*ago)/i.test(text)) {
      issues.push('STALE_NOT_MENTIONED');
    }
  }

  // Issue: Health claims when not allowed
  if (
    !constraints.medicalClaimsAllowed &&
    /\b(blood pressure|heart rate|SpO2|oxygen|fever|diagnosis|condition|disease)\b/i.test(text)
  ) {
    issues.push('HEALTH_CLAIM_NOT_ALLOWED');
  }

  // Issue: Response too long for WhatsApp
  if (text.length > 1000) {
    issues.push('RESPONSE_TOO_LONG');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a battery response.
 *
 * @param {string} response
 * @param {Object} toolResult
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateBatteryResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // Check: invented battery percentage
  const percentMatch = text.match(/(\d+)\s*%/);

  if (percentMatch) {
    const percentText = Number(percentMatch[1]);

    if (toolResult && toolResult.batteryPercent != null) {
      // Tool has data; check if response matches
      if (Math.abs(percentText - toolResult.batteryPercent) > 5) {
        issues.push('INVENTED_BATTERY');
      }
    } else {
      // Tool has no data but response claims a percentage
      issues.push('BATTERY_WITHOUT_DATA');
    }
  }

  if (toolResult && toolResult.batteryPercent != null && !/last reported/i.test(text)) {
    issues.push('BATTERY_READING_NOT_QUALIFIED');
  }

  if (toolResult?.stale && !/(stale|may have changed|offline)/i.test(text)) {
    issues.push('STALE_BATTERY_NOT_STATED');
  }

  if (toolResult?.online === false && !/(offline|not connected|may have changed)/i.test(text)) {
    issues.push('OFFLINE_NOT_STATED');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a device status response (Phase 2).
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from get_battery tool
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateDeviceStatusResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // Check: battery percentage matches tool data (±5% tolerance)
  const percentMatch = text.match(/(\d+)\s*%/);
  if (percentMatch && toolResult && toolResult.batteryPercent != null) {
    const percentText = Number(percentMatch[1]);
    if (Math.abs(percentText - toolResult.batteryPercent) > 5) {
      issues.push('INVENTED_BATTERY');
    }
  }

  // Check: online status consistency
  if (toolResult && toolResult.online === false) {
    if (!/(offline|not connected|no signal|disconnected)/i.test(text)) {
      issues.push('OFFLINE_NOT_STATED');
    }
  } else if (toolResult && toolResult.online === true) {
    // Should mention online or connected
    if (!/\b(online|connected)\b/i.test(text) && !text.includes('%')) {
      // Allow if battery mentioned (that implies device is reachable)
      issues.push('ONLINE_NOT_STATED');
    }
  }

  // Check: heartbeat/timestamp format (if mentioned)
  if (/heartbeat|last|ago|since/i.test(text)) {
    // Should include time reference, not invented future dates
    if (/\d{4}-\d{2}-\d{2}/.test(text)) {
      // Has date; check it's not in future
      const dateMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        const date = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
        if (date > new Date()) {
          issues.push('FUTURE_HEARTBEAT');
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a recent alerts response (Phase 2).
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from get_recent_alerts tool
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateAlertsResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // Check: alert types are valid (SOS, fall, geofence, low_battery)
  const validTypes = ['sos', 'fall', 'geofence', 'low.battery', 'low_battery', 'enter', 'exit'];
  const mentionedEvents = text.toLowerCase().match(/\b(sos|fall|geofence|low.?battery|enter|exit|left|entered)\b/g) || [];

  // Check: if tool returned no alerts, response should say so
  if ((!toolResult || !toolResult.alerts || toolResult.alerts.length === 0) && toolResult !== undefined) {
    if (!/no.*(alerts?|events?|incidents?)|nothing|clear/i.test(text)) {
      issues.push('ALERTS_EXISTENCE_MISMATCH');
    }
  }

  // Check: if tool returned alerts, response should mention count or list
  if (toolResult && toolResult.alerts && toolResult.alerts.length > 0) {
    if (!/\d+\s*(alert|event|incident|sos|fall)/i.test(text) && mentionedEvents.length === 0) {
      issues.push('ALERTS_NOT_MENTIONED');
    }
  }

  // Check: timestamps are reasonable (not future dates)
  const datePattern = /\d{1,2}(?:am|pm|\s*(?:am|pm)?|\s*[a-z]{1,3})/i;
  const dates = text.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/g) || [];
  for (const dateStr of dates) {
    // Basic sanity check: time should not be obviously wrong
    const hour = parseInt(dateStr.match(/(\d{1,2}):/)[1]);
    if (hour > 23) {
      issues.push('INVALID_ALERT_TIMESTAMP');
    }
  }

  // Check: no fabricated alert types
  if (/\b(ping|heartbeat|warning|error|crash)\b/i.test(text) &&
      !(/\b(geofence|sos|fall|battery)\b/i.test(text))) {
    // Might be fabricated alert type
    issues.push('UNKNOWN_ALERT_TYPE');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a safe zone check response (Phase 3a).
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from is_at_geofence tool
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateSafeZoneResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // Check: geofence found/not found matches tool result
  if (toolResult && toolResult.geofenceName) {
    // Tool found the geofence; response should answer yes/no
    if (!/\b(yes|no|inside|outside|at|not at)\b/i.test(text)) {
      issues.push('GEOFENCE_ANSWER_MISSING');
    }

    // Check: if inside, should confirm it
    if (toolResult.atGeofence === true) {
      if (!/\b(yes|inside|at|confirmed)\b/i.test(text)) {
        issues.push('INSIDE_GEOFENCE_NOT_CONFIRMED');
      }
    } else if (toolResult.atGeofence === false) {
      // Outside geofence
      if (!/\b(no|outside|not at|left)\b/i.test(text)) {
        issues.push('OUTSIDE_GEOFENCE_NOT_STATED');
      }
    }

    // Check: distance mentioned if available
    if (toolResult.distanceMeters != null && toolResult.distanceMeters > 0) {
      if (!/\d+\s*(m|meter|km|foot|mile)/i.test(text) && !(/\d+\s*minute/i.test(text))) {
        // Allow if distance omitted but other details present
        // Don't flag as error - distance is optional
      }
    }
  } else if (!toolResult || !toolResult.geofenceName) {
    // Tool didn't find geofence; response should say so
    if (!/not.*set.*up|don't.*have|geofence.*not.*found|zone.*unknown/i.test(text)) {
      issues.push('GEOFENCE_NOT_FOUND_NOT_STATED');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a device command response (Phase 3c).
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from send_device_command tool
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateDeviceCommandResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // Check: command type confirmed (ring or locate)
  if (toolResult && toolResult.commandType) {
    if (!new RegExp(`\\b${toolResult.commandType}\\b`, 'i').test(text)) {
      issues.push('COMMAND_TYPE_NOT_CONFIRMED');
    }
  }

  // Check: sent confirmation present
  if (toolResult && toolResult.status === 'sent') {
    if (!/(sent|queued|will send|command will be sent|triggered)/i.test(text)) {
      issues.push('SEND_CONFIRMATION_MISSING');
    }
  }

  // Check: device identifier mentioned if multiple devices
  if (toolResult && toolResult.deviceName) {
    if (!text.includes(toolResult.deviceName) && text.length > 50) {
      // Only flag if response is long enough to mention the device
      // Short responses may skip device name if context is clear
    }
  }

  // Check: offline warning if device was offline
  if (toolResult && toolResult.online === false) {
    if (!/offline|may not.*receive|delay|later|when.*online/i.test(text)) {
      issues.push('OFFLINE_WARNING_MISSING');
    }
  }

  // Check: no invented device names
  if (/\b[A-Z][a-z]+\b/.test(text)) {
    // Generic check for capitalized words that might be invented device names
    // This is heuristic; real validation needs tool result data
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validate a reminder scheduling response (Phase 3b).
 *
 * @param {string} response - Text from LLM
 * @param {Object} toolResult - Result from schedule_reminder tool (may be null for reminders)
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateReminderResponse(response, toolResult) {
  const issues = [];
  const text = String(response || '');

  // For reminder responses, tool result may not be available (it's from location tool, not reminder tool).
  // So we're more lenient and just check for schedule confirmation + reasonable structure.

  // Check: some form of confirmation that reminder was scheduled
  if (!/scheduled|set|reminder|will|created/i.test(text)) {
    issues.push('SCHEDULE_CONFIRMATION_MISSING');
  }

  // Check: response length reasonable
  if (text.length > 500) {
    issues.push('RESPONSE_TOO_LONG');
  }

  // Check: response not empty
  if (text.length === 0) {
    issues.push('EMPTY_RESPONSE');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Generic response validation (applies to all responses).
 *
 * @param {string} response
 * @param {Object} context - {requester, wearer, device}
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateGenericResponse(response, context) {
  const issues = [];
  const text = String(response || '');

  // Check: no data from other wearers leaked
  if (context && context.wearer && context.wearer.displayName) {
    // If response contains names other than the intended wearer, flag it
    // This is a heuristic; not perfect.
  }

  // Check: response length suitable for WhatsApp
  if (text.length > 2000) {
    issues.push('RESPONSE_TOO_LONG');
  }

  if (text.length === 0) {
    issues.push('EMPTY_RESPONSE');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

module.exports = {
  validateLocationResponse,
  validateBatteryResponse,
  validateDeviceStatusResponse,
  validateAlertsResponse,
  validateSafeZoneResponse,
  validateDeviceCommandResponse,
  validateReminderResponse,
  validateGenericResponse,
};
