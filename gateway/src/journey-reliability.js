'use strict';

const { JourneyJournal, restoreDates } = require('./journey-journal');
const { normalizeGps, recoverGpsHistory, saveRecoveredJourney, millis } = require('./journey-history-recovery');
const { correctFleetHemisphere } = require('./fleet-hemisphere');

function createJourneyReliability({ directory, journal = new JourneyJournal(directory),
  getDb, appendJourney, readHomeEvidence = () => null, closeAtHome = () => [],
  now = () => Date.now(), report = console.log, onError = console.error } = {}) {
  const queues = new Map(), latestLive = new Map();
  let working = false;

  // Called before packet ACK and before any remote await. Unavailable local
  // storage is an explicit error, rather than acknowledging lost GPS evidence.
  function capture(event, receivedAt = new Date(now()), home = null) {
    if (event.type !== 'location') return null;
    const corrected = correctFleetHemisphere(event);
    const point = normalizeGps({ ...corrected.location,
      source: corrected.location?.source || corrected.accuracySource,
      gpsValid: corrected.gpsValid === true && corrected.location?.gpsValid === true,
      speedKmh: corrected.speedKmh }, +receivedAt);
    if (!point) return null;
    return journal.record(event.imei, point, receivedAt, home);
  }

  function route(event, receivedAt = new Date(now()), home = null) {
    if (event.type !== 'location') return { live: true };
    const id = capture(event, receivedAt, home);
    const at = millis(event.location?.recordedAt);
    const data = id ? journal.read(event.imei) : null;
    const prior = data?.points[id];
    if (prior && ['live', 'home', 'recovered'].includes(prior.status)) return { live: false, reason: 'duplicate_record', id };
    const previous = latestLive.get(event.imei) ?? -Infinity;
    const age = now() - at;
    if (!Number.isFinite(at) || at > now()) return { live: false, reason: 'invalid_source_time', id };
    if (age >= 120000 || at < previous) {
      if (id) journal.mark(event.imei, [id], 'historical');
      return { live: false, reason: id ? 'queued_original_time_history' : 'stale_approximate_observation', id,
        observedAt: new Date(at).toISOString(), receivedAt: new Date(receivedAt).toISOString(), ageSeconds: Math.round(age / 1000) };
    }
    latestLive.set(event.imei, at);
    return { live: true, id };
  }

  function processed(imei, id, held = false) { if (id) journal.mark(imei, [id], held ? 'home' : 'live'); }
  function enqueue(imei, operation) {
    const next = (queues.get(imei) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(imei, next);
    next.finally(() => { if (queues.get(imei) === next) queues.delete(imei); }).catch(() => {});
    return next;
  }

  async function flush() {
    if (working) return;
    working = true;
    try {
      const db = getDb();
      if (!db) return;
      for (const imei of journal.devices()) {
        try {
          // A restored outing can finish on qualified Home radio even if the
          // watch only sends heartbeats after its delayed GPS upload.
          const home = readHomeEvidence(imei);
          if (home && !queues.has(imei)) {
            for (const journey of closeAtHome(imei, home)) journal.queue(imei, journey);
          }
          let data = journal.read(imei);
          // Retry closed trips first; the id is stable across write retries.
          for (const [id, journey] of Object.entries(data.outbox)) {
            await appendJourney(imei, restoreDates(journey));
            journal.delivered(imei, id);
            report(`[journey-durability] saved ${id} (${journey.pointCount} GPS/route points)`);
          }
          data = journal.read(imei);
          const pending = Object.entries(data.points).filter(([,p]) =>
            ['historical', 'recorded'].includes(p.status));
          if (!pending.length || pending.some(([,p]) => now() - millis(p.receivedAt) < 60000)) continue;
          // A still-running live operation owns these points until it completes.
          if (queues.has(imei)) continue;
          const zones = await db.collection('geofences').where('imei', '==', imei).where('active', '==', true).get();
          // Include retained processed GPS as boundary context. Recovery's
          // transaction deduplicates existing routes; Home-held GPS stays out.
          const firstPendingAt = Math.min(...pending.map(([,p]) => millis(p.point.recordedAt)));
          const lastPendingAt = Math.max(...pending.map(([,p]) => millis(p.point.recordedAt)));
          const context = Object.values(data.points).filter(p => p.status !== 'home' &&
            millis(p.point.recordedAt) >= firstPendingAt - 300000 && millis(p.point.recordedAt) <= lastPendingAt + 300000);
          const result = recoverGpsHistory(context.map(p => p.point), {
            now: now(), zones: zones.docs.map(d => ({ id: d.id, ...d.data() })), homeIntervals: data.homeIntervals,
          });
          if (!result.journeys.length) {
            // Keep non-qualifying observations for late corroboration for a full
            // week, then make them eligible for normal bounded retention.
            const reviewed = pending.filter(([,p]) => now() - millis(p.receivedAt) > 7 * 86400000).map(([id]) => id);
            if (reviewed.length) {
              journal.mark(imei, reviewed, 'reviewed_no_trip');
              report(`[journey-recovery] ${reviewed.length} retained observations did not establish a trip`);
            }
            continue;
          }
          for (const candidate of result.journeys) {
            const active = journal.read(imei).checkpoint?.currentJourney;
            if (active && millis(active.startAt) <= millis(candidate.endAt) &&
                millis(active.points?.at(-1)?.recordedAt) >= millis(candidate.startAt)) continue;
            const saved = await saveRecoveredJourney(db, imei, candidate, { apply: true });
            report(`[journey-recovery] ${JSON.stringify(saved)}`);
            if (['recovered', 'already_recorded'].includes(saved.outcome)) {
              journal.mark(imei, pending.filter(([,p]) => millis(p.point.recordedAt) >= millis(candidate.startAt) &&
                millis(p.point.recordedAt) <= millis(candidate.endAt)).map(([id]) => id), 'recovered');
            }
          }
        } catch (error) { onError(`[journey-durability] retry pending: ${error.message}`); }
      }
    } catch (error) { onError(`[journey-durability] unavailable: ${error.message}`); }
    finally { working = false; }
  }

  return { journal, capture, route, processed, enqueue, flush };
}

module.exports = { createJourneyReliability };
