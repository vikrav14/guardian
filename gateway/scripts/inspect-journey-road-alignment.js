#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { decodePolyline } = require('../src/polyline');
const {
  assessRoadAlignment,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
} = require('../src/journey-road-alignment');
const {
  estimateRouteGaps,
  findEstimatedRouteGaps,
  partitionGpsSegments,
} = require('../src/journey-route-estimation');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function asDate(value) {
  const candidate = value?.toDate?.() ?? new Date(value);
  return candidate instanceof Date && !Number.isNaN(candidate.getTime())
    ? candidate
    : null;
}

function journeyPoints(journey) {
  const coords = decodePolyline(journey.polyline);
  const evidence = Array.isArray(journey.pointEvidence)
    ? journey.pointEvidence
    : [];
  const startAt = asDate(journey.startAt);
  if (!startAt || coords.length !== evidence.length) {
    throw new Error(
      `Stored route/evidence mismatch: ${coords.length} coordinates and ${evidence.length} evidence rows.`
    );
  }

  return coords.map((point, index) => ({
    lat: point.lat,
    lng: point.lng,
    originalJourneyIndex: index,
    recordedAt: new Date(
      startAt.getTime() + Number(evidence[index]?.offsetMs || 0)
    ).toISOString(),
    source: evidence[index]?.source || evidence[index]?.accuracySource || null,
    gpsValid: evidence[index]?.gpsValid,
    accuracyMeters: evidence[index]?.accuracyMeters != null &&
      Number.isFinite(Number(evidence[index].accuracyMeters))
      ? Number(evidence[index].accuracyMeters)
      : null,
  }));
}

function redactSecret(message, secret) {
  const text = String(message || 'Unknown error');
  return secret ? text.replaceAll(String(secret), '[redacted]') : text;
}

async function alignGpsSegments(
  segments,
  { apiKey, snapImpl = snapJourneyToRoads } = {}
) {
  const output = [];
  for (let index = 0; index < (segments || []).length; index += 1) {
    const points = segments[index];
    if (points.length < 2) {
      output.push({
        segmentIndex: index,
        points,
        snappedPoints: [],
        accepted: false,
        assessment: null,
        reason: 'single_gps_sample',
        error: null,
      });
      continue;
    }

    try {
      const snappedPoints = await snapImpl(points, { apiKey });
      const assessment = assessRoadAlignment(points, snappedPoints);
      output.push({
        segmentIndex: index,
        points,
        snappedPoints,
        accepted: assessment.eligibleForDisplayExperiment,
        assessment,
        reason: assessment.eligibleForDisplayExperiment
          ? null
          : 'roads_alignment_failed_display_checks',
        error: null,
      });
    } catch (error) {
      output.push({
        segmentIndex: index,
        points,
        snappedPoints: [],
        accepted: false,
        assessment: null,
        reason: 'google_roads_request_failed',
        error: redactSecret(error?.message || error, apiKey),
      });
    }
  }
  return output;
}

function htmlEscapeJson(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script');
}

