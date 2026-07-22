const { getDb } = require('../firestore');
const { getSnapshot } = require('./collector');

let flushTimer = null;

async function flushMetricsToFirestore() {
  const db = getDb();
  if (!db) return;

  const snapshot = getSnapshot();
  const todayRef = db.collection('ops').doc('metrics').collection('daily').doc(snapshot.date);
  const todayLiveRef = db.collection('ops').doc('metrics').doc('today');

  const payload = {
    ...snapshot.counters,
    alertTypes: snapshot.alertTypes,
    eventTypes: snapshot.eventTypes,
    updatedAt: snapshot.updatedAt,
    date: snapshot.date,
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
  flushMetricsToFirestore,
  startMetricsFlusher,
  stopMetricsFlusherForTests,
};
