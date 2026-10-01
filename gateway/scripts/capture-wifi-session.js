'use strict';

// Standalone observation only: no Firebase/config imports, generated commands,
// raw router addresses, names, coordinates, photos or health values in output.
const crypto = require('node:crypto');
const relay = require('./capture-movement-session');
const { inspectV52WifiScan } = require('../src/wifi-fence-scan');
const { normalizeRouterId } = require('../src/wifi-home-observer');

const KNOWN = new Set(('CONFIG ICCID RYIMEI appcontacttel APPANDFNREPORT LK TKQ eicard '
  + 'UD UD2 UD_LTE UD2_LTE AL AL_LTE WT_LTE CR UPLOAD WIFIFENCE rcapture PHOTO '
  + 'FIND MONITOR CALL SOS SOS1 SOS2 SOS3 PHBX FALLDOWN LSSET REMOVE REMOVESMS '
  + 'SEDENTARY SEDENTARYWORKTIME REMIND TAKEPILLS HSW PEDO WALKTIME '
  + 'hrtstart oxygen bphrt bodytemp bodytemp2 BODYTEMP2 profile PROFILE LZ').split(' '));
const REPORTS = new Set(['UD', 'UD2', 'UD_LTE', 'UD2_LTE', 'AL', 'AL_LTE']);
const MAC = /^(?:[a-f\d]{2}:){5}[a-f\d]{2}$|^(?:[a-f\d]{2}-){5}[a-f\d]{2}$/i;
const MAX_ALIASES = 512;

function integer(value, min, max) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function reportedTime(args) {
  if (!/^\d{6}$/.test(args[0] || '') || !/^\d{6}$/.test(args[1] || '')) return null;
  const date = args[0], time = args[1];
  const [day, month, year, hour, minute, second] = [date.slice(0, 2), date.slice(2, 4),
    date.slice(4), time.slice(0, 2), time.slice(2, 4), time.slice(4)].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const value = new Date(Date.UTC(2000 + year, month - 1, day, hour, minute, second));
  return value.getUTCDate() === day ? value.toISOString() : null;
}

function createSummary() {
  // One alias scope for both directions/all sessions in this run. No stable
  // cross-run fingerprint or key is persisted; failed alias allocation is explicit.
  const key = crypto.randomBytes(32), aliases = new Map();
  function alias(raw) {
    const normalized = normalizeRouterId(raw);
    if (!normalized) return { alias: null, reason: 'invalid_radio' };
    const digest = crypto.createHmac('sha256', key).update(normalized).digest('hex');
    if (!aliases.has(digest)) {
      if (aliases.size >= MAX_ALIASES) return { alias: null, reason: 'alias_limit' };
      aliases.set(digest, `router_${aliases.size + 1}`);
    }
    return { alias: aliases.get(digest), reason: null };
  }
  function fenceField(value) {
    const trimmed = value.trim();
    if (MAC.test(trimmed)) return { kind: 'radio', ...alias(trimmed),
      specialRadio: /^00([:-]00){5}$/.test(trimmed) ? 'all_zero' : /^ff([:-]ff){5}$/i.test(trimmed) ? 'broadcast' : null,
      separator: trimmed.includes(':') ? ':' : '-',
      letterCase: trimmed === trimmed.toUpperCase() ? 'upper' : trimmed === trimmed.toLowerCase() ? 'lower' : 'mixed',
      surroundingWhitespace: value.length !== trimmed.length };
    if (value === '') return { kind: 'empty' };
    // Preserve only small numeric slot/flag syntax, never arbitrary identifiers.
    if (/^-?\d{1,3}$/.test(value)) return { kind: 'numeric', text: value };
    return { kind: 'redacted', bytes: Buffer.byteLength(value, 'latin1') };
  }
  return function summarize(frame, protocolId, direction) {
    const base = relay.frameSummary(frame, protocolId, direction);
    if (!base) return null;
    delete base.frame;
    delete base.frameHex;
    base.argumentsRedacted = true;
    base.observationProfile = 'wifi_comparison_v1';
    const command = base.command;
    base.command = KNOWN.has(command) ? command : 'OTHER';
    if (!base.lengthMatches) return base;
    const body = frame.subarray(20, -1).toString('latin1');
    const args = body.split(',').slice(1);
    if (command === 'UPLOAD' && args.length === 1) {
      base.requestedUploadSeconds = integer(args[0], 1, 86400);
    }
    if (command === 'WIFIFENCE') {
      base.fenceArguments = args.slice(0, 24).map(fenceField);
      base.fenceArgumentsTruncated = args.length > 24;
      base.bareReply = args.length === 0;
      base.nativeFenceApplied = false;
    }
    if (direction === 'watch_to_server' && REPORTS.has(command)) {
      const scan = inspectV52WifiScan(args);
      base.reportedAt = reportedTime(args);
      base.gpsFlag = ['A', 'V'].includes(args[2]) ? args[2] : null;
      base.batteryPercent = integer(args[12], 0, 100);
      base.scan = { status: scan.status, layout: scan.layout,
        declaredRadios: scan.declaredRadios, rejectedRadios: scan.rejectedRadios,
        radios: scan.accessPoints?.map(radio => ({ ...alias(radio.macAddress), signalDbm: radio.signalStrength })) ?? null };
      // Fixed V52 Appendix I state field, never an LTE-tail guess. These bits
      // do not distinguish GPS and Wi-Fi fences, nor prove physical departure.
      if (['A', 'V'].includes(args[2]) && /^[a-f\d]{8}$/i.test(args[15] || '')) {
        base.trackerState = args[15].toUpperCase();
        const state = parseInt(args[15], 16);
        base.genericFenceExitBit = Boolean(state & (1 << 18));
        base.genericFenceEntryBit = Boolean(state & (1 << 19));
        base.fenceSource = 'unconfirmed';
      }
    }
    return base;
  };
}

function parseArguments(args) {
  return relay.parseArguments(args, { maxMinutes: 90, defaultMinutes: 45 });
}

async function main(args) {
  const options = parseArguments(args);
  const evidence = { profile: 'wifi_comparison_v1', routerAliases: 'this_run_only',
    routerNamesAndAddressesSaved: false, generatesWatchCommands: false, appliedStateVerified: false,
    maxFrames: 2000, maxRouterAliases: MAX_ALIASES };
  if (!options.run) {
    console.log(JSON.stringify({ outcome: 'preview', ...options, ...evidence,
      upstream: relay.BACKENDS[options.backend], ...relay.restorationPlan(options),
      networkOpened: false, fileCreated: false }, null, 2));
    return;
  }
  const capture = await relay.startRelay(options, { summarize: createSummary() });
  console.log(JSON.stringify({ event: 'wifi_observation_ready', ...evidence,
    note: 'Record app actions and notification times separately. Restore supplier settings and Guardian routing before expiry; stopping does not restore either.' }));
  process.once('SIGINT', () => { void capture.stop(); });
  process.once('SIGTERM', () => { void capture.stop(); });
}

if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error('Wi-Fi capture could not start. Check arguments, output path and listen port. Restore Guardian if routing changed.');
  process.exitCode = 1;
});

module.exports = { createSummary, parseArguments, main };
