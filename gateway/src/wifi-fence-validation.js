'use strict';

const crypto = require('node:crypto');
const { POLICY, normalizeRouterId, fingerprintRouter } = require('./wifi-home-observer');

const CAPTURE_MS = 30 * 60_000;
const MAX_ENTRIES = 256;
const MARKERS = Object.freeze(['at_home', 'left_home', 'returned_home',
  'router_off', 'router_on', 'watch_restarted']);
const PACKETS = new Set(['LK', 'TKQ', 'UD', 'UD2', 'UD_LTE', 'UD_WCDMA',
  'AL', 'AL_LTE', 'AL_WCDMA', 'CR', 'UPLOAD', 'WIFIFENCE', 'CONFIG', 'RYIMEI']);

// Section II.35 documents this complete three-slot form. Shorter lists,
// duplicate padding, empty slots, readback and deletion are not specified.
// This builder has NO transport and is not in the deviceCommands dispatcher.
function documentedFenceCommand(routers) {
  if (!Array.isArray(routers) || routers.length !== 3) {
    throw new Error('The documented example requires three router slots.');
  }
  const ids = Array.from(routers, normalizeRouterId);
  if (ids.some(id => !id) || new Set(ids).size !== 3) {
    throw new Error('Three distinct valid radio identifiers are required.');
  }
  return 'WIFIFENCE' + ids.map((id, i) => `,${i + 1},${id}`).join('');
}

function commandPreview() {
  const example = documentedFenceCommand(['02:00:00:00:00:01',
    '02:00:00:00:00:02', '02:00:00:00:00:03']);
  return {
    documentedFor: 'V52',
    source: 'Communication Protocol section II.35, pages 9-10',
    documentedPayloadBytes: Buffer.byteLength(example, 'ascii'),
    payload: 'WIFIFENCE,1,<radio-1>,2,<radio-2>,3,<radio-3>',
    transport: 'TCP',
    watchCommandsSent: 0,
    liveProvisioningAvailable: false,
    outstanding: ['single_router_and_unused_slots', 'removal_and_restore',
      'fence_event_semantics', 'detection_between_uploads'],
  };
}

function milliseconds(value) {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? Date.parse(value) : NaN;
}

