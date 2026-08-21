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
    recordedAt: new Date(
      startAt.getTime() + Number(evidence[index]?.offsetMs || 0)
    ).toISOString(),
  }));
}

function htmlEscapeJson(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script');
}

function buildComparisonHtml({ imei, journeyId, allPoints, gpsPoints, snappedPoints, assessment }) {
  const payload = htmlEscapeJson({
    imei,
    journeyId,
    allPoints,
    gpsPoints,
    snappedPoints,
    assessment,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guardian journey road-alignment experiment</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html,body,#map{height:100%;margin:0} body{font-family:Inter,Segoe UI,sans-serif}
    .panel{position:absolute;z-index:1000;top:16px;left:16px;max-width:390px;background:#fffefb;
      border-radius:16px;padding:14px 16px;box-shadow:0 8px 28px #17362b33;color:#17362b}
    .panel h1{font-size:16px;margin:0 0 8px}.panel p{font-size:12px;line-height:1.45;margin:5px 0}
    .pass{color:#067647;font-weight:800}.fail{color:#b42318;font-weight:800}
    .legend{display:grid;grid-template-columns:18px 1fr;gap:6px 8px;margin-top:10px;font-size:12px}
    .line{height:4px;margin-top:6px;border-radius:3px}.raw{background:#6b7280}.gps{background:#f59e0b}.snap{background:#2563eb}
  </style>
</head>
<body>
  <div id="map"></div>
  <section class="panel">
    <h1>Guardian road-alignment experiment</h1>
    <p><strong>Journey:</strong> ${journeyId}</p>
    <p id="decision"></p><p id="metrics"></p><p id="warnings"></p>
    <div class="legend">
      <span class="line raw"></span><span>Complete stored evidence</span>
      <span class="line gps"></span><span>Trusted satellite GPS samples</span>
      <span class="line snap"></span><span>Google road-aligned proposal</span>
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
    const raw = L.polyline(latLng(data.allPoints), {color:'#6b7280',weight:3,opacity:.5,dashArray:'7 7'}).addTo(map);
    L.polyline(latLng(data.gpsPoints), {color:'#f59e0b',weight:4,opacity:.85}).addTo(map);
    data.gpsPoints.forEach((point, index) => L.circleMarker([point.lat,point.lng], {
      radius:4,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:1
    }).bindTooltip('GPS ' + (index + 1) + '<br>' + (point.recordedAt || '')).addTo(map));
    L.polyline(latLng(data.snappedPoints), {color:'#2563eb',weight:5,opacity:.9}).addTo(map);
    map.fitBounds(raw.getBounds(), {padding:[30,30]});
    const a = data.assessment;
    document.getElementById('decision').innerHTML = a.eligibleForDisplayExperiment
      ? '<span class="pass">PASS for visual evaluation</span> — still not raw SOS evidence.'
      : '<span class="fail">REJECT for product display</span> — Google had to infer too much.';
    document.getElementById('metrics').textContent =
      a.matchedGpsPointCount + '/' + a.originalGpsPointCount + ' GPS points mapped · median correction ' +
      (a.medianCorrectionMeters ?? 'n/a') + ' m · P95 ' + (a.p95CorrectionMeters ?? 'n/a') + ' m · ' +
      a.adjacentPairsOver300Meters + ' sparse pair(s) over 300 m.';
    document.getElementById('warnings').textContent = a.warnings.join(' ');
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

  const apiKey = process.env.GOOGLE_ROADS_API_KEY;
  if (!apiKey) {
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
  console.log('Google Roads: diagnostic requests only; no result persistence');

  const snappedPoints = await snapJourneyToRoads(gpsPoints, { apiKey });
  const assessment = assessRoadAlignment(gpsPoints, snappedPoints);
  const outputPath = path.resolve(
    args.output || `journey-road-alignment-${journey.id}.html`
  );
  fs.writeFileSync(
    outputPath,
    buildComparisonHtml({
      imei: args.imei,
      journeyId: journey.id,
      allPoints,
      gpsPoints,
      snappedPoints,
      assessment,
    }),
    'utf8'
  );

  console.log('');
  console.log(`Coverage:     ${assessment.coveragePercent}%`);
  console.log(`Median snap:  ${assessment.medianCorrectionMeters ?? 'n/a'} m`);
  console.log(`P95 snap:     ${assessment.p95CorrectionMeters ?? 'n/a'} m`);
  console.log(`Sparse pairs: ${assessment.adjacentPairsOver300Meters}/${assessment.adjacentPairCount}`);
  console.log(
    `Assessment:   ${assessment.eligibleForDisplayExperiment ? 'PASS for visual evaluation' : 'REJECT — too much inference'}`
  );
  for (const warning of assessment.warnings) console.log(`Warning:      ${warning}`);
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
  buildComparisonHtml,
  journeyPoints,
  parseArgs,
  readJourney,
};
