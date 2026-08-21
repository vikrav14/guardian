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
  <title>Guardian Journey Lab</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    :root{--ink:#102a25;--muted:#667b75;--panel:#ffffffed;--line:#e5ece9;
      --verified:#3157d5;--estimated:#7c3aed;--amber:#f59e0b;--green:#18a874}
    *{box-sizing:border-box}html,body,#map{height:100%;margin:0}
    body{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      color:var(--ink);background:#edf3f0;overflow:hidden}
    #map{background:#edf3f0}.leaflet-container{font:12px/1.45 inherit}
    .leaflet-control-zoom{border:0!important;box-shadow:0 8px 24px #18362e20!important}
    .leaflet-control-zoom a{border:0!important;color:var(--ink)!important}
    .journey-bar{position:absolute;z-index:1000;top:18px;left:18px;right:18px;min-height:68px;
      display:flex;align-items:center;gap:18px;background:var(--panel);backdrop-filter:blur(18px);
      border:1px solid #ffffffb8;border-radius:22px;padding:12px 14px 12px 18px;
      box-shadow:0 16px 42px #173a3028}
    .journey-title{min-width:190px}.topline{display:flex;align-items:center;gap:9px}
    .eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase;font-weight:800;color:#527169}
    .readonly{padding:6px 9px;border-radius:999px;background:#e9f8f2;color:#087a56;
      font-size:9px;font-weight:900;letter-spacing:.09em}
    h1{font-size:16px;line-height:1.1;margin:4px 0 0;letter-spacing:-.02em}
    .journey-meta{flex:1;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .source-key{display:flex;align-items:center;gap:8px}
    .source-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;
      background:#f5f7f6;color:#4f6760;font-size:10px;font-weight:800}
    .source-dot{width:16px;height:4px;border-radius:99px;background:var(--verified)}
    .source-dot.google{background:var(--estimated)}
    .actions{display:flex;gap:8px;margin-left:auto}
    button{appearance:none;border:1px solid #dce6e2;background:#fff;color:var(--ink);border-radius:12px;
      padding:10px 12px;font:inherit;font-size:11px;font-weight:750;cursor:pointer;transition:.18s ease}
    button:hover{transform:translateY(-1px);box-shadow:0 7px 18px #173a3014}button.active{background:#eef0ff;border-color:#cfd4ff;color:#343abf}
    .endpoint{width:34px;height:34px;border:3px solid #fff;border-radius:50%;display:grid;place-items:center;
      color:#fff;font-weight:900;font-size:12px;box-shadow:0 7px 18px #173a3040}
    .endpoint.start{background:var(--green)}.endpoint.end{background:#172f2a}
    .leaflet-tooltip.route-tip{border:0;border-radius:12px;padding:9px 11px;box-shadow:0 8px 22px #173a3024;color:var(--ink)}
    @media(max-width:760px){.journey-bar{top:10px;left:10px;right:10px;gap:9px;flex-wrap:wrap;padding:12px 13px;border-radius:18px}
      .journey-title{min-width:0;flex:1}.journey-meta{order:3;flex-basis:100%}.source-key{order:2}.actions{order:4;margin-left:0;width:100%}
      .actions button{flex:1}.readonly{display:none}}
  </style>
</head>
<body>
  <div id="map"></div>
  <section class="journey-bar">
    <div class="journey-title">
      <div class="topline"><span class="eyebrow">Guardian Journey Lab</span><span class="readonly">READ-ONLY</span></div>
      <h1>Route reconstruction</h1>
    </div>
    <div class="journey-meta" id="journey-meta"></div>
    <div class="source-key">
      <span class="source-pill"><i class="source-dot"></i>GPS</span>
      <span class="source-pill"><i class="source-dot google"></i>Google</span>
    </div>
    <div class="actions">
      <button id="fit-route" type="button">Fit complete route</button>
      <button id="toggle-evidence" type="button">Show source evidence</button>
    </div>
  </section>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const data = ${payload};
    const map = L.map('map', {zoomControl:false, attributionControl:true});
    L.control.zoom({position:'bottomright'}).addTo(map);
    L.control.scale({position:'bottomright', imperial:false}).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom:20,
      attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
    const latLng = points => points.map(point => [point.lat, point.lng]);
    const formatTime = value => value
      ? new Intl.DateTimeFormat([], {hour:'2-digit',minute:'2-digit'}).format(new Date(value))
      : 'time unavailable';
    const routeBounds = L.latLngBounds([]);
    const routeLayer = L.layerGroup().addTo(map);
    const evidenceLayer = L.layerGroup();
    const extend = points => points.forEach(point => routeBounds.extend([point.lat,point.lng]));
    const drawRoute = (points, {color, dashArray, opacity=1, tooltip}) => {
      if (!Array.isArray(points) || points.length < 2) return;
      extend(points);
      L.polyline(latLng(points), {color:'#fff',weight:10,opacity:.92,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
      L.polyline(latLng(points), {color,weight:5,opacity,dashArray,lineCap:'round',lineJoin:'round'})
        .bindTooltip(tooltip, {className:'route-tip',sticky:true}).addTo(routeLayer);
    };
    const acceptedRoads = data.roadSections.filter(section => section.accepted);
    data.roadSections.forEach(section => {
      if (section.accepted) {
        drawRoute(section.snappedPoints, {color:'#3157d5',tooltip:'GPS route'});
      } else if (section.points.length > 1) {
        drawRoute(section.points, {color:'#3157d5',opacity:.72,tooltip:'GPS route'});
      }
    });
    const acceptedEstimates = data.estimatedGaps.filter(item => item.accepted && item.selected);
    acceptedEstimates.forEach(item => {
      const gap = item.gap;
      drawRoute(item.selected.candidate.points, {
        color:'#7c3aed',opacity:.92,
        tooltip:'Google route · ' + formatTime(gap.from.recordedAt) + '–' + formatTime(gap.to.recordedAt)
      });
    });
    const unresolved = data.estimatedGaps.filter(item => !item.accepted);
    unresolved.forEach(item => drawRoute([item.gap.from,item.gap.to], {
      color:'#667085',dashArray:'3 12',opacity:.55,tooltip:'Unresolved interval · no route asserted'
    }));
    if (data.allPoints.length > 1) {
      L.polyline(latLng(data.allPoints), {color:'#64748b',weight:2,opacity:.45,dashArray:'3 8'})
        .bindTooltip('Complete stored evidence trace', {className:'route-tip',sticky:true}).addTo(evidenceLayer);
    }
    data.gpsPoints.forEach((point, index) => L.circleMarker([point.lat,point.lng], {
      radius:4,color:'#fff',weight:2,fillColor:'#3157d5',fillOpacity:1
    }).bindTooltip('Trusted GPS ' + (index + 1) + '<br>' + formatTime(point.recordedAt), {className:'route-tip'}).addTo(evidenceLayer));
    data.allPoints.filter(point => {
      const source = String(point.source || '').toLowerCase();
      return source === 'wifi' || source === 'lbs' || point.gpsValid === false;
    }).forEach(point => L.circleMarker([point.lat,point.lng], {
      radius:4,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:.82
    }).bindTooltip('Approximate observation<br>' + formatTime(point.recordedAt), {className:'route-tip'}).addTo(evidenceLayer));
    const markerIcon = (label, type) => L.divIcon({className:'',html:'<div class="endpoint ' + type + '">' + label + '</div>',iconSize:[34,34],iconAnchor:[17,17]});
    const first = data.gpsPoints[0] || data.allPoints[0];
    const last = data.gpsPoints[data.gpsPoints.length - 1] || data.allPoints[data.allPoints.length - 1];
    if (first) L.marker([first.lat,first.lng], {icon:markerIcon('A','start'),zIndexOffset:800})
      .bindTooltip('Journey start · ' + formatTime(first.recordedAt), {className:'route-tip'}).addTo(map);
    if (last) L.marker([last.lat,last.lng], {icon:markerIcon('B','end'),zIndexOffset:800})
      .bindTooltip('Journey end · ' + formatTime(last.recordedAt), {className:'route-tip'}).addTo(map);
    const fitRoute = () => {
      if (!routeBounds.isValid()) return;
      const desktop = window.innerWidth > 760;
      map.fitBounds(routeBounds, {
        paddingTopLeft:desktop ? [60,110] : [24,185],
        paddingBottomRight:desktop ? [60,60] : [24,80],
        maxZoom:16
      });
    };
    fitRoute();
    document.getElementById('journey-meta').textContent =
      data.allPoints.length + ' locations · ' + data.gpsPoints.length + ' GPS · ' +
      acceptedEstimates.length + ' Google' + (unresolved.length ? ' · ' + unresolved.length + ' unresolved' : '');
    document.getElementById('fit-route').addEventListener('click', fitRoute);
    const evidenceButton = document.getElementById('toggle-evidence');
    evidenceButton.addEventListener('click', () => {
      const visible = map.hasLayer(evidenceLayer);
      if (visible) map.removeLayer(evidenceLayer); else evidenceLayer.addTo(map);
      evidenceButton.classList.toggle('active', !visible);
      evidenceButton.textContent = visible ? 'Show source evidence' : 'Hide source evidence';
    });
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
