'use strict';

const crypto = require('node:crypto');

// Pilot observation thresholds, not an assertion that the wearer is indoors.
const POLICY = Object.freeze({
  minSignalDbm: -75,
  minReports: 3,
  minSpanMs: 20_000,
  maxGapMs: 60_000,
  maxAgeMs: 120_000,
  futureSkewMs: 15_000,
  maxAccessPoints: 32,
});

function normalizeRouterId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase().replace(/-/g, ':');
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(id)) return null;
  if (id === '00:00:00:00:00:00' || (parseInt(id.slice(0, 2), 16) & 1)) return null;
  return id;
}

function fingerprintRouter({ imei, routerId, hashKey }) {
  const id = normalizeRouterId(routerId);
  if (!/^\d{15}$/.test(imei || '') || !/^[0-9a-f]{64}$/i.test(hashKey || '') || !id) {
    throw new Error('Valid pilot watch, router identifier and hash key are required.');
  }
  return crypto.createHmac('sha256', Buffer.from(hashKey, 'hex'))
    .update(`guardian-wifi-home-v1\0${imei}\0${id}`).digest('hex');
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return NaN;
}

function createWifiHomeObserver({ enabled = false, imei, routerHash, hashKey } = {}) {
  const configured = /^\d{15}$/.test(imei || '') &&
    /^[0-9a-f]{64}$/i.test(routerHash || '') && /^[0-9a-f]{64}$/i.test(hashKey || '');
  const active = enabled === true && configured;
  const counts = { reports: 0, routerSeen: 0, qualified: 0, ignoredTime: 0, duplicates: 0 };
  let state = 'unknown';
  let reason = 'no_observation';
  let lastSourceMs = null;
  let lastReceiptMs = null;
  let firstMatchSourceMs = null;
  let firstMatchReceiptMs = null;
  let lastMatchSourceMs = null;
  let lastMatchReceiptMs = null;
  let streak = 0;
  let signalDbm = null;
  let gpsObservation = null;

  function clear(nextReason) {
    state = 'unknown'; reason = nextReason; streak = 0;
    firstMatchSourceMs = null; firstMatchReceiptMs = null;
    lastMatchSourceMs = null; lastMatchReceiptMs = null; signalDbm = null;
  }

  function snapshot(nowMs = Date.now()) {
    const expiresAtMs = lastMatchSourceMs == null ? null :
      Math.min(lastMatchSourceMs, lastMatchReceiptMs) + POLICY.maxAgeMs;
    const clockInvalid = !Number.isFinite(nowMs) ||
      (lastReceiptMs != null && nowMs < lastReceiptMs);
    const expired = expiresAtMs != null && nowMs >= expiresAtMs;
    return {
      observeOnly: true,
      customerActive: false,
      homeClaim: false,
      configured,
      enabled: active,
      matchState: !active ? 'disabled' : clockInvalid ? 'unknown' : expired ? 'expired' : state,
      reason: !active ? (enabled === true ? 'configuration_incomplete' : 'disabled') :
        clockInvalid ? 'clock_unconfirmed' : expired ? 'observation_expired' : reason,
      asOf: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null,
      consecutiveMatches: expired || clockInvalid ? 0 : streak,
      lastMatchAgeSeconds: lastMatchSourceMs == null || clockInvalid ? null :
        Math.max(0, Math.floor((nowMs - lastMatchSourceMs) / 1000)),
      observedAt: lastMatchSourceMs == null || clockInvalid ? null : new Date(lastMatchSourceMs).toISOString(),
      expiresAt: expiresAtMs == null || clockInvalid ? null : new Date(expiresAtMs).toISOString(),
      signalDbm: expired || clockInvalid ? null : signalDbm,
      counts: { ...counts },
    };
  }

  function observe(event, nowMs = Date.now(), radioScan) {
    // Heartbeats, echoes, other watches and disabled mode cannot refresh evidence.
    if (!active || event?.imei !== imei || !['location', 'alarm'].includes(event.type)) {
      return snapshot(nowMs);
    }
    counts.reports += 1;
    const sourceMs = timestamp(event.location?.recordedAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(sourceMs) ||
        sourceMs < 0 || sourceMs > nowMs + POLICY.futureSkewMs ||
        nowMs - sourceMs >= POLICY.maxAgeMs ||
        (lastReceiptMs != null && nowMs < lastReceiptMs)) {
      counts.ignoredTime += 1;
      return snapshot(nowMs);
    }
    if (lastSourceMs != null && sourceMs <= lastSourceMs) {
      counts.duplicates += 1;
      return snapshot(nowMs);
    }
    lastSourceMs = sourceMs;
    lastReceiptMs = nowMs;

    const gps = event.gpsValid === true && event.location?.gpsValid === true &&
      event.accuracySource === 'gps' && event.location?.source === 'gps';
    const wifi = event.gpsValid === false && event.location?.gpsValid === false &&
      event.accuracySource === 'wifi' && event.location?.source === 'wifi';
    const cellular = event.gpsValid === false && event.location?.gpsValid === false &&
      event.accuracySource === 'lbs' && event.location?.source === 'lbs';
    if (!gps && !wifi && !cellular) {
      clear('no_wifi_evidence');
      return snapshot(nowMs);
    }
    if (gps) {
      // Keep coordinate evidence separately. It never counts as a router sighting
      // or renews radio time. The presentation policy compares it with Home.
      gpsObservation = { lat: event.location.lat, lng: event.location.lng,
        recordedAt: new Date(sourceMs).toISOString(), source: 'gps', gpsValid: true,
        accuracyMeters: event.location.accuracyMeters ?? null };
    }
    let accessPoints = event.wifiAccessPoints;
    if (radioScan !== undefined) {
      if (radioScan?.status === 'not_reported') return snapshot(nowMs);
      if (radioScan?.status !== 'decoded') {
        clear('invalid_scan');
        return snapshot(nowMs);
      }
      accessPoints = radioScan.accessPoints;
      if (radioScan.declaredRadios > 0 && Array.isArray(accessPoints) && accessPoints.length === 0) {
        clear('invalid_scan');
        return snapshot(nowMs);
      }
    } else if (gps) {
      // Legacy GPS events omit their scan. Missing scan evidence cannot erase
      // or extend an already qualified radio observation.
      return snapshot(nowMs);
    }
    // V52 alternates Wi-Fi scans with cellular-only reports. A canonical LBS
    // packet with no access points gives no new router evidence: preserve the
    // existing sequence, source time and expiry without counting or renewing it.
    // Malformed or contradictory scans still fail closed below.
    if ((gps || cellular) && Array.isArray(accessPoints) && accessPoints.length === 0) {
      return snapshot(nowMs);
    }
    if (!gps && !wifi) {
      clear('no_wifi_evidence');
      return snapshot(nowMs);
    }
    if (!Array.isArray(accessPoints) || accessPoints.length > POLICY.maxAccessPoints) {
      clear('invalid_scan');
      return snapshot(nowMs);
    }

    let seen = false;
    let strongest = null;
    for (const accessPoint of accessPoints) {
      const id = normalizeRouterId(accessPoint?.macAddress);
      if (!id || fingerprintRouter({ imei, routerId: id, hashKey }) !== routerHash.toLowerCase()) continue;
      seen = true;
      const signal = accessPoint.signalStrength;
      if (typeof signal === 'number' && Number.isFinite(signal) && signal >= -120 && signal <= 0) {
        strongest = strongest == null ? signal : Math.max(strongest, signal);
      }
    }
    if (seen) counts.routerSeen += 1;
    if (!seen || strongest == null || strongest < POLICY.minSignalDbm) {
      clear(!seen ? 'router_not_seen' : strongest == null ? 'signal_unknown' : 'signal_weak');
      return snapshot(nowMs);
    }

    counts.qualified += 1;
    if (lastMatchSourceMs == null || sourceMs - lastMatchSourceMs > POLICY.maxGapMs ||
        nowMs - lastMatchReceiptMs > POLICY.maxGapMs) {
      streak = 0; firstMatchSourceMs = sourceMs; firstMatchReceiptMs = nowMs;
    }
    streak += 1;
    lastMatchSourceMs = sourceMs;
    lastMatchReceiptMs = nowMs;
    signalDbm = strongest;
    const sustained = streak >= POLICY.minReports &&
      sourceMs - firstMatchSourceMs >= POLICY.minSpanMs &&
      nowMs - firstMatchReceiptMs >= POLICY.minSpanMs;
    state = sustained ? 'matched' : 'candidate';
    reason = sustained ? 'repeated_router_observations' : 'awaiting_repeated_observations';
    return snapshot(nowMs);
  }

  return Object.freeze({ observe, snapshot,
    // Internal reader only; snapshot/ops diagnostics contain no coordinates.
    readGpsObservation: () => gpsObservation ? { ...gpsObservation } : null });
}

module.exports = { POLICY, normalizeRouterId, fingerprintRouter, createWifiHomeObserver };
