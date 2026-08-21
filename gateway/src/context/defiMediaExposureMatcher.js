'use strict';

const crypto = require('crypto');
const { haversineMeters } = require('../geofence');
const { forwardGeocodeMauritiusPlace } = require('../geolocate/google');
const { isJourneyActive } = require('../live-cache');
const { increment: incrementMetric } = require('../ops-metrics/collector');
const { asDate, policyForEvent } = require('./defiMediaPolicy');

const DEFAULT_LOCATION_FRESH_MINUTES = 15;
const DEFAULT_MAX_APPROXIMATE_ACCURACY_METERS = 1000;
const MIN_APPROACH_SPEED_KMH = 5;
const MAX_APPROACH_HEADING_DIFFERENCE_DEGREES = 60;

function validCoordinates(value) {
  return Number.isFinite(Number(value?.lat)) &&
    Number.isFinite(Number(value?.lng)) &&
    Number(value.lat) >= -90 && Number(value.lat) <= 90 &&
    Number(value.lng) >= -180 && Number(value.lng) <= 180 &&
    !(Number(value.lat) === 0 && Number(value.lng) === 0);
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selectCurrentExposureLocation(device, {
  now = new Date(),
  maxAgeMinutes = DEFAULT_LOCATION_FRESH_MINUTES,
  maxApproximateAccuracyMeters = DEFAULT_MAX_APPROXIMATE_ACCURACY_METERS,
} = {}) {
  const location = device?.lastLocationObservation || device?.location || null;
  if (!validCoordinates(location)) return null;
  const recordedAt = asDate(location.recordedAt);
  if (!recordedAt) return null;
  const ageMs = now.getTime() - recordedAt.getTime();
  if (ageMs < -2 * 60_000 || ageMs > maxAgeMinutes * 60_000) return null;

  const source = String(location.source || device?.accuracySource || '').toLowerCase();
  const satellite = location.gpsValid === true || source === 'gps';
  const accuracyMeters = optionalFiniteNumber(location.accuracyMeters);
  if (
    !satellite &&
    !(
      (source === 'wifi' || source === 'lbs') &&
      Number.isFinite(accuracyMeters) &&
      accuracyMeters > 0 &&
      accuracyMeters <= maxApproximateAccuracyMeters
    )
  ) return null;

  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
    recordedAt: recordedAt.toISOString(),
    ageMinutes: Math.max(0, ageMs / 60_000),
    source: satellite ? 'gps' : source,
    accuracyMeters: satellite ? null : accuracyMeters,
    speedKmh: optionalFiniteNumber(device?.speedKmh),
    course: optionalFiniteNumber(device?.course),
  };
}

