'use strict';

const crypto = require('node:crypto');
const { isJourneyGps, hasJourneyGpsEvidence } = require('./journey-source-evidence');
const { haversineMeters, classifyBoundaryObservation } = require('./geofence');
const { forceCloseJourney } = require('./journey-builder');
const { decodePolyline } = require('./polyline');
const { buildJourneyDocumentId } = require('./journey-id');
const { readHomeWifiPriority } = require('./wifi-home-display-policy');

const DAY_MS = 86400000;
function millis(value) {
  if (value == null) return NaN;
  const date = value?.toDate?.() ?? value;
  return new Date(date).getTime();
}
function dayStart(at) { return Math.floor((at + 4 * 3600000) / DAY_MS) * DAY_MS - 4 * 3600000; }
function pointIdentity(p) { return `${millis(p.recordedAt)}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`; }
function normalizeGps(point, now = Date.now()) {
  const at = millis(point?.recordedAt);
  if (!isJourneyGps(point) || !Number.isFinite(at) || at < 0 || at > now ||
      typeof point.lat !== 'number' || typeof point.lng !== 'number' ||
      !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180 ||
      (Math.abs(point.lat) < 0.0001 && Math.abs(point.lng) < 0.0001)) return null;
  return { lat: point.lat, lng: point.lng, source: 'gps', accuracySource: 'gps', gpsValid: true,
    recordedAt: new Date(at), speedKmh: Number.isFinite(point.speedKmh) ? point.speedKmh : null,
    satellites: Number.isFinite(point.satellites) ? point.satellites : null,
    accuracyMeters: Number.isFinite(point.accuracyMeters) && point.accuracyMeters > 0 ? point.accuracyMeters : null };
}

function inside(point, zone) {
  return classifyBoundaryObservation({ distance: haversineMeters(point.lat, point.lng, zone.lat, zone.lng),
    radius: zone.radiusMeters, location: point }).classification;
}
function normalizedZones(zones) {
  return zones.map(z => ({ id: z.id, lat: z.center?.lat ?? z.lat, lng: z.center?.lng ?? z.lng,
    radiusMeters: z.radiusMeters })).filter(z => Number.isFinite(z.lat) && Number.isFinite(z.lng) &&
    Number.isFinite(z.radiusMeters) && z.radiusMeters > 0);
}

function documentForPoints(points, { reason = 'delayed_gps_recovery', recoveredAt = new Date() } = {}) {
  const state = { currentJourney: { points, startAt: points[0].recordedAt, events: [],
    diagnosticEvents: [], observationAudit: {} } };
  const doc = forceCloseJourney(state, points.at(-1).recordedAt, reason);
  if (!doc) return null;
  doc.recovery = { version: 1, source: 'timestamped_satellite_history', recoveredAt,
    alertsGenerated: false, timestamps: 'original_observation_time' };
  return doc;
}

// Pure history reconstruction: never calls the live geofence cache, reporting,
// notifications, Home publisher or current-location writer.
function recoverGpsHistory(rawPoints, { now = Date.now(), zones = [], homeIntervals = [] } = {}) {
  const validZones = normalizedZones(zones);
  const byTime = new Map(), conflicts = new Set();
  let rejected = 0;
  for (const raw of rawPoints) {
    const point = normalizeGps(raw, now);
    if (!point) { rejected++; continue; }
    const at = +point.recordedAt;
    if (byTime.has(at) && pointIdentity(byTime.get(at)) !== pointIdentity(point)) conflicts.add(at);
    else byTime.set(at, point);
  }
  const points = [...byTime.entries()].filter(([at]) => !conflicts.has(at)).map(([,p]) => p)
    .sort((a,b) => +a.recordedAt - +b.recordedAt);
  const journeys = [];
  let candidate = [], anchor = null, outsideCount = 0, candidateOrigin = null;
  function finish() {
    if (candidate.length >= 2 && (!validZones.length || outsideCount >= 2)) {
      const displacement = Math.max(...candidate.map(p => haversineMeters(candidate[0].lat, candidate[0].lng, p.lat, p.lng)));
      const doc = documentForPoints(candidate, { recoveredAt: new Date(now) });
      if (displacement >= 50 && doc?.distanceKm >= 0.02) journeys.push(doc);
    }
    candidate = []; outsideCount = 0; candidateOrigin = null;
  }
  for (const point of points) {
    const at = +point.recordedAt;
    const radioHome = homeIntervals.some(h => readHomeWifiPriority({ homeWifiPresence: h }, { now: new Date(at) }));
    if (radioHome) { finish(); anchor = null; continue; }
    const classes = validZones.map(z => ({ zone: z, state: inside(point, z) }));
    const insideZone = classes.find(c => c.state === 'inside')?.zone;
    const outsideAll = !classes.length || classes.every(c => c.state === 'outside');
    if (candidate.length) {
      const last = candidate.at(-1), gap = at - +last.recordedAt;
      const metres = haversineMeters(last.lat, last.lng, point.lat, point.lng);
      if (dayStart(at) !== dayStart(+last.recordedAt) || gap > 3600000) { finish(); anchor = null; }
      // Never join through an implausible hop, even if the packet says gps=A.
      else if (metres > 5000 || (gap > 0 && metres / gap * 3600 > 250)) {
        finish(); anchor = null; rejected++; continue;
      }
    }
    if (!candidate.length) {
      if (insideZone) { anchor = { point, zone: insideZone }; continue; }
      if (!outsideAll) continue;
      if (anchor && at - +anchor.point.recordedAt <= 300000) {
        const gap = at - +anchor.point.recordedAt;
        const metres = haversineMeters(anchor.point.lat, anchor.point.lng, point.lat, point.lng);
        if (dayStart(at) === dayStart(+anchor.point.recordedAt) && gap > 0 && metres <= 5000 && metres / gap * 3600 <= 250) {
          candidate.push(anchor.point); candidateOrigin = anchor.zone.id;
        }
      }
      candidate.push(point); outsideCount = 1; anchor = null;
    } else {
      candidate.push(point);
      if (outsideAll) outsideCount++;
      if (insideZone && (!candidateOrigin || insideZone.id === candidateOrigin)) {
        finish(); anchor = { point, zone: insideZone };
      }
    }
  }
  finish();
  return { journeys, acceptedPoints: points.length, rejectedPoints: rejected + conflicts.size,
    reason: journeys.length ? 'recoverable_satellite_history' : 'insufficient_qualified_satellite_history' };
}

