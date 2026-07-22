const { getDb } = require('../firestore');
const { getSnapshot, setFleetAggregates } = require('./collector');

let flushTimer = null;

async function aggregateFleetFromFirestore(db) {
  const snap = await db.collection('devices').get();
  let totalDevices = 0;
  let devicesOnline = 0;
  let batterySum = 0;
  let batteryCount = 0;
  let gpsGood = 0;
  let gpsTotal = 0;

  for (const doc of snap.docs) {
    totalDevices += 1;
    const d = doc.data() || {};
    if (d.online) devicesOnline += 1;
    if (d.batteryPercent != null && !Number.isNaN(d.batteryPercent)) {
      batterySum += d.batteryPercent;
      batteryCount += 1;
    }
    if (d.accuracySource) {
      gpsTotal += 1;
      if (d.accuracySource === 'gps') gpsGood += 1;
    } else if (d.location?.lat != null) {
      gpsTotal += 1;
      gpsGood += 1;
    }
  }

  return {
    totalDevices,
    devicesOnline,
    devicesOffline: totalDevices - devicesOnline,
    avgBatteryPercent: batteryCount > 0 ? Math.round(batterySum / batteryCount) : 0,
    gpsQualityPct: gpsTotal > 0 ? Math.round((gpsGood / gpsTotal) * 100) : 0,
    batterySampleSize: batteryCount,
    gpsSampleSize: gpsTotal,
  };
}

async function flushMetricsToFirestore() {
  const db = getDb();
  if (!db) return;

  let fleet = null;
  try {
    fleet = await aggregateFleetFromFirestore(db);
    setFleetAggregates(fleet);
  } catch (err) {
    console.error('[ops-metrics] fleet aggregate failed', err.message);
  }

  const snapshot = getSnapshot();
  const todayRef = db.collection('ops').doc('metrics').collection('daily').doc(snapshot.date);
  const todayLiveRef = db.collection('ops').doc('metrics').doc('today');

  const payload = {
    ...snapshot.counters,
    alertTypes: snapshot.alertTypes,
    eventTypes: snapshot.eventTypes,
    updatedAt: snapshot.updatedAt,
    date: snapshot.date,
    ...(fleet ? { fleet } : {}),
  };

  await todayLiveRef.set(payload, { merge: true });
  await todayRef.set(payload, { merge: true });
}

function startMetricsFlusher(intervalMs = 60_000) {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    flushMetricsToFirestore().catch((err) => {
      console.error('[ops-metrics] flush failed', err.message);
    });
  }, intervalMs);

  console.log(`[ops-metrics] flushing to Firestore every ${intervalMs / 1000}s`);
}

function stopMetricsFlusherForTests() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

module.exports = {
  aggregateFleetFromFirestore,
  flushMetricsToFirestore,
  startMetricsFlusher,
  stopMetricsFlusherForTests,
};
