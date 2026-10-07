'use strict';

// Presentation eligibility is deliberately stricter than the existing shadow
// keyword matcher. A headline is evidence of a report, never wearer danger.
const { createHash } = require('node:crypto');
const { extractPlaceMentions, normalizeForMatch, safeSourceUrl } = require('./defiMediaRssProvider');
const { matchAlertArea } = require('./capAlertProvider');
const { haversineMeters } = require('../geofence');
const { readHomeWifiDisplay, readHomeWifiConflict } = require('../wifi-home-display-policy');
const { readLastHomeWifiDetection } = require('../last-home-wifi-detection');
const { selectCurrentExposureLocation } = require('./defiMediaExposureMatcher');
const MINUTE = 60000, LOCATION_AGE = 15 * MINUTE;
const ms = value => value?.toMillis?.() ?? (value == null ? NaN : +new Date(value));
const dated = (value, now, maxAge) => Number.isFinite(ms(value)) && ms(value) <= now + MINUTE && now - ms(value) < maxAge;
const iso = value => new Date(value).toISOString();
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

function priorityLocation(device, now) {
  if (readHomeWifiConflict(device, { now: new Date(now) })) return null;
  const home = readHomeWifiDisplay(device, { now: new Date(now) });
  if (home) return { lat: home.lat, lng: home.lng, source: 'home_wifi',
    recordedAt: iso(home.recordedAt), expiresAt: iso(home.expiresAt),
    accuracyMeters: Number(device.homeWifiPresence?.anchor?.radiusMeters || 0) };
  const location = selectCurrentExposureLocation(device, { now: new Date(now), maxAgeMinutes: 15 });
  if (!location || !dated(location.recordedAt, now, LOCATION_AGE)) return null;
  // Never revert to the earlier trip after fresh Home evidence expires.
  const remembered = readLastHomeWifiDetection(device, { now: new Date(now) });
  if (remembered && ms(remembered.recordedAt) >= ms(location.recordedAt)) return null;
  return { lat: location.lat, lng: location.lng, source: location.source,
    recordedAt: location.recordedAt, accuracyMeters: location.accuracyMeters || 0,
    expiresAt: iso(ms(location.recordedAt) + LOCATION_AGE) };
}

const HISTORICAL = /\b(hier|yesterday|avant hier|la veille|semaine derniere|last week|mois dernier|last month|arrete|arrestation|arrested|tribunal|court|proces|enquete|investigation|suspect interpell|maitrise|eteint|retour a la normale|rouverte|reopened|levee|fin de l alerte|exercice|simulation|drill|exclusif|interview|rumeur|rumour|rumor|dementi|dement|fausse alerte|false alarm|aucun|aucune|pas de|no longer|termine|terminee|extinguished|contained)\b/;
const CURRENT = /\b(en cours|actuellement|en ce moment|toujours|maintenant|currently|ongoing|right now|still|jusqu a nouvel ordre|until further notice)\b/;
const TYPES = [
  ['public_safety', /\b(fusillade|coups? de feu|tireur|armed incident|shooting|perimetre de securite|cordon policier|police cordon|evacuation|explosion|fuite de gaz|emeute|violent disturbance)\b/, 3, 90, 1500],
  ['fire', /\b(incendie|fire|flammes)\b/, 3, 120, 2000],
  ['flood_or_landslide', /\b(inondation|inondations|flooding|glissement de terrain|landslide|route submergee)\b/, 3, 180, 2500],
  ['road_disruption', /\b(route bloquee|route fermee|trafic bloque|trafic interrompu|road closed|road closure|road blocked|deviation routiere)\b/, 2, 120, 1500],
  ['infrastructure_disruption', /\b(coupure d eau|coupure d electricite|power outage|water outage|pont ferme)\b/, 1, 180, 2000],
];
function mediaCandidate(item, now) {
  if (!item || !safeSourceUrl(item.sourceUrl) || !dated(item.publishedAt, now, 3 * 60 * MINUTE)) return null;
  const text = normalizeForMatch(item.title);
  if (!CURRENT.test(text) || HISTORICAL.test(text) || /[?？]/.test(item.title)) return null;
  // Require a clear locality dateline, not a victim's address elsewhere in text.
  const lead = String(item.title).split(/\s*[:：]\s*/)[0];
  if (lead === item.title) return null;
  const places = extractPlaceMentions(lead);
  if (places.length !== 1) return null;
  const place = places[0];
  const normalizedLead = normalizeForMatch(lead);
  const aliases = new Set([normalizeForMatch(place), place === 'Lower Vale' ? 'the vale' : '',
    place === 'Grand Baie' ? 'grand bay' : '']);
  if (!aliases.has(normalizedLead)) return null;
  // More than one mentioned locality needs editorial interpretation, not guessing.
  if (extractPlaceMentions(item.title).some(value => value !== place)) return null;
  const type = TYPES.find(([, expression]) => expression.test(text));
  if (!type) return null;
  const [eventType, , severity, duration, radius] = type;
  const publication = Math.min(ms(item.publishedAt), ms(item.priorityPublishedAt || item.publishedAt));
  const expiresAt = publication + duration * MINUTE;
  if (expiresAt <= now) return null;
  return { id: item.id, revision: item.contentHash || hash(item.title), kind: 'local_report',
    title: String(item.title).slice(0, 220), eventType, severity, placeName: place,
    publishedAt: iso(publication), expiresAt: iso(expiresAt),
    sourceName: 'Défi Media', sourceUrl: safeSourceUrl(item.sourceUrl), radius };
}

