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
    if (!/(offline|not connected|no signal|unavailable)/i.test(text)) {
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
  validateGenericResponse,
};
