#!/usr/bin/env node

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'strict') {
      args.strict = true;
      continue;
    }
    args[key] = argv[index + 1];
    index += 1;
  }
  return args;
}

function asDate(value) {
  if (!value) return null;
  const candidate = value?.toDate?.() ?? new Date(value);
  return candidate instanceof Date && !Number.isNaN(candidate.getTime())
    ? candidate
    : null;
}

function iso(value) {
  return asDate(value)?.toISOString() ?? null;
}

function summarizeJourney(id, journey) {
  const pointEvidence = Array.isArray(journey.pointEvidence)
    ? journey.pointEvidence
    : [];
  const routeGaps = Array.isArray(journey.routeGaps) ? journey.routeGaps : [];
  const routeSegments = Array.isArray(journey.routeSegments)
    ? journey.routeSegments
    : [];
  const pointCount = Number(journey.pointCount) || 0;
  const startAt = asDate(journey.startAt);
  const endAt = asDate(journey.endAt);
  const departureAt = asDate(journey.departureAt) || startAt;
  const returnAt = asDate(journey.returnAt) || endAt;
  const durationSeconds =
    departureAt && returnAt
      ? Math.max(0, Math.round((returnAt.getTime() - departureAt.getTime()) / 1000))
      : 0;
  const departureClass = journey.departureEvidence?.classification || null;
  const returnClass = journey.returnEvidence?.classification || null;
  const evidenceComplete =
    Number(journey.evidenceVersion) >= 3 &&
    pointCount >= 2 &&
    pointEvidence.length === pointCount;
  const boundaryConfirmed =
    journey.closeReason === 'return_to_origin' &&
    Boolean(String(journey.originGeofenceName || '').trim()) &&
    departureClass === 'outside' &&
    returnClass === 'inside';
  const routeStartAnchored = journey.routeStartAnchored === true;

  return {
    id,
    authoritative: evidenceComplete && boundaryConfirmed && routeStartAnchored,
    evidenceComplete,
    boundaryConfirmed,
    routeStartAnchored,
    originGeofenceName: journey.originGeofenceName || null,
    closeReason: journey.closeReason || null,
    startAt: iso(journey.startAt),
    endAt: iso(journey.endAt),
    departureAt: iso(journey.departureAt),
    returnAt: iso(journey.returnAt),
    durationSeconds,
    durationMinutes: Math.round((durationSeconds / 60) * 10) / 10,
    recordedDistanceKm: Number(journey.distanceKm) || 0,
    pointCount,
    pointEvidenceCount: pointEvidence.length,
    gpsPointCount: Number(journey.routeCoverage?.gpsPointCount) || 0,
    approximatePointCount:
      Number(journey.routeCoverage?.approximatePointCount) || 0,
    routeSegmentCount: routeSegments.length,
    trackingGapCount: routeGaps.length,
    largestTrackingGapSeconds: routeGaps.reduce(
      (largest, gap) => Math.max(largest, Number(gap.durationSeconds) || 0),
      0
    ),
    trackingGaps: routeGaps.map((gap) => ({
      fromPointIndex: gap.fromPointIndex ?? null,
      toPointIndex: gap.toPointIndex ?? null,
      stoppedAt:
        startAt && Number.isFinite(Number(gap.fromOffsetMs))
          ? new Date(startAt.getTime() + Number(gap.fromOffsetMs)).toISOString()
          : null,
      resumedAt:
        startAt && Number.isFinite(Number(gap.toOffsetMs))
          ? new Date(startAt.getTime() + Number(gap.toOffsetMs)).toISOString()
          : null,
      durationSeconds: Number(gap.durationSeconds) || 0,
    })),
    departureEvidence: journey.departureEvidence || null,
    routeStartEvidence: journey.routeStartEvidence || null,
    returnEvidence: journey.returnEvidence || null,
  };
}

function evaluateJourneyTruth(journeys) {
  const authoritativeJourneys = journeys.filter((journey) => journey.authoritative);
  const totalTrackingGaps = authoritativeJourneys.reduce(
    (total, journey) => total + journey.trackingGapCount,
    0
  );
  const failureReasons = [];

  if (authoritativeJourneys.length === 0) {
    failureReasons.push(
      'No evidence-backed outing with confirmed departure and return was recorded.'
    );
  }
  if (journeys.some((journey) => !journey.evidenceComplete)) {
    failureReasons.push('At least one stored journey lacks v3 point evidence.');
  }
  if (journeys.some((journey) => journey.boundaryConfirmed && !journey.routeStartAnchored)) {
    failureReasons.push(
      'At least one confirmed outing starts after Home instead of from a trusted inside-Home GPS update.'
    );
  }
  if (totalTrackingGaps > 0) {
    failureReasons.push(
      `${totalTrackingGaps} tracking gap${totalTrackingGaps === 1 ? '' : 's'} occurred.`
    );
  }

  return {
    releaseReady:
      authoritativeJourneys.length > 0 &&
      journeys.every((journey) => journey.authoritative) &&
      totalTrackingGaps === 0,
    failureReasons,
    journeyCount: journeys.length,
    authoritativeJourneyCount: authoritativeJourneys.length,
    totalTrackingGaps,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.imei || !args.since) {
    throw new Error(
      'Usage: node scripts/inspect-journey-truth.js --imei <imei> --since <ISO> [--until <ISO>] [--strict]'
    );
  }

  const since = asDate(args.since);
  const until = asDate(args.until || new Date());
  if (!since || !until || until <= since) {
    throw new Error('Provide a valid --since and an optional --until after it.');
  }

  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const snapshot = await getDb()
    .collection('devices')
    .doc(args.imei)
    .collection('journeys')
    .where('startAt', '>=', since)
    .where('startAt', '<', until)
    .orderBy('startAt')
    .get();

  const journeys = snapshot.docs.map((doc) =>
    summarizeJourney(doc.id, doc.data() || {})
  );
  const decision = evaluateJourneyTruth(journeys);
  console.log(
    JSON.stringify(
      {
        imei: args.imei,
        acceptanceWindow: {
          since: since.toISOString(),
          until: until.toISOString(),
          inspectedAt: new Date().toISOString(),
        },
        ...decision,
        journeys,
      },
      null,
      2
    )
  );

  if (args.strict && !decision.releaseReady) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  asDate,
  evaluateJourneyTruth,
  parseArgs,
  summarizeJourney,
};
