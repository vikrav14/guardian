// Satellite observations and provider network estimates are different evidence.
// This source gate does not claim GPS accuracy or prove the purpose of a trip.
function isJourneyGps(point) {
  const source = String(point?.source || point?.accuracySource || '').trim().toLowerCase();
  return source === 'gps' && point?.gpsValid === true;
}

function hasJourneyGpsEvidence(journey = {}) {
  const points = journey.pointEvidence;
  return Number(journey.evidenceVersion) >= 3 &&
    Number.isInteger(journey.pointCount) && journey.pointCount >= 2 &&
    Array.isArray(points) && points.length === journey.pointCount &&
    points.every(point => point && typeof point === 'object') &&
    points.filter(isJourneyGps).length >= 2;
}

module.exports = { isJourneyGps, hasJourneyGpsEvidence };
