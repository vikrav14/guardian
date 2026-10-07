'use strict';

const admin = require('firebase-admin');
const { buildPriorityUpdates, mediaCandidate, healthy } = require('./priorityUpdates');
const { forwardGeocodeMauritiusPlace } = require('../geolocate/google');
const { increment } = require('../ops-metrics/collector');
const resolveWithTimeout = place => forwardGeocodeMauritiusPlace(place, {
  fetchImpl: url => fetch(url, { signal: AbortSignal.timeout(8000) }),
});

// Uses the process-wide source providers; no extra RSS poll, AI call, watch
// command or notification. Default-off, with an optional reviewed pilot list.
function startPriorityUpdateScheduler({ db, mediaProvider, capProvider, config = {},
  now = Date.now, resolvePlace = resolveWithTimeout,
  onError = error => console.warn('[priority-updates]', error.message) } = {}) {
  if (!db || config.priorityUpdatesEnabled !== true) return { active: false, stop() {} };
  const published = new Map();
  const placeCache = new Map();
  async function resolveCachedPlace(name) {
    const existing = placeCache.get(name);
    if (existing?.until > now()) return existing.value;
    let value = null;
    try { value = await resolvePlace(name); } catch { /* Unresolved areas stay hidden. */ }
    // Cache failed lookups too: never multiply requests by the fleet size.
    placeCache.set(name, { value, until: now() + 15 * 60000 });
    return value;
  }
  let running = false, stopped = false, cursor = null;
  const requestedPilot = config.priorityUpdateImeis || [];
  if (requestedPilot.some(id => !/^\d{15}$/.test(id))) {
    onError(new Error('Invalid priority update pilot IMEI; scheduler disabled'));
    return { active: false, stop() {} };
  }
  const pilot = [...new Set(requestedPilot)];
  const snapshots = () => ({
    media: config.contextDefiMediaEnabled ? mediaProvider?.getPrioritySnapshot() : null,
    cap: config.contextCapEnabled ? capProvider?.getSnapshot() : null,
  });
  const stamp = sources => JSON.stringify([sources.media?.lastPollAt, sources.media?.lastSuccessAt,
    sources.media?.lastError, sources.cap?.lastPollAt, sources.cap?.lastSuccessAt, sources.cap?.lastError]);
  async function runNow() {
    if (running || stopped) return;
    running = true;
    try {
      const clock = now();
      const sources = snapshots();
      const { media, cap } = sources;
      const possible = (healthy(media, clock, 30 * 60000) && media.items.some(item => mediaCandidate(item, clock))) ||
        (healthy(cap, clock, 10 * 60000) && cap.activeAlerts.some(alert => alert.active));
      if (!possible) {
        for (const imei of [...published.keys()]) {
          await db.collection('devices').doc(imei).collection('localUpdates').doc('current')
            .set({ schemaVersion: 1, location: null, items: [], expiresAt: new Date(clock).toISOString() });
          increment('firestoreWrites');
          published.delete(imei);
        }
        return;
      }
      let docs;
      if (pilot.length) docs = await Promise.all(pilot.map(imei => db.collection('devices').doc(imei).get()));
      else {
        const firstPage = db.collection('devices').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
        let query = firstPage;
        if (cursor) query = query.startAfter(cursor);
        let snapshot = await query.get();
        if (cursor && !snapshot.docs.length) {
          // Exact multiples of 100 must not waste a whole minute on an empty page.
          increment('firestoreReads');
          snapshot = await firstPage.get();
        }
        docs = snapshot.docs;
        cursor = docs.length === 100 ? docs[docs.length - 1].id : null;
      }
      increment('firestoreReads', docs.length);
      for (const doc of docs) {
        if (stopped) break;
        if (!doc.exists) continue;
        const projection = await buildPriorityUpdates({ device: doc.data(), media, cap, resolvePlace: resolveCachedPlace, now: clock });
        const encoded = JSON.stringify(projection);
        // Empty state timestamps change, but an already-empty watch needs no write.
        if ((!projection.items.length && !published.has(doc.id)) || published.get(doc.id) === encoded) continue;
        // Never publish a result whose location expired during source resolution.
        if (projection.items.length && (projection.items.some(item => new Date(item.expiresAt).getTime() <= now()) ||
            stamp(sources) !== stamp(snapshots()))) continue;
        await db.collection('devices').doc(doc.id).collection('localUpdates').doc('current').set(projection);
        increment('firestoreWrites');
        if (projection.items.length) published.set(doc.id, encoded);
        else published.delete(doc.id);
      }
    } catch (error) { onError(error); }
    finally { running = false; }
  }
  const timer = setInterval(runNow, 60000);
  timer.unref?.();
  setImmediate(runNow);
  return { active: true, runNow, stop() { stopped = true; clearInterval(timer); } };
}
module.exports = { startPriorityUpdateScheduler };
