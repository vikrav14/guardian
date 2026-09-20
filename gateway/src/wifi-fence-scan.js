'use strict';

const { normalizeRouterId } = require('./wifi-home-observer');

// Private radio evidence: Appendix I has a fixed state/cell-count prefix, variable
// cell records, then a Wi-Fi count and up to five name/MAC/RSSI triplets.
// The already-tested nameless MAC/RSSI variant is also recognised explicitly.
// Never search arbitrary fields for a MAC: an SSID can itself look like one.
const MAX_CELLS = 32; // Defensive parsing bound, not a firmware capability claim.
const MAX_RADIOS = 5;
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$|^(?:[0-9a-f]{2}-){5}[0-9a-f]{2}$/i;

function integer(value, min, max) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function inspectV52WifiScan(args) {
  const unavailable = (status, declaredRadios = null) => ({
    status, layout: null, declaredRadios, accessPoints: null, rejectedRadios: null,
  });
  if (!Array.isArray(args) || args.length < 17 ||
      !['A', 'V'].includes(args[2]) || !/^[0-9a-f]{8}$/i.test(args[15] || '')) {
    return unavailable('unsupported_layout');
  }
  const cells = integer(args[16], 0, MAX_CELLS);
  if (cells == null) return unavailable('invalid_cell_count');
  // Zero means that no base-station information follows. Otherwise skip the
  // link delay, MCC, MNC and three fields (area/cell/signal) per base station.
  const countIndex = cells === 0 ? 17 : 20 + cells * 3;
  if (args.length <= countIndex) return unavailable('not_reported');
  if (cells > 0 && (integer(args[17], 0, 65535) == null ||
      integer(args[18], 200, 999) == null || integer(args[19], 0, 999) == null)) {
    return unavailable('unsupported_cell_layout');
  }
  const count = integer(args[countIndex], 0, MAX_RADIOS);
  if (count == null) return unavailable('invalid_radio_count');
  const tail = args.slice(countIndex + 1);
  // The optional final field is the supplier's reference positioning accuracy.
  const validLength = width => tail.length === count * width ||
    (tail.length === count * width + 1 && typeof tail.at(-1) === 'string' &&
      /^\d+(?:\.\d+)?$/.test(tail.at(-1).trim()));
  if (count === 0) {
    return validLength(0)
      ? { status: 'decoded', layout: 'empty', declaredRadios: 0,
        accessPoints: [], rejectedRadios: 0 }
      : unavailable('invalid_radio_entries', 0);
  }
  for (const width of [3, 2]) {
    if (!validLength(width)) continue;
    const accessPoints = [];
    let rejectedRadios = 0;
    let valid = true;
    for (let i = 0; i < count; i++) {
      const rawMac = tail[i * width + width - 2];
      const signalStrength = integer(tail[i * width + width - 1], -128, 0);
      if (typeof rawMac !== 'string' || !MAC.test(rawMac.trim()) || signalStrength == null) {
        valid = false;
        break;
      }
      const macAddress = normalizeRouterId(rawMac);
      if (macAddress) accessPoints.push({ macAddress, signalStrength });
      else rejectedRadios++; // Null/multicast addresses are never Home evidence.
    }
    if (valid) return { status: 'decoded', layout: width === 3 ? 'named' : 'nameless',
      declaredRadios: count, accessPoints, rejectedRadios };
  }
  return unavailable('invalid_radio_entries', count);
}

module.exports = { inspectV52WifiScan };