function healthy(snapshot, now, maxAge) {
  return snapshot && !snapshot.lastError && dated(snapshot.lastSuccessAt, now, maxAge);
}
function officialUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' &&
    ['cap-sources.s3.amazonaws.com', 'metservice.intnet.mu'].includes(url.hostname) &&
    !url.username && !url.password && !url.port ? url.toString() : null; } catch { return null; }
}
function officialCandidate(alert, location, now) {
  if (!alert.active || alert.status !== 'actual' || alert.scope !== 'public' ||
      !['alert', 'update'].includes(alert.messageType) ||
      !['observed', 'likely'].includes(alert.certainty) ||
      !['immediate', 'expected'].includes(alert.urgency) ||
      !['moderate', 'severe', 'extreme'].includes(alert.severity) ||
      !Number.isFinite(ms(alert.effectiveAt)) || ms(alert.effectiveAt) > now ||
      !Number.isFinite(ms(alert.expiresAt)) || ms(alert.expiresAt) <= now ||
      !dated(alert.sentAt, now, 7 * 86400000) || !officialUrl(alert.sourceUrl)) return null;
  // Approximate fixes must fit inside the warning area, not merely intersect it.
  const uncertainty = location.accuracyMeters || 0;
  const latDelta = uncertainty / 110000;
  const lngDelta = uncertainty / (110000 * Math.cos(location.lat * Math.PI / 180));
  const points = [location, ...[0, 45, 90, 135, 180, 225, 270, 315].map(degrees => ({
    lat: location.lat + latDelta * Math.sin(degrees * Math.PI / 180),
    lng: location.lng + lngDelta * Math.cos(degrees * Math.PI / 180) }))];
  if (!points.every(point => matchAlertArea(alert, point).matches)) return null;
  return { id: alert.id, revision: alert.contentHash || hash(alert.headline), kind: 'official_warning',
    title: String(alert.headline || alert.event).slice(0, 220), eventType: alert.eventType,
    severity: { moderate: 2, severe: 3, extreme: 4 }[alert.severity],
    placeName: 'Official warning area', publishedAt: alert.sentAt, expiresAt: alert.expiresAt,
    sourceName: 'Mauritius Meteorological Services', sourceUrl: officialUrl(alert.sourceUrl),
    matchReason: 'The latest watch location falls within the published warning area.' };
}

async function buildPriorityUpdates({ device, media, cap, resolvePlace, now = Date.now() }) {
  const location = priorityLocation(device, now);
  const empty = { schemaVersion: 1, items: [], location: null, expiresAt: iso(now) };
  if (!location) return empty;
  const candidates = [];
  if (healthy(cap, now, 10 * MINUTE)) {
    for (const alert of cap.activeAlerts || []) {
      const candidate = officialCandidate(alert, location, now);
      if (candidate) candidates.push({ ...candidate, sourceCheckedAt: cap.lastSuccessAt,
        expiresAt: iso(Math.min(ms(candidate.expiresAt), ms(cap.lastSuccessAt) + 10 * MINUTE)) });
    }
  }
  if (healthy(media, now, 30 * MINUTE)) {
    for (const item of media.items || []) {
      const candidate = mediaCandidate(item, now);
      if (!candidate) continue;
      let place;
      try { place = await resolvePlace(candidate.placeName); } catch { continue; }
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng) ||
          Math.abs(place.lat) > 90 || Math.abs(place.lng) > 180) continue;
      const distance = haversineMeters(location.lat, location.lng, place.lat, place.lng);
      if (distance + (location.accuracyMeters || 0) > candidate.radius) continue;
      const { radius, ...display } = candidate;
      candidates.push({ ...display, sourceCheckedAt: media.lastSuccessAt,
        // A geocoded locality is not the incident's precise coordinates.
        matchReason: `Report from ${candidate.placeName}, near the watch’s latest recorded area. The incident’s exact position is not supplied.`,
        expiresAt: iso(Math.min(ms(candidate.expiresAt), ms(media.lastSuccessAt) + 30 * MINUTE)) });
    }
  }
  candidates.sort((a, b) => b.severity - a.severity ||
    Number(b.kind === 'official_warning') - Number(a.kind === 'official_warning') ||
    ms(b.publishedAt) - ms(a.publishedAt) || a.id.localeCompare(b.id));
  const seen = new Set();
  const items = candidates.filter(item => {
    // One current report of a type per locality; preserve separate official areas.
    const key = item.kind === 'official_warning' ? item.id : `${item.eventType}:${item.placeName}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 5).map(item => ({ ...item,
    expiresAt: iso(Math.min(ms(item.expiresAt), ms(location.expiresAt))) }));
  if (!items.length) return empty;
  return { schemaVersion: 1, location, items, expiresAt: iso(Math.max(...items.map(item => ms(item.expiresAt)))) };
}
module.exports = { buildPriorityUpdates, mediaCandidate, officialCandidate, priorityLocation, healthy, ms };