function pointsFromJourney(journey) {
  if (!hasJourneyGpsEvidence(journey)) return [];
  const coordinates = decodePolyline(journey.polyline);
  if (coordinates.length !== journey.pointCount) return [];
  const start = millis(journey.startAt);
  return coordinates.map((p,i) => ({ ...p, ...journey.pointEvidence[i],
    recordedAt: new Date(start + Number(journey.pointEvidence[i].offsetMs)) })).filter(isJourneyGps);
}

// Serialize recovery for a device/day using a backend-only transaction lock.
// Existing confirmed outings are retained; contained samples may fill their gaps.
async function saveRecoveredJourney(db, imei, candidate, { apply = false } = {}) {
  const start = millis(candidate.startAt), end = millis(candidate.endAt);
  const collection = db.collection('devices').doc(imei).collection('journeys');
  const query = collection.where('startAt', '>=', new Date(dayStart(start)))
    .where('startAt', '<', new Date(dayStart(start) + DAY_MS));
  const lockId = crypto.createHash('sha256').update(`${imei}:${dayStart(start)}`).digest('hex');
  const lock = db.collection('journeyRecoveryLocks').doc(lockId);
  async function decide(reader, writer) {
    const locked = await reader(lock);
    const snap = await reader(query);
    const overlap = snap.docs.filter(doc => millis(doc.data().startAt) <= end && millis(doc.data().endAt) >= start);
    const candidatePoints = pointsFromJourney(candidate);
    if (candidatePoints.length < 2) return { outcome: 'invalid_candidate' };
    let journey = candidate, ref = collection.doc(buildJourneyDocumentId(imei, candidate));
    if (overlap.length > 1) return { outcome: 'overlap_requires_review', existingCount: overlap.length };
    if (overlap.length === 1) {
      const previous = overlap[0].data();
      const oldPoints = pointsFromJourney(previous);
      if (!oldPoints.length) return { outcome: 'overlap_requires_review', existingCount: 1 };
      const identities = new Set(oldPoints.map(pointIdentity));
      if (candidatePoints.every(p => identities.has(pointIdentity(p)))) return { outcome: 'already_recorded', id: overlap[0].id };
      if ((previous.closeReason === 'return_to_origin' || previous.events?.some(e => e.type === 'outing_return')) &&
          (start < millis(previous.startAt) || end > millis(previous.endAt))) {
        return { outcome: 'confirmed_boundary_requires_review', id: overlap[0].id };
      }
      const merged = [...new Map([...oldPoints, ...candidatePoints].map(p => [pointIdentity(p),p])).values()]
        .sort((a,b) => millis(a.recordedAt) - millis(b.recordedAt));
      if (new Set(merged.map(p => millis(p.recordedAt))).size !== merged.length) return { outcome: 'conflicting_timestamp_requires_review' };
      if (merged.some((point, i) => i > 0 && (
        haversineMeters(merged[i - 1].lat, merged[i - 1].lng, point.lat, point.lng) > 5000 ||
        haversineMeters(merged[i - 1].lat, merged[i - 1].lng, point.lat, point.lng) /
          (millis(point.recordedAt) - millis(merged[i - 1].recordedAt)) * 3600 > 250
      ))) return { outcome: 'implausible_merge_requires_review' };
      const rebuilt = documentForPoints(merged);
      journey = { ...previous, ...rebuilt, events: previous.events || [],
        closeReason: previous.closeReason || rebuilt.closeReason };
      ref = overlap[0].ref;
    }
    if (writer) {
      writer.set(ref, { ...journey, journeyId: ref.id, createdAt: journey.createdAt || new Date() });
      // Presentation indexes belong to the old polyline; raw route renders safely.
      writer.delete(ref.collection('presentations').doc('google_v1'));
      writer.set(lock, { revision: Number(locked.data()?.revision || 0) + 1, updatedAt: new Date() });
    }
    return { outcome: writer ? 'recovered' : 'preview', id: ref.id, points: journey.pointCount,
      startAt: new Date(millis(journey.startAt)).toISOString(), endAt: new Date(millis(journey.endAt)).toISOString(),
      distanceKm: journey.distanceKm, gapCount: journey.routeGaps?.length || 0 };
  }
  if (!apply) return decide(ref => ref.get(), null);
  return db.runTransaction(tx => decide(ref => tx.get(ref), tx));
}

module.exports = { normalizeGps, recoverGpsHistory, saveRecoveredJourney, pointsFromJourney, millis, dayStart };
