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

const { normalizeLanguage } = require('./language-understanding');

const KEYWORDS = {
  CRITICAL: ['sos', 'emergency', 'urgent', 'danger', 'hospital', 'police', 'urgence', 'sekour'],
  LOCATION: ['where', 'locate', 'localise', 'at', 'location', 'position', 'find', 'track', 'ou', 'kote', 'kot'],
  DEVICE_STATUS: ['battery', 'batterie', 'batri', 'signal', 'online', 'check', 'status', 'connected', 'connectee', 'heartbeat'],
  RECENT_ALERTS: ['alert', 'alerts', 'alerte', 'alertes', 'warning', 'warnings', 'fall', 'geofence', 'event', 'incident', 'incidents', 'trigger'],
  JOURNEY: ['journey', 'journeys', 'trip', 'trips', 'outing', 'outings', 'trajet', 'voyage', 'sortie'],
  WEATHER: ['weather', 'forecast', 'rain', 'raining', 'temperature', 'meteo'],
  WELLBEING: ['spo2', 'oxygen saturation', 'blood pressure', 'heart rate', 'wellbeing reading', 'health reading'],
  DEVICE_COMMAND: ['ring', 'vibrate', 'alarm', 'sound', 'sonner', 'sone', 'trigger', 'activate', 'send command'],
  VOICE_MONITOR: ['listen', 'monitor', 'hear', 'listening', 'voice'],
  REMINDER: ['reminder', 'reminders', 'medicine', 'medsinn', 'pill', 'medication', 'medicament', 'rappel', 'rapel', 'remember', 'remind', 'remind me', 'schedule', 'programme'],
  SAFE_ZONE: ['home', 'school', 'work', 'zone', 'maison', 'ecole', 'lakaz'],
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
  const lower = normalizeLanguage(text);

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

  // Whole-day factual summary. Check before alerts/journeys because these
  // phrases intentionally aggregate several Guardian fact types.
  const dailySummaryMatch =
    /\b(daily (?:summary|recap)|today'?s summary|yesterday summary)\b/.test(lower) ||
    /\bhow (?:was|active was)\b.+\b(day|today|yesterday)\b/.test(lower) ||
    /\bwhat (?:happened|did)\b.+\b(today|yesterday|do)\b/.test(lower) ||
    /\banything unusual (?:today|yesterday)\b/.test(lower) ||
    /\b(resume|journee|aujourd'hui|inhabituel)\b.*\b(journee|aujourd'hui|hier|inhabituel)\b/.test(lower) ||
    /\bcomment\b.+\bjournee\b/.test(lower) ||
    /\bquoi de neuf\b.+\baujourd'hui\b/.test(lower) ||
    /\b(kouma lazourne|ki finn arive|rezime pou|pa normal zordi|lazourne yer)\b/.test(lower);
  if (dailySummaryMatch) {
    return {
      type: 'DAILY_SUMMARY',
      urgency: 2,
      confidence: 0.90,
      matchedKeywords: ['daily_summary'],
    };
  }

  // Safe zone (before general location, since "at home" is more specific)
  const zoneMatch = findKeywordMatch(lower, KEYWORDS.SAFE_ZONE);
  if (zoneMatch.found && /\b(at|lakaz)\b|\best a\b/.test(lower)) {
    return {
      type: 'SAFE_ZONE_CHECK',
      urgency: 2,
      confidence: 0.85,
      matchedKeywords: zoneMatch.keywords,
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

  // Voice monitoring (listen-in feature)
  const voiceMatch = findKeywordMatch(lower, KEYWORDS.VOICE_MONITOR);
  if (voiceMatch.found) {
    return {
      type: 'VOICE_MONITOR',
      urgency: 7,
      confidence: 0.85,
      matchedKeywords: voiceMatch.keywords,
    };
  }

  // Reminder/medication (check before general location, since "schedule pill" is more specific)
  const reminderMatch = findKeywordMatch(lower, KEYWORDS.REMINDER);
  if (reminderMatch.found) {
    return {
      type: 'REMINDER_REQUEST',
      urgency: 4,
      confidence: 0.85,
      matchedKeywords: reminderMatch.keywords,
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

  // Journey history (before location because phrases such as "where did Jesh go"
  // describe past movement rather than the latest position).
  const journeyMatch = findKeywordMatch(lower, KEYWORDS.JOURNEY);
  const journeyPhraseMatch =
    /\b(where did|where has)\b.+\b(go|been)\b/.test(lower) ||
    /\b(ou|kot|kote)\b.+\b(alle|ale|finn ale)\b/.test(lower);
  if (journeyMatch.found || journeyPhraseMatch) {
    return {
      type: 'JOURNEY_QUERY',
      urgency: 2,
      confidence: journeyMatch.found ? 0.90 : 0.85,
      matchedKeywords: journeyMatch.keywords,
    };
  }

  // Watch wellbeing is more specific than weather. Do not classify the bare
  // word "temperature" here because that normally means local weather and the
  // V52 temperature upload shape is not accepted yet.
  const wellbeingMatch = findKeywordMatch(lower, KEYWORDS.WELLBEING);
  if (wellbeingMatch.found) {
    return {
      type: 'WELLBEING_QUERY',
      urgency: 2,
      confidence: 0.90,
      matchedKeywords: wellbeingMatch.keywords,
    };
  }

  const weatherMatch = findKeywordMatch(lower, KEYWORDS.WEATHER);
  if (weatherMatch.found) {
    return {
      type: 'WEATHER_QUERY',
      urgency: 2,
      confidence: 0.90,
      matchedKeywords: weatherMatch.keywords,
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

  // Location request (check last among functional intents; "at", "where", "locate" are generic)
  const locationMatch = findKeywordMatch(lower, KEYWORDS.LOCATION);
  if (locationMatch.found) {
    return {
      type: 'LOCATION_REQUEST',
      urgency: 3,
      confidence: 0.90,
      matchedKeywords: locationMatch.keywords,
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
