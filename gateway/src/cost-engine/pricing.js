/**
 * Guardian cost model — all amounts in Mauritian Rupees (MUR).
 * Edit this file (or replace with pricing.mur.json loader) — never hardcode in UI.
 *
 * Rates are planning estimates based on Firebase/Twilio/Anthropic list pricing
 * converted at murPerUsd. Reconcile against actual invoices periodically.
 */
module.exports = {
  currency: 'MUR',
  murPerUsd: 45,

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
    /** MUR per outbound/inbound WhatsApp session message (Twilio MU estimate) */
    perMessageMur: 0.35,
  },

  claude: {
    /** MUR per 1,000 input tokens (Sonnet-class) */
    inputPer1kTokensMur: 0.41,
    /** MUR per 1,000 output tokens */
    outputPer1kTokensMur: 2.03,
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
    basicMonthlyMur: 299,
    familyMonthlyMur: 499,
    careMonthlyMur: 799,
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
    gpsPacketsPerDeviceDay: 1440,
    writeGatePersistRatio: 0.08,
  },
};
