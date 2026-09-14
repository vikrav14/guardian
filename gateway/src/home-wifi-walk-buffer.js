'use strict';

const { isJourneyGps } = require('./journey-source-evidence');
const { millis, validCoordinates } = require('./wifi-home-gps-policy');
const { haversineMeters, classifyBoundaryObservation, boundaryUncertaintyMeters } = require('./geofence');

const WALK_POLICY = Object.freeze({ maxPoints: 16, maxAgeMs: 120_000,
  minSpanMs: 20_000, maxGapMs: 60_000, maxSpeedMps: 3, readTimeoutMs: 5_000 });

function boundary(point, anchor) {
  return classifyBoundaryObservation({ location: point, wifiMatch: false,
    radius: anchor.radiusMeters,
    distance: haversineMeters(point.lat, point.lng, anchor.lat, anchor.lng) }).classification;
}

function usable(point, clock) {
  const at = millis(point?.recordedAt);
  return isJourneyGps(point) && validCoordinates(point) && Number.isFinite(at) &&
    at <= clock && clock - at < WALK_POLICY.maxAgeMs &&
    boundaryUncertaintyMeters(point) <= 50 &&
    (point.satellites == null || (Number.isFinite(point.satellites) && point.satellites >= 4));
}

function qualifies(points, anchor, clock) {
  if (points.length < 2 || !points.every(point => usable(point, clock)) ||
      boundary(points[0], anchor) !== 'outside' ||
      points.some(point => boundary(point, anchor) === 'inside')) return false;
  const first = points[0], last = points.at(-1);
  const span = millis(last.recordedAt) - millis(first.recordedAt);
  const displacement = haversineMeters(first.lat, first.lng, last.lat, last.lng);
  if (span < WALK_POLICY.minSpanMs ||
      displacement < Math.max(20, boundaryUncertaintyMeters(first) + boundaryUncertaintyMeters(last))) return false;
  return points.slice(1).every((point, index) => {
    const previous = points[index];
    const gap = millis(point.recordedAt) - millis(previous.recordedAt);
    return gap > 0 && gap <= WALK_POLICY.maxGapMs &&
      haversineMeters(point.lat, point.lng, previous.lat, previous.lng) / (gap / 1000) <= WALK_POLICY.maxSpeedMps;
  });
}

// One instance belongs to the already enrolled private pilot. It never sends a
// watch command, renews Home, rewrites telemetry or restores data after restart.
function createHomeWifiWalkBuffer({ readContext, recover, now = Date.now,
  report = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null, working = false, stopped = false, generation = 0, abort = null;
  let activeLastSource = null;
  function discard() {
    pending = null; generation++;
    abort?.abort(new Error('home_walk_cancelled'));
  }
  function observe(point, clock = now()) {
    if (stopped) return;
    const context = readContext(clock);
    if (!context?.ready) { discard(); return; }
    if (!context.home) {
      // Live GPS owns the normal path and invalidates any asynchronous replay.
      // An old/repeated packet cannot erase newer retained GPS. Match the
      // normal path's clock tolerance when deciding which live fix supersedes it.
      const source = millis(point?.recordedAt);
      const latest = pending?.points.at(-1)?.recordedAt ?? activeLastSource;
      if (isJourneyGps(point) && validCoordinates(point) && Number.isFinite(source) &&
          source <= clock + 15_000 && clock - source < WALK_POLICY.maxAgeMs &&
          (latest == null || source > millis(latest))) discard();
      return;
    }
    const homeAt = millis(context.home.observedAt);
    if (pending && (pending.key !== context.key || pending.homeAt !== homeAt)) discard();
    if (!usable(point, clock) || millis(point.recordedAt) <= homeAt) return;
    const previous = pending?.points.at(-1);
    if (previous && millis(point.recordedAt) <= millis(previous.recordedAt)) return;
    const classification = boundary(point, context.anchor);
    if (classification === 'inside') { discard(); return; }
    if (!pending) {
      if (classification !== 'outside') return;
      pending = { key: context.key, anchor: { ...context.anchor }, homeAt, points: [] };
    }
    if (pending.points.length >= WALK_POLICY.maxPoints) { discard(); return; }
    pending.points.push({ ...point, recordedAt: new Date(millis(point.recordedAt)) });
  }

  async function tick() {
    if (stopped || working || !pending) return;
    const clock = now(), context = readContext(clock), batch = pending;
    if (!context?.ready || context.key !== batch.key ||
        !batch.points.every(point => usable(point, clock))) { discard(); return; }
    if (context.home) {
      if (millis(context.home.observedAt) !== batch.homeAt) discard();
      return;
    }
    // A binding failure, weak scan, malformed packet or missing observation is
    // not radio expiry. New live GPS continues through the established path.
    if (context.observation?.reason !== 'observation_expired' ||
        millis(context.observation.observedAt) !== batch.homeAt ||
        !qualifies(batch.points, batch.anchor, clock)) { discard(); return; }
    pending = null;
    const token = generation;
    activeLastSource = batch.points.at(-1).recordedAt;
    const controller = new AbortController(); abort = controller; working = true;
    const current = () => {
      const state = readContext(now());
      return !stopped && token === generation && !controller.signal.aborted &&
        state?.ready && state.key === batch.key && !state.home &&
        state.observation?.reason === 'observation_expired' &&
        millis(state.observation.observedAt) === batch.homeAt &&
        qualifies(batch.points, batch.anchor, now());
    };
    const timer = setTimer(() => controller.abort(new Error('home_walk_read_timeout')), WALK_POLICY.readTimeoutMs);
    timer.unref?.();
    try {
      const result = await recover(batch.points, batch, current, controller.signal);
      if (result?.recovered) report({ outcome: 'recovered', gpsPoints: batch.points.length,
        startedAt: batch.points[0].recordedAt.toISOString(),
        lastGpsAt: batch.points.at(-1).recordedAt.toISOString() });
      if (result?.delivery) void result.delivery.then(writes => {
        const failedWrites = writes.filter(write => write.status === 'rejected').length;
        if (failedWrites) report({ outcome: 'delivery_failed', failedWrites });
      });
    } catch {
      report({ outcome: 'recovery_unavailable' });
    } finally {
      clearTimer(timer); if (abort === controller) abort = null;
      activeLastSource = null; working = false;
    }
  }
  return { observe, tick, stop: () => { stopped = true; discard(); } };
}

module.exports = { WALK_POLICY, qualifies, createHomeWifiWalkBuffer };