function buildComparisonHtml({
  journeyId,
  allPoints,
  gpsPoints,
  roadSections,
  estimatedGaps,
}) {
  const payload = htmlEscapeJson({
    journeyId,
    allPoints,
    gpsPoints,
    roadSections,
    estimatedGaps,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guardian hybrid journey experiment</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html,body,#map{height:100%;margin:0} body{font-family:Inter,Segoe UI,sans-serif}
    .panel{position:absolute;z-index:1000;top:16px;left:16px;max-width:410px;background:#fffefb;
      border-radius:16px;padding:14px 16px;box-shadow:0 8px 28px #17362b33;color:#17362b}
    .panel h1{font-size:16px;margin:0 0 8px}.panel p{font-size:12px;line-height:1.45;margin:5px 0}
    .notice{color:#6941c6;font-weight:800}
    .legend{display:grid;grid-template-columns:18px 1fr;gap:6px 8px;margin-top:10px;font-size:12px}
    .line{height:4px;margin-top:6px;border-radius:3px}.raw{background:#98a2b3}.gps{background:#f59e0b}
    .snap{background:#3157d5}.approx{background:#f79009}
    .estimate{border-top:4px dashed #8b5cf6;margin-top:6px}.unresolved{border-top:3px dashed #667085;margin-top:6px}
  </style>
</head>
<body>
  <div id="map"></div>
  <section class="panel">
    <h1>Guardian hybrid journey experiment</h1>
    <p><strong>Journey:</strong> <span id="journey"></span></p>
    <p class="notice">Dashed purple sections are Google estimates, not recorded movement.</p>
    <p id="metrics"></p>
    <div class="legend">
      <span class="line raw"></span><span>Stored evidence trace</span>
      <span class="line gps"></span><span>Trusted satellite GPS sample</span>
      <span class="line snap"></span><span>GPS-supported road alignment</span>
      <span class="estimate"></span><span>Google-estimated route (not recorded)</span>
      <span class="line approx"></span><span>Approximate WiFi/LBS observation</span>
      <span class="unresolved"></span><span>Unresolved interval</span>
    </div>
  </section>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const data = ${payload};
    const map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    const latLng = points => points.map(point => [point.lat, point.lng]);
    const bounds = L.latLngBounds(latLng(data.allPoints));
    if (data.allPoints.length > 1) {
      L.polyline(latLng(data.allPoints), {color:'#98a2b3',weight:2,opacity:.38,dashArray:'4 8'}).addTo(map);
    }
    data.gpsPoints.forEach((point, index) => L.circleMarker([point.lat,point.lng], {
      radius:4,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:1
    }).bindTooltip('GPS ' + (index + 1) + '<br>' + (point.recordedAt || '')).addTo(map));
    data.allPoints.filter(point => {
      const source = String(point.source || '').toLowerCase();
      return source === 'wifi' || source === 'lbs' || point.gpsValid === false;
    }).forEach(point => L.circleMarker([point.lat,point.lng], {
      radius:3,color:'#f79009',weight:1,fillColor:'#fdb022',fillOpacity:.65
    }).bindTooltip('Approximate observation<br>' + (point.recordedAt || '')).addTo(map));
    const acceptedRoads = data.roadSections.filter(section => section.accepted);
    acceptedRoads.forEach(section => L.polyline(latLng(section.snappedPoints), {
      color:'#3157d5',weight:5,opacity:.9
    }).bindTooltip('GPS-supported road alignment').addTo(map));
    const acceptedEstimates = data.estimatedGaps.filter(item => item.accepted && item.selected);
    acceptedEstimates.forEach(item => {
      const gap = item.gap;
      L.polyline(latLng(item.selected.candidate.points), {
        color:'#8b5cf6',weight:5,opacity:.92,dashArray:'12 10'
      }).bindTooltip(
        'Estimated by Google · exact path not recorded<br>' +
        new Date(gap.from.recordedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '–' +
        new Date(gap.to.recordedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
      ).addTo(map);
    });
    const unresolved = data.estimatedGaps.filter(item => !item.accepted);
    unresolved.forEach(item => L.polyline(latLng([item.gap.from,item.gap.to]), {
      color:'#667085',weight:3,opacity:.75,dashArray:'6 10'
    }).bindTooltip('Unresolved interval · no route shown as fact').addTo(map));
    map.fitBounds(bounds, {padding:[30,30]});
    document.getElementById('journey').textContent = data.journeyId;
    document.getElementById('metrics').textContent =
      acceptedRoads.length + '/' + data.roadSections.length + ' GPS section(s) road-aligned · ' +
      acceptedEstimates.length + '/' + data.estimatedGaps.length + ' sparse interval(s) estimated · ' +
      unresolved.length + ' unresolved.';
  </script>
</body>
</html>`;
}

async function readJourney(db, imei, journeyId) {
  const journeys = db.collection('devices').doc(imei).collection('journeys');
  if (journeyId) {
    const snapshot = await journeys.doc(journeyId).get();
    if (!snapshot.exists) throw new Error(`Journey ${journeyId} was not found.`);
    return { id: snapshot.id, data: snapshot.data() || {} };
  }

  const snapshot = await journeys.orderBy('startAt', 'desc').limit(1).get();
  if (snapshot.empty) throw new Error(`No journeys were found for ${imei}.`);
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() || {} };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.imei) {
    throw new Error(
      'Usage: node scripts/inspect-journey-road-alignment.js --imei <imei> [--journey-id <id>] [--output <html>]'
    );
  }

  const roadsApiKey = process.env.GOOGLE_ROADS_API_KEY;
  const routesApiKey = process.env.GOOGLE_ROUTES_API_KEY || roadsApiKey;
  if (!roadsApiKey) {
    throw new Error(
      'GOOGLE_ROADS_API_KEY is missing. Add a server-restricted Roads API key to gateway/.env.'
    );
  }

  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const journey = await readJourney(getDb(), args.imei, args['journey-id']);
  const allPoints = journeyPoints(journey.data);
  const gpsPoints = selectTrustedGpsPoints(allPoints, journey.data.pointEvidence);
  if (gpsPoints.length < 2) {
    throw new Error('The journey has fewer than two trusted satellite GPS points.');
  }

  console.log('Guardian Journey Road-Alignment Experiment');
  console.log('==========================================');
  console.log(`Device:       ${args.imei}`);
  console.log(`Journey:      ${journey.id}`);
  console.log(`Stored points:${String(allPoints.length).padStart(4)}`);
  console.log(`Trusted GPS:  ${String(gpsPoints.length).padStart(4)}`);
  console.log('Firestore:    read-only');
  console.log('Google APIs:  diagnostic requests only; no result persistence');

  const gaps = findEstimatedRouteGaps(gpsPoints, allPoints);
  const gpsSegments = partitionGpsSegments(gpsPoints, gaps);
  const roadSections = await alignGpsSegments(gpsSegments, {
    apiKey: roadsApiKey,
  });
  const estimatedGaps = await estimateRouteGaps(gaps, {
    apiKey: routesApiKey,
  });
  const outputPath = path.resolve(
    args.output || `journey-road-alignment-${journey.id}.html`
  );
  fs.writeFileSync(
    outputPath,
    buildComparisonHtml({
      journeyId: journey.id,
      allPoints,
      gpsPoints,
      roadSections,
      estimatedGaps,
    }),
    'utf8'
  );

  const acceptedRoadSections = roadSections.filter((section) => section.accepted);
  const acceptedEstimatedGaps = estimatedGaps.filter((item) => item.accepted);
  const approximateSupported = acceptedEstimatedGaps.filter(
    (item) => item.confidence === 'supported_estimate'
  );
  const unresolvedGaps = estimatedGaps.filter((item) => !item.accepted);
  console.log('');
  console.log(`GPS sections: ${acceptedRoadSections.length}/${roadSections.length} road-aligned`);
  console.log(`Sparse gaps:  ${gaps.length}`);
  console.log(`Estimated:    ${acceptedEstimatedGaps.length}/${estimatedGaps.length}`);
  console.log(`Corroborated: ${approximateSupported.length} by approximate observations`);
  console.log(`Unresolved:   ${unresolvedGaps.length}`);
  for (const item of unresolvedGaps) {
    console.log(`Gap warning:  ${item.gap.id} — ${item.reason}`);
  }
  console.log(`Report:       ${outputPath}`);
  console.log('No Firestore documents or Guardian routes were changed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  alignGpsSegments,
  buildComparisonHtml,
  journeyPoints,
  parseArgs,
  readJourney,
};
