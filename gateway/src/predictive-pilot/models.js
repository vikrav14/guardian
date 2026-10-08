'use strict';

// Experimental local baselines. No providers, database, transports or commands.
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const VERSION = 'shadow-baseline-v1';
function ms(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = value?.toMillis?.() ?? (value instanceof Date ? +value : typeof value === 'number' ? value : Date.parse(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function localDay(at) { return new Date(at + 4 * HOUR).toISOString().slice(0, 10); }
function localMinute(at) { const d = new Date(at + 4 * HOUR); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function dayStart(at) { return Date.parse(`${localDay(at)}T00:00:00+04:00`); }
function dayKind(at) { return [0, 6].includes(new Date(at + 4 * HOUR).getUTCDay()) ? 'weekend' : 'weekday'; }
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q;
  const low = Math.floor(index), fraction = index - low;
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * fraction;
}
const withheld = (reason, detail = {}) => ({ status: 'withheld', reason, ...detail });
function fresh(at, now, maxAge) { return at != null && at <= now && now - at <= maxAge; }
function validPoint(p) { return typeof p?.lat === 'number' && typeof p?.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180; }
function distance(a, b) {
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Target is the FIRST confirmed return to the chosen Home after noon, per day.
// A last recorded point, Wi-Fi estimate, or gap is never an arrival label.
function homeReturns(journeys, home, now) {
  const days = new Map();
  for (const j of journeys) {
    const at = ms(j.returnAt), departure = ms(j.departureAt);
    const evidence = j.returnEvidence, exit = j.departureEvidence;
    if (!fresh(at, now, 56 * DAY) || !departure || departure >= at || localMinute(at) < 720 ||
        j.originGeofenceId !== home.id || j.closeReason !== 'return_to_origin' ||
        !(j.evidenceVersion >= 3) || j.routeStartAnchored !== true || !(j.pointCount >= 2) ||
        evidence?.classification !== 'inside' || evidence.source !== 'gps' || evidence.gpsValid !== true || evidence.viaWifi === true ||
        exit?.classification !== 'outside' || exit.source !== 'gps' || exit.gpsValid !== true ||
        ms(evidence.recordedAt) !== at || (ms(home.updatedAt) && at < ms(home.updatedAt))) continue;
    const key = localDay(at);
    if (!days.has(key) || at < days.get(key).at) days.set(key, { day: key, at, minute: localMinute(at), kind: dayKind(at) });
  }
  return [...days.values()].sort((a, b) => a.at - b.at);
}

function arrivalForecast({ returns, home, device, now, historyComplete = true }) {
  if (!historyComplete) return withheld('history_query_truncated');
  if (localMinute(now) < 480) return withheld('before_daily_forecast_window');
  if (returns.some(r => r.day === localDay(now))) return withheld('afternoon_return_already_recorded');
  const history = [...new Map(returns.filter(r => r.at < dayStart(now) && now - r.at <= 56 * DAY && r.kind === dayKind(now)).map(r => [r.day, r])).values()];
  if (history.length < 6) return withheld('need_six_comparable_days', { eligibleDays: history.length });
  const minutes = history.map(r => r.minute), lower = quantile(minutes, .1) - 15, upper = quantile(minutes, .9) + 15;
  if (upper - lower > 180) return withheld('routine_too_variable', { eligibleDays: history.length });
  const midpoint = quantile(minutes, .5), issueMinute = localMinute(now);
  if (issueMinute + 30 >= lower) return withheld('too_late_for_prospective_forecast');
  const p = device.lastSatelliteLocation;
  if (p?.source !== 'gps' || p.gpsValid !== true || !validPoint(p) || !fresh(ms(p.recordedAt), now, 20 * MINUTE)) return withheld('fresh_gps_required');
  if (!fresh(ms(device.lastHeartbeatAt), now, 15 * MINUTE)) return withheld('watch_connection_stale');
  if (!validPoint(home.center) || !Number.isFinite(home.radiusMeters) || home.radiusMeters < 1) return withheld('home_boundary_invalid');
  if (distance(p, home.center) <= home.radiusMeters + 100) return withheld('departure_not_established');
  return { status: 'forecast', kind: 'arrival', model: VERSION, issuedAt: now, day: localDay(now),
    target: 'first_confirmed_home_return_after_noon', lowerAt: dayStart(now) + lower * MINUTE,
    upperAt: dayStart(now) + upper * MINUTE, midpointAt: dayStart(now) + midpoint * MINUTE,
    trainingDays: history.length, evidenceThrough: Math.max(...history.map(r => r.at)),
    intervalMeaning: 'Empirical spread plus 15 minutes; not a calibrated probability or current location.' };
}

function batterySample(device, now) {
  const at = ms(device.batteryUpdatedAt), percent = device.batteryPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 || !fresh(at, now, 30 * MINUTE)) return null;
  // Never refresh a battery timestamp from a heartbeat or updatedAt fallback.
  return { at, percent };
}
function dischargeSegment(samples, now) {
  const ordered = samples.filter(s => fresh(s.at, now, 12 * HOUR) && typeof s.percent === 'number' && Number.isFinite(s.percent) && s.percent >= 0 && s.percent <= 100)
    .sort((a, b) => a.at - b.at);
  let segment = [];
  for (const s of ordered) {
    const last = segment.at(-1);
    if (last && s.at === last.at) continue;
    if (last && (s.percent > last.percent || s.at - last.at > 45 * MINUTE)) segment = [];
    segment.push(s);
  }
  return segment;
}
function batteryForecast({ samples, device, now }) {
  const latest = batterySample(device, now);
  if (!latest || !fresh(ms(device.lastHeartbeatAt), now, 15 * MINUTE)) return withheld('fresh_battery_and_connection_required');
  const segment = dischargeSegment(samples, now), first = segment[0], last = segment.at(-1);
  if (!last || last.at !== latest.at || last.percent !== latest.percent) return withheld('latest_sample_not_collected');
  if (last.percent <= 15) return withheld('already_at_reserve_threshold');
  if (segment.length < 4 || last.at - first.at < 90 * MINUTE || first.percent - last.percent < 5 || new Set(segment.map(s => s.percent)).size < 3) return withheld('need_stable_discharge_history', { samples: segment.length });
  const slopes = [];
  for (let i = 0; i < segment.length; i++) for (let j = i + 1; j < segment.length; j++) {
    const hours = (segment[j].at - segment[i].at) / HOUR;
    if (hours >= .5) slopes.push((segment[i].percent - segment[j].percent) / hours);
  }
  const slow = quantile(slopes, .2), fast = quantile(slopes, .8), rate = quantile(slopes, .5);
  if (!(slow > 0) || fast / slow > 3 || fast > 40) return withheld('discharge_too_variable');
  const lowHours = (last.percent - 15) / (fast * 1.2), highHours = (last.percent - 15) / (slow * .8);
  if (highHours > 12) return withheld('beyond_twelve_hour_horizon');
  if (last.at + lowHours * HOUR <= now + 15 * MINUTE) return withheld('too_close_to_threshold');
  return { status: 'forecast', kind: 'battery', model: VERSION, issuedAt: now, day: localDay(now),
    target: 'battery_reaches_15_percent', lowerAt: last.at + lowHours * HOUR,
    upperAt: last.at + highHours * HOUR, midpointAt: last.at + (last.percent - 15) / rate * HOUR,
    trainingSamples: segment.length, evidenceThrough: last.at, startingPercent: last.percent,
    intervalMeaning: 'Recent discharge-rate range; not time to shutdown. Charging or gaps invalidate evaluation.' };
}

function evaluate(prediction, { returns, samples, now }) {
  if (prediction.kind === 'arrival') {
    const actual = returns.find(r => r.day === prediction.day && r.at > prediction.issuedAt);
    if (actual) return { status: 'scored', actualAt: actual.at, withinWindow: actual.at >= prediction.lowerAt && actual.at <= prediction.upperAt, absoluteErrorMinutes: Math.abs(actual.at - prediction.midpointAt) / MINUTE };
    if (now > dayStart(prediction.issuedAt) + DAY + 6 * HOUR) return { status: 'inconclusive', reason: 'no_confirmed_return_evidence' };
    return { status: 'pending' };
  }
  const after = samples.filter(s => s.at >= prediction.evidenceThrough && s.at <= now).sort((a, b) => a.at - b.at);
  if (!after.length || after[0].at !== prediction.evidenceThrough || after[0].percent !== prediction.startingPercent) return { status: 'inconclusive', reason: 'baseline_observation_missing' };
  for (let i = 1; i < after.length; i++) {
    const prev = after[i - 1], current = after[i];
    if (current.percent > prev.percent) return { status: 'inconclusive', reason: 'possible_charging_or_rebound' };
    if (current.at - prev.at > 45 * MINUTE) return { status: 'inconclusive', reason: 'battery_observation_gap' };
    if (current.percent <= 15) {
      // Crossing is bracketed by two observations. Never pretend we know its exact time.
      const definiteHit = prev.at >= prediction.lowerAt && current.at <= prediction.upperAt;
      const definiteMiss = current.at < prediction.lowerAt || prev.at > prediction.upperAt;
      return { status: definiteHit || definiteMiss ? 'scored' : 'inconclusive', reason: 'threshold_crossing_bracket',
        observedBetween: [prev.at, current.at], withinWindow: definiteHit || definiteMiss ? definiteHit : null };
    }
  }
  if (now - (after.at(-1)?.at ?? prediction.evidenceThrough) > 45 * MINUTE) return { status: 'inconclusive', reason: 'battery_observation_gap' };
  if (now > prediction.upperAt + HOUR) return { status: 'scored', withinWindow: false, reason: 'fresh_readings_still_above_threshold' };
  return { status: 'pending' };
}
module.exports = { MINUTE, HOUR, DAY, VERSION, ms, localDay, localMinute, dayStart, dayKind, homeReturns, arrivalForecast, batterySample, dischargeSegment, batteryForecast, evaluate };
