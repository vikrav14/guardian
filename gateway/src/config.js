require('dotenv').config();
const path = require('path');

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 9000),
  firestoreDisabled: String(process.env.FIRESTORE_DISABLED || 'false').toLowerCase() === 'true',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : '',
  writeLocationHistory: String(process.env.WRITE_LOCATION_HISTORY || 'false').toLowerCase() === 'true',

  // Event-driven write gate (Phase 0.5) — Firestore mirrors meaningful state changes only
  writeGateMinMetres: Number(process.env.WRITE_GATE_MIN_METRES || 50),
  writeGateHeartbeatMinutes: Number(process.env.WRITE_GATE_HEARTBEAT_MINUTES || 5),
  writeGateHistoryMinutes: Number(process.env.WRITE_GATE_HISTORY_MINUTES || 5),
  dwellMinMinutes: Number(process.env.DWELL_MIN_MINUTES || 10),
  journeyIdleMinutes: Number(process.env.JOURNEY_IDLE_MINUTES || 15),

  // V52: 10-digit protocol id → configured 15-digit hardware IMEI.
  // A protocol id is expanded with the configured prefix/suffix into the
  // corresponding 15-digit hardware IMEI.
  imeiPrefix: process.env.IMEI_PREFIX || '8613970',
  imeiDefaultSuffix: process.env.IMEI_DEFAULT_SUFFIX || '0',
  // Optional overrides when the suffix differs: "protocol-id:hardware-imei"
  imeiMap: process.env.IMEI_MAP || '',

  // Optional carrier SMS. WhatsApp is Meta Cloud API only.
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromSms: process.env.TWILIO_FROM_SMS || '',
  notifySms: String(process.env.NOTIFY_SMS || 'true').toLowerCase() === 'true',
  notifyWhatsApp: String(process.env.NOTIFY_WHATSAPP || 'true').toLowerCase() === 'true',

  // Meta WhatsApp Cloud API.
  // Keep the access token only in gateway/.env or deployment secrets â€” never commit it.
  metaWhatsAppAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || '',
  metaWhatsAppPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
  metaWhatsAppWabaId: process.env.META_WHATSAPP_WABA_ID || '',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaWhatsAppVerifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || '',
  metaWhatsAppReminderTemplate: process.env.META_WHATSAPP_REMINDER_TEMPLATE || '',
  // Pilot-only: both values must match a device before Guardian selects the
  // SOS templates whose static Meta phone button calls that watch. Leave both
  // empty until the templates are approved and the real-device test passes.
  metaWhatsAppSosCallbackPilotImei:
    process.env.META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI || '',
  metaWhatsAppSosCallbackPilotNumber:
    process.env.META_WHATSAPP_SOS_CALLBACK_PILOT_NUMBER || '',

  // HTTP (WhatsApp webhook + /dev/chat)
  httpPort: Number(process.env.HTTP_PORT || 9001),

  // LLM Providers (primary: Gemini, fallback: Anthropic, offline: Template)
  llmProvider: process.env.LLM_PROVIDER || 'gemini', // 'gemini' | 'anthropic' | 'template'
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',

  // Layer 1 intelligence (rule-based device insights)
  intelligenceOfflineMinutes: Number(process.env.INTELLIGENCE_OFFLINE_MINUTES || 10),
  intelligenceOfflineAlertCooldownMinutes: Number(
    process.env.INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES || 30
  ),
  intelligenceCheckIntervalMs: Number(process.env.INTELLIGENCE_CHECK_INTERVAL_MS || 60_000),

  /**
   * Close idle TCP only after a long quiet stretch. Stationary pendants can
   * easily go 5+ minutes between packets — Offline must mean "really gone",
   * not "between heartbeats".
   */
  tcpIdleMinutes: Number(process.env.TCP_IDLE_MINUTES || 12),

  /** Grace after a packet-silence CR probe before the socket is declared dead. */
  tcpRecoveryGraceSeconds: Number(process.env.TCP_RECOVERY_GRACE_SECONDS || 90),

  /** Kernel TCP keepalive protects otherwise healthy low-traffic watch sockets. */
  tcpKeepAliveInitialDelayMs: Number(
    process.env.TCP_KEEPALIVE_INITIAL_DELAY_MS || 60_000
  ),

  /** Request a fresh location when an active outing has no location observation. */
  outingLocationStaleSeconds: Number(
    process.env.OUTING_LOCATION_STALE_SECONDS || 150
  ),
  outingLocationProbeIntervalSeconds: Number(
    process.env.OUTING_LOCATION_PROBE_INTERVAL_SECONDS || 180
  ),

  /** Must exceed writeGateHeartbeatMinutes — heartbeats can be write-gated that long. */
  connectionStaleMinutes: Math.max(
    Number(process.env.CONNECTION_STALE_MINUTES || 10),
    Number(process.env.WRITE_GATE_HEARTBEAT_MINUTES || 5) + 2
  ),

  /** Wait before writing offline after TCP close — absorbs ngrok/carrier reconnect blips. */
  offlineDebounceMs: Number(process.env.OFFLINE_DEBOUNCE_MS || 15_000),

  // Command Center / ops API (GET /ops/metrics, /ops/cost-estimate)
  adminApiKey: process.env.ADMIN_API_KEY || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  opsMetricsFlushMs: Number(process.env.OPS_METRICS_FLUSH_MS || 60_000),

  // Google Geolocation API — resolves gps=V WiFi/LBS packets to lat/lng
  googleGeolocationApiKey: process.env.GOOGLE_GEOLOCATION_API_KEY || '',

  // Renewable Journey presentation. Raw GPS evidence remains authoritative;
  // these server-only keys add expiring road geometry and nearby landmarks.
  journeyGooglePresentationEnabled:
    String(process.env.JOURNEY_GOOGLE_PRESENTATION_ENABLED || 'true')
      .toLowerCase() === 'true',
  googleRoadsApiKey: process.env.GOOGLE_ROADS_API_KEY || '',
  googleRoutesApiKey:
    process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_ROADS_API_KEY || '',
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || '',

  // OpenWeatherMap API — weather context for device locations
  openWeatherMapKey: process.env.OPEN_WEATHER_MAP_KEY || '',

  // Context intelligence — hourly, observe-only by default. This never sends WhatsApp.
  contextIntelligenceEnabled:
    String(process.env.CONTEXT_INTELLIGENCE_ENABLED || 'false').toLowerCase() === 'true',
  contextLlmJudgmentEnabled:
    String(process.env.CONTEXT_LLM_JUDGMENT_ENABLED || 'true').toLowerCase() === 'true',
  contextPollMinutes: Math.max(Number(process.env.CONTEXT_POLL_MINUTES || 60), 60),
  contextWeatherCacheMinutes: Math.max(
    Number(process.env.CONTEXT_WEATHER_CACHE_MINUTES || 60),
    60
  ),
  contextMaxDevicesPerSweep: Math.max(
    1,
    Number(process.env.CONTEXT_MAX_DEVICES_PER_SWEEP || 1000)
  ),
  contextConcurrency: Math.max(1, Number(process.env.CONTEXT_CONCURRENCY || 5)),
  contextRunOnStartup:
    String(process.env.CONTEXT_RUN_ON_STARTUP || 'true').toLowerCase() === 'true',
  contextPersistObservations:
    String(process.env.CONTEXT_PERSIST_OBSERVATIONS || 'false').toLowerCase() === 'true',

  // Official Mauritius Meteorological Services CAP feed. This source remains
  // observe-only: polling and evaluation never imply notification delivery.
  contextCapEnabled:
    String(process.env.CONTEXT_CAP_ENABLED || 'false').toLowerCase() === 'true',
  contextCapFeedUrl:
    process.env.CONTEXT_CAP_FEED_URL ||
    'https://cap-sources.s3.amazonaws.com/mu-mms-en/rss.xml',
  contextCapPollMinutes: Math.max(
    5,
    Number(process.env.CONTEXT_CAP_POLL_MINUTES || 5)
  ),
  contextCapMaxItems: Math.max(
    1,
    Math.min(100, Number(process.env.CONTEXT_CAP_MAX_ITEMS || 50))
  ),
  contextCapRunOnStartup:
    String(process.env.CONTEXT_CAP_RUN_ON_STARTUP || 'true').toLowerCase() === 'true',
  contextCapPersistEvents:
    String(process.env.CONTEXT_CAP_PERSIST_EVENTS || 'false').toLowerCase() === 'true',
  contextCapEvaluateDevices:
    String(process.env.CONTEXT_CAP_EVALUATE_DEVICES || 'true').toLowerCase() === 'true',

  // Defi Media local-news RSS. This is a corroborating, observe-only source.
  // It may persist idempotency/match evidence and sweep devices, but never
  // calls the LLM or a delivery provider.
  contextDefiMediaEnabled:
    String(process.env.CONTEXT_DEFIMEDIA_ENABLED || 'false').toLowerCase() === 'true',
  contextDefiMediaFeedUrl:
    process.env.CONTEXT_DEFIMEDIA_FEED_URL || 'https://defimedia.info/rss.xml',
  contextDefiMediaPollMinutes: Math.max(
    15,
    Number(process.env.CONTEXT_DEFIMEDIA_POLL_MINUTES || 15)
  ),
  contextDefiMediaMaxItems: Math.max(
    1,
    Math.min(200, Number(process.env.CONTEXT_DEFIMEDIA_MAX_ITEMS || 100))
  ),
  contextDefiMediaMaxAgeHours: Math.max(
    1,
    Number(process.env.CONTEXT_DEFIMEDIA_MAX_AGE_HOURS || 24)
  ),
  contextDefiMediaRunOnStartup:
    String(process.env.CONTEXT_DEFIMEDIA_RUN_ON_STARTUP || 'true').toLowerCase() === 'true',
  contextDefiMediaPersistEvents:
    String(process.env.CONTEXT_DEFIMEDIA_PERSIST_EVENTS || 'true').toLowerCase() === 'true',
  contextDefiMediaEvaluateDevices:
    String(process.env.CONTEXT_DEFIMEDIA_EVALUATE_DEVICES || 'true').toLowerCase() === 'true',
  contextDefiMediaPersistMatches:
    String(process.env.CONTEXT_DEFIMEDIA_PERSIST_MATCHES || 'true').toLowerCase() === 'true',
  contextDefiMediaLocationFreshMinutes: Math.max(
    1,
    Number(process.env.CONTEXT_DEFIMEDIA_LOCATION_FRESH_MINUTES || 15)
  ),
  contextDefiMediaMaxApproxAccuracyMeters: Math.max(
    100,
    Number(process.env.CONTEXT_DEFIMEDIA_MAX_APPROX_ACCURACY_METERS || 1000)
  ),
};

module.exports = config;
