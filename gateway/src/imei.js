/**
 * ReachFar V52 protocol-ID normalization.
 *
 * The ASCII protocol uses a 10-digit device ID in every frame, but the label /
 * status SMS / Firestore linkedImeis use the full 15-digit IMEI. For this
 * hardware family the relationship is:
 *
 *   fullImei.substring(4, 14) === protocolId
 *
 * e.g. 861397053141170 → 9705314117, 861397053139877 → 9705313987.
 *
 * Rebuilding the 15-digit form from a 10-digit id:
 *
 *   fullImei = "8613970" + protocolId.substring(3) + suffixDigit
 *
 * The suffix digit is device-specific (often 0). Override per device via
 * IMEI_MAP or learn it from RYIMEI / CONFIG payloads.
 */

const config = require('./config');

/** @type {Map<string, string>} protocolId → full 15-digit IMEI */
const imeiMap = new Map();

function loadImeiMap() {
  imeiMap.clear();
  const raw = config.imeiMap || '';
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [from, to] = trimmed.split(':').map((s) => s.trim());
    if (from && to) imeiMap.set(from, to);
  }
}

loadImeiMap();

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isProtocolId(value) {
  const id = digitsOnly(value);
  return id.length === 10 && /^\d+$/.test(id);
}

function isFullImei(value) {
  const id = digitsOnly(value);
  return id.length === 15 && /^\d+$/.test(id);
}

function protocolIdFromFullImei(fullImei) {
  const full = digitsOnly(fullImei);
  if (!isFullImei(full)) return null;
  return full.substring(4, 14);
}

function fullImeiFromProtocolId(protocolId) {
  const id = digitsOnly(protocolId);
  if (!isProtocolId(id)) return null;

  const mapped = imeiMap.get(id);
  if (mapped && isFullImei(mapped)) return mapped;

  // ReachFar V52 protocol ids observed in the field start with 970. The final
  // IMEI digit is not encoded in the 10-digit id, so production devices should
  // use IMEI_MAP or a full-IMEI packet whenever the default suffix is not 0.
  if (!id.startsWith('970')) return null;

  const prefix = config.imeiPrefix || '8613970';
  const suffix = config.imeiDefaultSuffix || '0';
  const core = prefix + id.substring(3);
  if (core.length !== 14) return null;

  return core + suffix;
}

/**
 * Pick the canonical 15-digit Firestore document id.
 * Prefers an explicit full IMEI; falls back to deriving from a 10-digit id.
 */
function normalizeImei(rawId, session = null) {
  const id = digitsOnly(rawId);
  if (!id) return null;

  if (session?.fullImei && isFullImei(session.fullImei)) {
    return session.fullImei;
  }

  if (isFullImei(id)) return id;

  if (isProtocolId(id)) {
    return fullImeiFromProtocolId(id) || id;
  }

  return id;
}

/** Protocol id sent in ASCII frames (10-digit, or 15 if simulator sends full). */
function protocolIdFromRaw(rawId) {
  const id = digitsOnly(rawId);
  if (isProtocolId(id)) return id;
  if (isFullImei(id)) return protocolIdFromFullImei(id) || id;
  return id;
}

/** Extract a 15-digit IMEI from command args / payload text. */
function extractFullImeiFromPayload(args, payload) {
  const text = [payload, ...(args || [])].filter(Boolean).join(',');
  const match = text.match(/\b(\d{15})\b/);
  return match ? match[1] : null;
}

function bindSessionImei(session, rawId, fullImeiHint = null) {
  const protocolId = protocolIdFromRaw(rawId);
  session.protocolId = protocolId;

  if (fullImeiHint && isFullImei(fullImeiHint)) {
    session.fullImei = fullImeiHint;
  } else if (isFullImei(rawId)) {
    session.fullImei = digitsOnly(rawId);
  } else if (isProtocolId(protocolId)) {
    const derived = fullImeiFromProtocolId(protocolId);
    if (derived) session.fullImei = derived;
  }

  return {
    protocolId,
    imei: normalizeImei(rawId, session),
  };
}

module.exports = {
  digitsOnly,
  isProtocolId,
  isFullImei,
  protocolIdFromFullImei,
  fullImeiFromProtocolId,
  normalizeImei,
  protocolIdFromRaw,
  extractFullImeiFromPayload,
  bindSessionImei,
  loadImeiMap,
};