function createWifiFenceCapture({ imei, routerHash, hashKey, startedAtMs = Date.now() }) {
  if (!/^\d{15}$/.test(imei || '') || !/^[0-9a-f]{64}$/i.test(routerHash || '') ||
      !/^[0-9a-f]{64}$/i.test(hashKey || '') || !Number.isFinite(startedAtMs)) {
    throw new Error('Configured private observer required.');
  }
  const captureId = crypto.randomBytes(12).toString('hex');
  const expiresAtMs = startedAtMs + CAPTURE_MS;
  const entries = [];
  const seenReports = new Set();
  const counts = { reports: 0, heartbeats: 0, freshRouterSightings: 0,
    staleOrInvalidReports: 0, repeatedReports: 0, fencePackets: 0,
    freshFencePackets: 0, crHandoffs: 0, uploadHandoffs: 0,
    fenceHandoffs: 0, commandResponses: 0, markers: 0 };
  let stoppedAtMs = null;
  let lastAtMs = startedAtMs;
  let lastReportAtMs = null;
  let lastRouterAtMs = null;
  let maxReportGapMs = null;
  let droppedEntries = 0;

  function active(nowMs) {
    return stoppedAtMs == null && Number.isFinite(nowMs) &&
      nowMs >= lastAtMs && nowMs < expiresAtMs;
  }
  function append(row, nowMs) {
    lastAtMs = nowMs;
    entries.push({ at: new Date(nowMs).toISOString(), ...row });
    if (entries.length > MAX_ENTRIES) { entries.shift(); droppedEntries++; }
  }

  function recordPacket(event, { command, trackerState = null } = {}, nowMs = Date.now()) {
    if (!active(nowMs) || event?.imei !== imei) return;
    const packet = PACKETS.has(command) ? command : 'other';
    if (event.type === 'heartbeat') {
      counts.heartbeats++;
      append({ kind: 'heartbeat', packet }, nowMs);
      return;
    }
    if (event.type === 'command_echo') {
      // An observed response proves neither applied settings nor a Home state.
      counts.commandResponses++;
      append({ kind: 'command_response', packet, settingsApplied: null }, nowMs);
      return;
    }
    if (!['location', 'alarm', 'location_parse_error'].includes(event.type)) return;
    counts.reports++;
    const gapMs = lastReportAtMs == null ? null : nowMs - lastReportAtMs;
    if (gapMs != null) maxReportGapMs = Math.max(maxReportGapMs || 0, gapMs);
    lastReportAtMs = nowMs;
    const sourceMs = milliseconds(event.location?.recordedAt);
    const ageMs = nowMs - sourceMs;
    const timeStatus = command === 'UD2' ? 'buffered' :
      !Number.isFinite(sourceMs) || sourceMs < 0 ? 'missing' :
      ageMs < -POLICY.futureSkewMs ? 'future' :
      ageMs >= POLICY.maxAgeMs ? 'stale' : 'fresh';
    if (timeStatus !== 'fresh') counts.staleOrInvalidReports++;
    const state = /^[0-9a-f]{8}$/i.test(trackerState || '') &&
      /^(AL|UD)/.test(command || '') ? parseInt(trackerState, 16) : null;
    const fenceExitBit = state == null ? null : Boolean(state & (1 << 18));
    const fenceEnterBit = state == null ? null : Boolean(state & (1 << 19));
    // The key contains no coordinates, radio identifiers or packet body.
    const key = `${packet}:${sourceMs}:${state}`;
    const repeated = Number.isFinite(sourceMs) && seenReports.has(key);
    if (Number.isFinite(sourceMs)) {
      seenReports.add(key);
      if (seenReports.size > MAX_ENTRIES) seenReports.delete(seenReports.values().next().value);
    }
    if (repeated) counts.repeatedReports++;
    let homeRouterSeen = false;
    let signalDbm = null;
    const aps = event.wifiAccessPoints;
    const validScan = Array.isArray(aps) && aps.length <= POLICY.maxAccessPoints;
    if (validScan) {
      for (const ap of aps) {
        const id = normalizeRouterId(ap?.macAddress);
        if (!id || fingerprintRouter({ imei, routerId: id, hashKey }) !== routerHash.toLowerCase()) continue;
        homeRouterSeen = true;
        if (typeof ap.signalStrength === 'number' && Number.isFinite(ap.signalStrength) &&
            ap.signalStrength >= -120 && ap.signalStrength <= 0) {
          signalDbm = Math.max(signalDbm ?? -120, ap.signalStrength);
        }
      }
    }
    if (homeRouterSeen && timeStatus === 'fresh' && !repeated) {
      counts.freshRouterSightings++;
      lastRouterAtMs = nowMs;
    }
    if (fenceExitBit || fenceEnterBit) {
      counts.fencePackets++;
      if (timeStatus === 'fresh' && !repeated) counts.freshFencePackets++;
    }
    append({ kind: 'report', packet, timeStatus, repeated,
      observedAt: Number.isFinite(sourceMs) ? new Date(sourceMs).toISOString() : null,
      observationAgeSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null,
      reportGapSeconds: gapMs == null ? null : Math.round(gapMs / 1000),
      gpsValid: typeof event.gpsValid === 'boolean' ? event.gpsValid : null,
      radiosReported: validScan ? aps.length : null, homeRouterSeen, signalDbm,
      fenceExitBit, fenceEnterBit,
      sosBit: state == null ? null : Boolean(state & (1 << 16)),
      fenceSource: fenceExitBit || fenceEnterBit ? 'unconfirmed' : null,
    }, nowMs);
  }

  function recordCommand(command, nowMs = Date.now()) {
    if (!active(nowMs) || typeof command !== 'string') return;
    let row;
    if (command === 'CR') {
      counts.crHandoffs++;
      row = { command: 'CR', documentedBurstSeconds: 180 };
    } else if (/^UPLOAD,\d{1,4}$/.test(command)) {
      counts.uploadHandoffs++;
      row = { command: 'UPLOAD', requestedSeconds: Number(command.split(',')[1]) };
    } else if (/^WIFIFENCE(?:,|$)/i.test(command)) {
      counts.fenceHandoffs++;
      row = { command: 'WIFIFENCE' };
    } else return;
    append({ kind: 'socket_handoff', ...row, settingsApplied: null }, nowMs);
  }

  function mark(label, nowMs = Date.now()) {
    if (!MARKERS.includes(label)) throw new Error('Unknown observation marker.');
    if (!active(nowMs)) throw new Error('No active capture.');
    counts.markers++;
    append({ kind: 'operator_marker', label, physicallyVerifiedByGateway: false }, nowMs);
  }
  function stop(nowMs = Date.now()) {
    if (active(nowMs)) stoppedAtMs = nowMs;
  }
  function snapshot(nowMs = Date.now(), includeTimeline = false) {
    const end = stoppedAtMs ?? Math.min(nowMs, expiresAtMs);
    return {
      captureId, observeOnly: true, homeClaim: false, nativeFenceAccepted: false,
      phase: stoppedAtMs != null ? 'stopped' : nowMs >= expiresAtMs ? 'completed' :
        nowMs < lastAtMs ? 'clock_unconfirmed' : 'recording',
      startedAt: new Date(startedAtMs).toISOString(),
      endsAt: new Date(expiresAtMs).toISOString(),
      elapsedSeconds: Math.max(0, Math.floor((end - startedAtMs) / 1000)),
      counts: { ...counts },
      maxReportGapSeconds: maxReportGapMs == null ? null : Math.round(maxReportGapMs / 1000),
      secondsSinceLastReport: lastReportAtMs == null ? null : Math.max(0, Math.floor((end - lastReportAtMs) / 1000)),
      secondsSinceLastRouterSighting: lastRouterAtMs == null ? null : Math.max(0, Math.floor((end - lastRouterAtMs) / 1000)),
      retainedEntries: entries.length, droppedEntries,
      ...(includeTimeline ? { timeline: entries.map(row => ({ ...row })) } : {}),
    };
  }
  return Object.freeze({ recordPacket, recordCommand, mark, stop, snapshot });
}

module.exports = { createWifiFenceCapture, documentedFenceCommand, commandPreview,
  CAPTURE_MS, MAX_ENTRIES, MARKERS };
