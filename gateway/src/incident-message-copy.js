'use strict';

const { wearerName, toDate, DEFAULT_TIME_ZONE } = require('./safety-message');
const { readSosLocationSnapshot } = require('./sos-location-snapshot');
const { readFallLocationSnapshot } = require('./fall-location-snapshot');
const { formatLocationAge } = require('./sos-location-policy');

// Template parameters must stay on one line and cannot introduce formatting.
const oneLine = (value, max = 100) => String(value || '').replace(/[\r\n\t*_~`]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);

function incidentDateTime(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = toDate(value);
  if (!date) return 'Time unavailable';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(date);
  } catch { return incidentDateTime(date, DEFAULT_TIME_ZONE); }
}

function compactLocation(snapshot) {
  if (!snapshot?.location || snapshot.state === 'unavailable') return 'Location unavailable at the alert.';
  const loc = snapshot.location;
  if (loc.source === 'home_wifi_last_detected') {
    const age = formatLocationAge(snapshot.ageSeconds).replace(/ ago$/, '');
    const network = snapshot.latestObservation;
    const estimate = ['wifi', 'lbs'].includes(network?.source)
      ? ` A separate ${network.source === 'wifi' ? 'Wi-Fi' : 'cell-network'} estimate${Number.isFinite(network.accuracyMeters) ? ` (radius ${Math.round(network.accuracyMeters)} m)` : ''} is unconfirmed.` : '';
    return `Last detected at Home · ${age === 'just now' ? 'less than 1 min' : age} before alert receipt. Current position unconfirmed. Map shows the saved Home pin, not live GPS.${estimate}`;
  }
  if (loc.source === 'home_wifi') {
    const age = formatLocationAge(snapshot.ageSeconds);
    return `Home Wi-Fi detected · near the saved Home pin (not GPS) · ${age === 'just now' ? 'less than 1 min' : age.replace(/ ago$/, '')} before alert receipt.`;
  }
  const gps = loc.source === 'gps';
  const network = ['wifi', 'lbs'].includes(loc.source);
  // A retained pin is historical even if its timestamp is recent.
  const historical = snapshot.state === 'last_known' || snapshot.retainedSatellite || (!gps && !network);
  const label = gps ? (historical ? 'Last GPS' : 'GPS')
    : network ? (historical ? 'Last approximate location' : 'Approximate location')
      : 'Last location (source unconfirmed)';
  const place = oneLine(loc.placeLabel);
  const parts = [`${label}${place ? `: ${place}` : ': place name unavailable'}`];
  if (network) {
    const radius = loc.accuracyMeters;
    parts.push(`${loc.source === 'wifi' ? 'Wi-Fi' : 'cell network'}${typeof radius === 'number' && Number.isFinite(radius) && radius >= 0
      ? `, radius ${Math.round(radius)} m` : ', accuracy unknown'}`);
  }
  const age = formatLocationAge(snapshot.ageSeconds);
  parts.push(age === 'time unavailable' ? 'recording time unknown'
    : `${age === 'just now' ? 'less than 1 min' : age.replace(/ ago$/, '')} before alert receipt`);
  return `${historical ? 'Current position unconfirmed. ' : ''}${parts.join(' · ')}.`;
}

function compactAlertParameters({ type, device = {}, alert = {}, plan }) {
  const snapshot = type === 'sos' ? readSosLocationSnapshot(alert) : readFallLocationSnapshot(alert);
  // Never pair a different snapshot with the already frozen map button.
  if (plan.locationState !== 'unavailable' && (!snapshot || snapshot.state !== plan.locationState)) return null;
  return [oneLine(wearerName(device), 64),
    incidentDateTime(alert.eventAt || alert.triggeredAt || alert.createdAt, alert.timeZone),
    compactLocation(plan.locationState === 'unavailable' ? null : snapshot),
    oneLine(plan.bodyParameters?.[3], 150) || 'Watch status unavailable'];
}

function compactPhotoParameters(gallery, { incident = {}, device = {}, now = new Date() } = {}) {
  const automatic = gallery.photos.filter(photo => photo.captureSource === 'automatic');
  const received = automatic.filter(photo => photo.state === 'available');
  const photo = received[0];
  const photoText = photo ? 'The automatic incident photo is available.' : 'No automatic incident photo was received.';
  const analysisText = !photo ? 'No AI description is available.'
    : photo.analysis?.status === 'ready' ? 'AI description ready in Guardian (unverified).'
      : photo.analysis?.status === 'too_unclear' ? 'AI could not describe this photo clearly.'
        : ['pending', 'analysing'].includes(photo.analysis?.status) ? 'AI description is still processing.'
          : 'AI description unavailable.';
  const end = toDate(gallery.photoAccess?.requestWindowEndsAt);
  const access = gallery.photoAccess;
  const windowText = !end || access?.reason === 'capture_disabled'
    ? 'Further photo requests are unavailable.'
    : end <= now || access?.reason === 'photo_window_closed'
      ? 'The one-hour photo request window has ended.'
      : `Additional photo requests close at ${incidentDateTime(end, incident.timeZone)}.`;
  return [oneLine(wearerName(device), 64), incidentDateTime(incident.eventAt || gallery.eventAt, incident.timeZone),
    photoText, analysisText, windowText];
}

module.exports = { compactAlertParameters, compactPhotoParameters, compactLocation, incidentDateTime };
