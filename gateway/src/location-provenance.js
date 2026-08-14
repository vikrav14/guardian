'use strict';

const LOCATION_SOURCE = Object.freeze({
  GPS: 'gps',
  WIFI: 'wifi',
  LBS: 'lbs',
});

const SATELLITE_DISPLAY_RETENTION_MS = 30 * 60 * 1000;

function normalizeLocationSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return Object.values(LOCATION_SOURCE).includes(source) ? source : null;
}

function isApproximateLocationSource(value) {
  const source = normalizeLocationSource(value);
  return source === LOCATION_SOURCE.WIFI || source === LOCATION_SOURCE.LBS;
}

/**
 * Produce one self-contained observation so metadata from an older fix cannot
 * survive a Firestore merge. Satellite packets do not provide an accuracy
 * radius in this protocol, therefore accuracyMeters is deliberately null.
 */
function buildLocationObservation(location, accuracySource, gpsValid) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null;
  }

  const source = normalizeLocationSource(accuracySource || location.source);
  const satellite = source === LOCATION_SOURCE.GPS || gpsValid === true;
  const resolvedSource = satellite ? LOCATION_SOURCE.GPS : source;

  return {
    ...location,
    source: resolvedSource,
    gpsValid: satellite,
    accuracyMeters: satellite
      ? null
      : (Number.isFinite(Number(location.accuracyMeters))
          ? Number(location.accuracyMeters)
          : null),
  };
}

function buildLocationProvenancePatch(location, accuracySource, gpsValid) {
  const observation = buildLocationObservation(location, accuracySource, gpsValid);
  if (!observation) return {};

  const patch = {
    location: observation,
    accuracySource: observation.source,
    lastLocationObservation: observation,
  };

  if (observation.source === LOCATION_SOURCE.GPS) {
    patch.lastSatelliteLocation = observation;
  } else if (isApproximateLocationSource(observation.source)) {
    patch.lastApproximateLocation = observation;
  }

  return patch;
}

/**
 * Fill source-specific snapshots from a pre-provenance device document.
 * This is used once per device process before the first new location write,
 * so an indoor V observation cannot erase the legacy current A fix during
 * rollout.
 */
function backfillLegacyLocationProvenance(existingDevice, incomingPatch) {
  const existing = existingDevice || {};
  const patch = { ...(incomingPatch || {}) };

  if (!patch.lastSatelliteLocation) {
    const candidate = [
      existing.lastSatelliteLocation,
      existing.lastLocationObservation,
      existing.location,
    ].find((value) => {
      const source = normalizeLocationSource(
        value?.source || existing.accuracySource
      );
      return validLocation(value) &&
        (source === LOCATION_SOURCE.GPS || value?.gpsValid === true);
    });
    if (candidate) {
      patch.lastSatelliteLocation = buildLocationObservation(
        candidate,
        LOCATION_SOURCE.GPS,
        true
      );
    }
  }

  if (!patch.lastApproximateLocation) {
    const candidate = [
      existing.lastApproximateLocation,
      existing.lastLocationObservation,
      existing.location,
    ].find((value) => {
      const source = normalizeLocationSource(
        value?.source || existing.accuracySource
      );
      return validLocation(value) && isApproximateLocationSource(source);
    });
    if (candidate) {
      const candidateSource = normalizeLocationSource(
        candidate.source || existing.accuracySource
      );
      patch.lastApproximateLocation = buildLocationObservation(
        candidate,
        candidateSource,
        false
      );
    }
  }

  return patch;
}

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validLocation(value) {
  return value && typeof value.lat === 'number' && typeof value.lng === 'number';
}

/**
 * Prefer a recently lost satellite fix over a new broad indoor estimate, but
 * retain both observations. After the bounded window the newer approximate
 * observation becomes the display position and must remain clearly labelled.
 */
function selectLocationForDisplay(device, options = {}) {
  const retentionMs = options.retentionMs ?? SATELLITE_DISPLAY_RETENTION_MS;
  const latest = device?.lastLocationObservation || device?.location || null;
  const latestSource = normalizeLocationSource(
    latest?.source || device?.accuracySource
  );
  const satellite = device?.lastSatelliteLocation ||
    (latestSource === LOCATION_SOURCE.GPS ? latest : null);

  if (!validLocation(latest)) {
    return {
      location: validLocation(satellite) ? satellite : null,
      source: validLocation(satellite) ? LOCATION_SOURCE.GPS : null,
      retainedSatellite: validLocation(satellite),
      latestObservation: latest,
    };
  }

  if (latestSource === LOCATION_SOURCE.GPS || !validLocation(satellite)) {
    return {
      location: latest,
      source: latestSource,
      retainedSatellite: false,
      latestObservation: latest,
    };
  }

  const latestAt = asDate(latest.recordedAt);
  const satelliteAt = asDate(satellite.recordedAt);
  const gapMs = latestAt && satelliteAt
    ? latestAt.getTime() - satelliteAt.getTime()
    : Number.POSITIVE_INFINITY;
  const retainSatellite =
    isApproximateLocationSource(latestSource) && gapMs >= 0 && gapMs <= retentionMs;

  return {
    location: retainSatellite ? satellite : latest,
    source: retainSatellite ? LOCATION_SOURCE.GPS : latestSource,
    retainedSatellite: retainSatellite,
    latestObservation: latest,
  };
}

module.exports = {
  LOCATION_SOURCE,
  SATELLITE_DISPLAY_RETENTION_MS,
  normalizeLocationSource,
  isApproximateLocationSource,
  buildLocationObservation,
  buildLocationProvenancePatch,
  backfillLegacyLocationProvenance,
  selectLocationForDisplay,
};