function bearingDegrees(from, to) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const toDeg = (radians) => radians * 180 / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLng = toRad(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function headingDifference(left, right) {
  const difference = Math.abs(Number(left) - Number(right)) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function evaluateDeviceExposure({
  event,
  resolvedPlaces,
  device,
  imei,
  outingActive = false,
  now = new Date(),
  maxAgeMinutes,
  maxApproximateAccuracyMeters,
} = {}) {
  if (!event?.actionable || !resolvedPlaces?.length) return null;
  const location = selectCurrentExposureLocation(device, {
    now,
    maxAgeMinutes,
    maxApproximateAccuracyMeters,
  });
  if (!location) return null;
  const policy = policyForEvent(event.eventType);

  const distances = resolvedPlaces.map((place) => ({
    place,
    distanceMeters: haversineMeters(
      location.lat,
      location.lng,
      Number(place.lat),
      Number(place.lng),
    ),
  })).sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = distances[0];
  if (!nearest) return null;
  const uncertaintyMeters = Number(location.accuracyMeters || 0);
  const conservativeDistanceMeters = nearest.distanceMeters + uncertaintyMeters;

  let matchReason = null;
  let headingDifferenceDegrees = null;
  if (conservativeDistanceMeters <= policy.impactRadiusMeters) {
    matchReason = 'current_proximity';
  } else if (
    outingActive &&
    location.source === 'gps' &&
    nearest.distanceMeters <= policy.approachRadiusMeters &&
    location.speedKmh != null && location.speedKmh >= MIN_APPROACH_SPEED_KMH &&
    location.course != null
  ) {
    const bearing = bearingDegrees(location, nearest.place);
    headingDifferenceDegrees = headingDifference(location.course, bearing);
    if (headingDifferenceDegrees <= MAX_APPROACH_HEADING_DIFFERENCE_DEGREES) {
      matchReason = 'active_journey_approach';
    }
  }
  if (!matchReason) return null;

  return {
    eventDocumentId: event.documentId,
    eventId: event.id,
    eventType: event.eventType,
    title: event.title,
    publishedAt: event.publishedAt,
    actionableUntil: event.actionableUntil,
    imei: String(imei),
    placeName: nearest.place.placeName,
    distanceMeters: Math.round(nearest.distanceMeters),
    uncertaintyMeters: Math.round(uncertaintyMeters),
    matchReason,
    headingDifferenceDegrees:
      headingDifferenceDegrees == null ? null : Math.round(headingDifferenceDegrees),
    location,
    observeOnly: true,
    deliverySent: false,
  };
}

async function resolveEventPlaces(event, resolvePlace = forwardGeocodeMauritiusPlace) {
  const places = [];
  for (const name of [...new Set(event?.placeMentions || [])]) {
    const resolved = await resolvePlace(name);
    if (validCoordinates(resolved)) places.push({ ...resolved, placeName: name });
  }
  return places;
}

async function loadServiceOwnerUids(db, imei) {
  const snapshot = await db.collection('users')
    .where('linkedImeis', 'array-contains', String(imei))
    .get();
  incrementMetric('firestoreReads', snapshot.docs?.length || 0);
  return [...new Set((snapshot.docs || []).map((doc) => {
    const user = doc.data() || {};
    return String(user.serviceOwnerUid || doc.id);
  }).filter(Boolean))];
}

function exposureDocumentId(eventDocumentId, ownerUid) {
  return crypto.createHash('sha256')
    .update(`${eventDocumentId}:${ownerUid}`)
    .digest('hex')
    .slice(0, 40);
}

async function claimFamilyExposure(db, match, now = new Date()) {
  const id = exposureDocumentId(match.eventDocumentId, match.serviceOwnerUid);
  const ref = db.collection('contextNewsMatches').doc(id);
  const payload = {
    ...match,
    matchId: id,
    firstMatchedAt: now.toISOString(),
    observeOnly: true,
    deliveryEligible: false,
    deliverySent: false,
  };
  try {
    if (typeof ref.create === 'function') await ref.create(payload);
    else {
      const snapshot = await ref.get();
      incrementMetric('firestoreReads');
      if (snapshot.exists) return { created: false, id };
      await ref.set(payload);
    }
    incrementMetric('firestoreWrites');
    incrementMetric('contextNewsMatchWrites');
    return { created: true, id };
  } catch (error) {
    const code = String(error.code || '').toLowerCase();
    if (code === '6' || code.includes('already-exists') || code.includes('already_exists')) {
      return { created: false, id };
    }
    throw error;
  }
}

async function evaluateNewsExposure({
  db,
  candidates = [],
  now = new Date(),
  config = {},
  resolvePlace = forwardGeocodeMauritiusPlace,
  journeyActive = isJourneyActive,
  persist = true,
} = {}) {
  const summary = {
    candidatesEvaluated: candidates.length,
    candidatesUnresolved: 0,
    devicesRead: 0,
    deviceMatches: 0,
    familyMatches: 0,
    newFamilyMatches: 0,
    duplicateFamilyMatches: 0,
    matches: [],
    observeOnly: true,
    automaticDelivery: false,
  };
  if (!db || !candidates.length) return summary;

  let query = db.collection('devices');
  const maxDevices = Math.max(1, Number(config.contextMaxDevicesPerSweep || 1000));
  if (typeof query.limit === 'function') query = query.limit(maxDevices);
  const deviceSnapshot = await query.get();
  const deviceDocs = Array.from(deviceSnapshot.docs || []).slice(0, maxDevices);
  summary.devicesRead = deviceDocs.length;
  incrementMetric('firestoreReads', deviceDocs.length);

  const deviceMatches = [];
  for (const event of candidates) {
    const resolvedPlaces = await resolveEventPlaces(event, resolvePlace);
    if (!resolvedPlaces.length) {
      summary.candidatesUnresolved += 1;
      continue;
    }
    for (const doc of deviceDocs) {
      const match = evaluateDeviceExposure({
        event,
        resolvedPlaces,
        device: doc.data() || {},
        imei: doc.id,
        outingActive: journeyActive(doc.id),
        now,
        maxAgeMinutes: Number(
          config.contextDefiMediaLocationFreshMinutes || DEFAULT_LOCATION_FRESH_MINUTES,
        ),
        maxApproximateAccuracyMeters: Number(
          config.contextDefiMediaMaxApproxAccuracyMeters ||
          DEFAULT_MAX_APPROXIMATE_ACCURACY_METERS,
        ),
      });
      if (match) deviceMatches.push(match);
    }
  }
  summary.deviceMatches = deviceMatches.length;

  const ownerCache = new Map();
  const familyGroups = new Map();
  for (const match of deviceMatches) {
    if (!ownerCache.has(match.imei)) {
      ownerCache.set(match.imei, await loadServiceOwnerUids(db, match.imei));
    }
    for (const ownerUid of ownerCache.get(match.imei)) {
      const key = `${match.eventDocumentId}:${ownerUid}`;
      const existing = familyGroups.get(key);
      if (!existing) {
        familyGroups.set(key, {
          eventDocumentId: match.eventDocumentId,
          eventId: match.eventId,
          eventType: match.eventType,
          title: match.title,
          publishedAt: match.publishedAt,
          actionableUntil: match.actionableUntil,
          serviceOwnerUid: ownerUid,
          impactedImeis: [match.imei],
          matchReason: match.matchReason,
          nearestDistanceMeters: match.distanceMeters,
          placeName: match.placeName,
        });
      } else {
        if (!existing.impactedImeis.includes(match.imei)) existing.impactedImeis.push(match.imei);
        if (match.distanceMeters < existing.nearestDistanceMeters) {
          existing.nearestDistanceMeters = match.distanceMeters;
          existing.matchReason = match.matchReason;
          existing.placeName = match.placeName;
        }
      }
    }
  }

  summary.familyMatches = familyGroups.size;
  for (const familyMatch of familyGroups.values()) {
    let claim = { created: true, id: null };
    if (persist) claim = await claimFamilyExposure(db, familyMatch, now);
    if (claim.created) summary.newFamilyMatches += 1;
    else summary.duplicateFamilyMatches += 1;
    if (summary.matches.length < 20) {
      summary.matches.push({ ...familyMatch, matchId: claim.id, newMatch: claim.created });
    }
  }
  incrementMetric('contextNewsExposureMatches', summary.familyMatches);
  return summary;
}

module.exports = {
  DEFAULT_LOCATION_FRESH_MINUTES,
  DEFAULT_MAX_APPROXIMATE_ACCURACY_METERS,
  MAX_APPROACH_HEADING_DIFFERENCE_DEGREES,
  MIN_APPROACH_SPEED_KMH,
  bearingDegrees,
  claimFamilyExposure,
  evaluateDeviceExposure,
  evaluateNewsExposure,
  exposureDocumentId,
  headingDifference,
  loadServiceOwnerUids,
  optionalFiniteNumber,
  resolveEventPlaces,
  selectCurrentExposureLocation,
  validCoordinates,
};
