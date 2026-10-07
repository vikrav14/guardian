/**
 * Guardian cost model — all amounts in Mauritian Rupees (MUR).
 * Edit this file (or replace with pricing.mur.json loader) — never hardcode in UI.
 *
 * Rates are planning estimates based on Firebase/Meta/Anthropic list pricing
 * converted at murPerUsd. Reconcile against actual invoices periodically.
 */
module.exports = {
  currency: 'MUR',
  murPerUsd: 50,
  aiBasis: 'Haiku 4.5 planning estimate; use aiAttempts and aiBudgetMonths for metered mixed-model usage',

  firestore: {
    /** MUR per 100,000 document reads */
    readPer100k: 36,
    /** MUR per 100,000 document writes */
    writePer100k: 108,
    /** MUR per GB-month stored */
    storagePerGbMonth: 16,
  },

  maps: {
    /** MUR per 1,000 static map loads (dashboard thumbnails) */
    staticMapPer1000: 45,
    /** MUR per 1,000 geocoding requests */
    geocodingPer1000: 81,
  },

  whatsapp: {
    /** Conservative MUR budget per delivered Meta utility template. */
    perMessageMur: 0.50,
  },

  claude: {
    /** Haiku 4.5: USD 1 / MTok input, converted at murPerUsd. */
    inputPer1kTokensMur: 0.05,
    /** Haiku 4.5: USD 5 / MTok output, converted at murPerUsd. */
    outputPer1kTokensMur: 0.25,
  },

  hosting: {
    /** Single gateway VM (e.g. Cloud Run / small VPS) */
    gatewayVmPerMonthMur: 3200,
    /** Firebase Hosting + Auth free tier allowance */
    firebaseHostingPerMonthMur: 0,
  },

  /** Revenue-side assumptions for finance tab (Phase 2) */
  subscription: {
    /** Annual subscription price per user (MUR) */
    annualMur: 1500,
    /** Monthly equivalent for projections */
    monthlyMur: 125,
    /** Guardian Essential renewal from month 13. */
    essentialMonthlyMur: 199,
    /** Compatibility alias for older dashboard code. */
    basicMonthlyMur: 199,
    familyMonthlyMur: 1000,
    careMonthlyMur: 1300,
  },

  device: {
    /** COGS per pendant (MUR) */
    pendantCostMur: 1800,
    /** Retail sale price per pendant (MUR) */
    pendantSaleMur: 2500,
  },

  /** Finance dashboard defaults */
  finance: {
    monthlyBudgetMur: 15000,
    devicesSoldToday: 0,
    devicesSoldMonth: 0,
    subscriptionsSoldToday: 0,
    subscriptionsSoldMonth: 0,
    supportMarketingPerUserMur: 45,
  },

  /** Per-user daily usage heuristics for monthly projection */
  defaults: {
    appOpensPerUserDay: 8,
    firestoreReadsPerAppOpen: 45,
    firestoreWritesPerUserDay: 12,
    whatsappMessagesPerUserDay: 0.15,
    claudeTokensPerWhatsAppMessage: 2800,
    mapLoadsPerUserDay: 3,
    avgDevicesPerUser: 1.2,
    gpsPacketsPerDeviceDay: 144,
    writeGatePersistRatio: 0.08,
  },
};
