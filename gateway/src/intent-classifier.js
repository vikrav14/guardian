/**
 * Deterministic intent classification for WhatsApp input.
 *
 * No LLM call required. Returns structured intent + urgency.
 * Used to decide whether to route to Gemini or handle immediately.
 *
 * Examples:
 *   "Where is Mum?" → {type: 'LOCATION_REQUEST', urgency: 3, confidence: 0.90}
 *   "SOS!" → {type: 'CRITICAL', urgency: 9, confidence: 0.95}
 *   "Hello" → {type: 'UNCLEAR', urgency: 1, confidence: 0.0}
 */

const KEYWORDS = {
  CRITICAL: ['sos', 'help', 'emergency', 'urgent', 'danger', 'hospital', 'police'],
  LOCATION: ['where', 'locate', 'at', 'location', 'position', 'find', 'track'],
  DEVICE_STATUS: ['battery', 'signal', 'online', 'check', 'status', 'connected', 'heartbeat'],
  RECENT_ALERTS: ['alert', 'alerts', 'fall', 'geofence', 'event', 'incident', 'trigger'],
  DEVICE_COMMAND: ['ring', 'locate', 'vibrate', 'alarm', 'sound', 'trigger', 'activate', 'send command'],
  REMINDER: ['reminder', 'medicine', 'pill', 'medication', 'remember', 'remind', 'remind me', 'schedule'],
  SAFE_ZONE: ['home', 'school', 'work', 'zone'],
  GENERAL_HELP: ['help', 'please', 'can you', 'how', 'what', 'who'],
};

/**
 * Classify a WhatsApp message intent.
 *
 * @param {string} text - User message
 * @returns {{
 *   type: string,
 *   urgency: number (0-10),
 *   confidence: number (0-1),
 *   matchedKeywords: string[]
 * }}
 */
function classifyIntent(text) {
  const lower = String(text || '').toLowerCase().trim();

  if (!lower) {
    return {
      type: 'EMPTY',
      urgency: 0,
      confidence: 1.0,
      matchedKeywords: [],
    };
  }

  // Check urgency first (highest priority)
  const criticalMatch = findKeywordMatch(lower, KEYWORDS.CRITICAL);
  if (criticalMatch.found) {
    return {
      type: 'CRITICAL',
      urgency: 9,
      confidence: 0.95,
      matchedKeywords: criticalMatch.keywords,
    };
  }

  // Safe zone (before general location, since "at home" is more specific)
  const zoneMatch = findKeywordMatch(lower, KEYWORDS.SAFE_ZONE);
  if (zoneMatch.found && /\bat\b/.test(lower)) {
    return {
      type: 'SAFE_ZONE_CHECK',
      urgency: 2,
      confidence: 0.85,
      matchedKeywords: zoneMatch.keywords,
    };
  }

  // Location request
  const locationMatch = findKeywordMatch(lower, KEYWORDS.LOCATION);
  if (locationMatch.found) {
    return {
      type: 'LOCATION_REQUEST',
      urgency: 3,
      confidence: 0.90,
      matchedKeywords: locationMatch.keywords,
    };
  }

  // Recent alerts (check before device status, requires explicit alert/event keyword)
  const alertMatch = findKeywordMatch(lower, KEYWORDS.RECENT_ALERTS);
  if (alertMatch.found) {
    return {
      type: 'RECENT_ALERTS',
      urgency: 5,
      confidence: 0.90,
      matchedKeywords: alertMatch.keywords,
    };
  }

  // Device command (ring, locate, etc — more urgent than reminders)
  const commandMatch = findKeywordMatch(lower, KEYWORDS.DEVICE_COMMAND);
  if (commandMatch.found) {
    return {
      type: 'DEVICE_COMMAND',
      urgency: 6,
      confidence: 0.90,
      matchedKeywords: commandMatch.keywords,
    };
  }

  // Device status
  const statusMatch = findKeywordMatch(lower, KEYWORDS.DEVICE_STATUS);
  if (statusMatch.found) {
    return {
      type: 'DEVICE_STATUS',
      urgency: 2,
      confidence: 0.85,
      matchedKeywords: statusMatch.keywords,
    };
  }

  // Reminder/medication
  const reminderMatch = findKeywordMatch(lower, KEYWORDS.REMINDER);
  if (reminderMatch.found) {
    return {
      type: 'REMINDER_REQUEST',
      urgency: 4,
      confidence: 0.85,
      matchedKeywords: reminderMatch.keywords,
    };
  }

  // Generic help request
  const helpMatch = findKeywordMatch(lower, KEYWORDS.GENERAL_HELP);
  if (helpMatch.found) {
    return {
      type: 'GENERAL_HELP',
      urgency: 1,
      confidence: 0.60,
      matchedKeywords: helpMatch.keywords,
    };
  }

  // Unknown intent
  return {
    type: 'UNCLEAR',
    urgency: 1,
    confidence: 0.0,
    matchedKeywords: [],
  };
}

/**
 * Find matching keywords in text.
 *
 * @param {string} text - Lowercased text
 * @param {string[]} keywords - Keywords to search for
 * @returns {{found: boolean, keywords: string[]}}
 */
function findKeywordMatch(text, keywords) {
  const matched = [];

  for (const kw of keywords) {
    // Word boundary match: \bkeyword\b
    const pattern = new RegExp(`\\b${kw}\\b`);
    if (pattern.test(text)) {
      matched.push(kw);
    }
  }

  return {
    found: matched.length > 0,
    keywords: matched,
  };
}

/**
 * Check if an intent is safety-critical (should bypass normal routing).
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function isCritical(intent) {
  return intent.type === 'CRITICAL' && intent.urgency >= 8;
}

/**
 * Check if an intent requires location tools.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function requiresLocation(intent) {
  return intent.type === 'LOCATION_REQUEST' || intent.type === 'SAFE_ZONE_CHECK';
}

/**
 * Check if an intent requires status tools (battery, heartbeat, online).
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function requiresStatus(intent) {
  return intent.type === 'DEVICE_STATUS';
}

/**
 * Check if an intent requires alert tools.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function requiresAlerts(intent) {
  return intent.type === 'RECENT_ALERTS';
}

/**
 * Check if an intent requires reminder/medication tools.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function requiresReminder(intent) {
  return intent.type === 'REMINDER_REQUEST';
}

/**
 * Check if an intent requires device command tools.
 *
 * @param {Object} intent - Result from classifyIntent()
 * @returns {boolean}
 */
function requiresCommand(intent) {
  return intent.type === 'DEVICE_COMMAND';
}

module.exports = {
  classifyIntent,
  isCritical,
  requiresLocation,
  requiresStatus,
  requiresAlerts,
  requiresReminder,
  requiresCommand,
};
