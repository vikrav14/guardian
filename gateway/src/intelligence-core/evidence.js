'use strict';
const { hash, fail } = require('./policy');
const { buildLocationReplyData } = require('../location-reply');
const { batteryFreshness } = require('../battery-freshness');
const { getIncidentPhotos } = require('../incident-photos-live');
const ms = value => { const n = value?.toMillis?.() ?? (value == null ? null : +new Date(value)); return Number.isFinite(n) ? n : null; };
const text = (value, max = 120) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : '';
const time = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'time unavailable';
function fact(kind, message, { at = null, source = 'watch', target = null, priority = 5, expiresAt = null } = {}) {
  return { id: hash(JSON.stringify([kind, message, at, source, target])).slice(0, 20), kind, text: message,
    recordedAt: at, source, target, priority, expiresAt };
}
async function collectEvidence(db, access, { now = Date.now(), incidentId = null, gallery = getIncidentPhotos() } = {}) {
  const allowed = permission => access.permissions.includes(permission);
  const device = (await db.collection('devices').doc(access.imei).get()).data();
  if (!device) fail('watch_unavailable', 404);
  const facts = [], gaps = [];
  const add = (kind, message, options) => facts.push(fact(kind, message, options));
  const past = value => { const at = ms(value); return at != null && at <= now ? at : null; };
  const heartbeatAt = past(device.lastHeartbeatAt);
  const readingAt = past(device.batteryUpdatedAt);
  const freshness = batteryFreshness({ lastHeartbeatAt: heartbeatAt == null ? null : new Date(heartbeatAt),
    batteryUpdatedAt: readingAt == null ? null : new Date(readingAt) }, { now: new Date(now) });
  add('connection', `${freshness.online ? 'A recent watch check-in is recorded' : 'No current watch check-in is recorded'}. Last check-in: ${time(heartbeatAt)}.`,
    { at: heartbeatAt, priority: freshness.online ? 7 : 1, target: { screen: 'watch' } });
  const battery = Number(device.batteryPercent);
  if (device.batteryPercent != null && Number.isFinite(battery) && battery >= 0 && battery <= 100) {
    add('battery', `Battery last reported ${battery}%${readingAt == null ? '; its reading time is unavailable' :
      ` at ${time(readingAt)}${now - readingAt > 1800000 ? '; this reading is old' : ''}`}.`,
      { at: readingAt, priority: battery < 15 ? 1 : 8, target: { screen: 'watch' } });
  }
  if (allowed('location')) {
    const location = buildLocationReplyData(device, { now: new Date(now) });
    add('location', `${location.placeLabel ? `Recorded place: ${text(location.placeLabel)}. ` : ''}${location.locationDisclosure} Recorded ${time(ms(location.recordedAt))}.`,
      { at: ms(location.recordedAt), priority: location.locationState === 'fresh' ? 6 : 2, target: { screen: 'location' } });
  }
  let incident = null;
  if (incidentId) {
    if (!allowed('alerts') || !/^[A-Za-z0-9_-]{1,128}$/.test(incidentId)) fail('access_not_shared', 403);
    incident = (await db.collection('alerts').doc(incidentId).get()).data();
    if (!incident || incident.imei !== access.imei || !['sos', 'fall'].includes(incident.type)) fail('incident_unavailable', 404);
    // An incident brief never substitutes today's position for event evidence.
    facts.splice(0);
    add('incident', `${incident.type === 'sos' ? 'SOS' : 'Fall'} alert received at ${time(ms(incident.createdAt))}. ${incident.resolved ? 'Marked as resolved by a guardian' : 'This alert remains open'}.`,
      { at: ms(incident.createdAt), priority: 0, source: 'guardian_record', target: { screen: 'incident', id: incidentId } });
    if (allowed('location')) {
      const snapshot = incident.type === 'sos'
        ? require('../sos-location-snapshot').readSosLocationSnapshot(incident)
        : require('../fall-location-snapshot').readFallLocationSnapshot(incident);
      const recorded = snapshot?.state === 'unavailable' ? null : snapshot?.location;
      add('incident_location', recorded
        ? `Location evidence retained with this alert: ${text(recorded.placeLabel) || 'recorded position'}; source ${text(recorded.source) || 'unconfirmed'}; recorded ${time(ms(recorded.recordedAt))}. This is event evidence, not a current position.`
        : 'No usable location evidence is attached to this alert.',
      { at: ms(recorded?.recordedAt), priority: 1, source: 'guardian_record', target: { screen: 'incident', id: incidentId } });
    }
    const responses = await db.collection('alerts').doc(incidentId).collection('responses').limit(6).get();
    for (const doc of responses.docs) {
      const response = doc.data();
      add('response', `${text(response.name) || 'A family member'} said they are responding at ${time(response.acknowledgedAtMs)}. This does not confirm arrival or resolution.`,
        { at: response.acknowledgedAtMs, source: 'family_response', priority: 2, target: { screen: 'incident', id: incidentId } });
    }
    if (allowed('photos') && gallery) {
      try {
        const result = await gallery.gallery(access.uid, incidentId);
        const photos = result.photos.filter(p => p.state === 'available');
        add('photos', `${photos.length} incident photo${photos.length === 1 ? '' : 's'} currently available. Receipt time is not verified capture time.`,
          { source: 'guardian_record', priority: 2, target: { screen: 'photos', id: incidentId } });
        // AI observations remain labelled separately from recorded facts. Only
        // the existing consent-aware gallery may supply these descriptions.
        for (const item of result.summary || []) {
          if (typeof item.text !== 'string' || !item.text.trim()) continue;
          const photo = photos.find(p => p.sequence === item.photo);
          if (!photo) continue;
          add('photo_observation', `Unverified photo observation: ${text(item.text, 320)}`,
            { source: 'photo_ai', priority: 3, expiresAt: ms(photo.mediaExpiresAt), target: { screen: 'photos', id: incidentId } });
        }
      } catch { gaps.push('Photo availability could not be checked.'); }
    }
    gaps.push('Photos and AI cannot establish the wearer’s condition or confirm their current location.');
  } else if (allowed('alerts')) {
    try {
      const rows = await db.collection('alerts').where('imei', '==', access.imei).orderBy('createdAt', 'desc').limit(20).get();
      const recent = rows.docs.filter(doc => { const at = ms(doc.data().createdAt); return at != null && at <= now && at >= now - 86400000; });
      for (const doc of recent.slice(0, 5)) {
        const row = doc.data(), type = ['sos', 'fall'].includes(row.type) ? row.type.toUpperCase() : 'Watch';
        add('alert', `${type} alert recorded at ${time(ms(row.createdAt))}; ${row.resolved ? 'marked as resolved' : 'still open'}.`,
          { at: ms(row.createdAt), priority: row.resolved ? 5 : 0, source: 'guardian_record', target: { screen: 'incident', id: doc.id } });
      }
      if (!recent.length && rows.docs.length < 20) add('alerts', 'No alerts are recorded in the last 24 hours. This is not confirmation of safety.', { source: 'guardian_record', target: { screen: 'alerts' }, priority: 8 });
      if (rows.docs.length === 20) gaps.push('The alert overview is limited to the 20 most recent records.');
    } catch { gaps.push('Recent alerts could not be checked.'); }
  }
  // Sparse ten-minute reporting cannot establish a usual routine or current
  // wearing state. No generated wording may turn unavailable data into a trend.
  if (!incidentId) gaps.push('Routine comparisons need sufficient recorded history and coverage.');
  facts.sort((a, b) => a.priority - b.priority);
  const packet = { version: 1, wearerName: text(device.nickname || device.name || 'Your loved one'),
    incidentId, facts: facts.slice(0, 20), gaps, asOf: now, validUntil: now + 60000 };
  packet.validUntil = Math.min(packet.validUntil, ...packet.facts.map(f => f.expiresAt).filter(t => t != null));
  // Cache only a selection of evidence IDs, never private prose or photo
  // observations. Fresh evidence is rebuilt and permission-checked every read.
  packet.fingerprint = hash(JSON.stringify([access.scopeKey, packet.facts.map(f => f.id), gaps, incidentId]));
  return packet;
}
module.exports = { collectEvidence, fact, ms, time };
