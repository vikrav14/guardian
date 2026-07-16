const admin = require('firebase-admin');
const config = require('./config');

let db = null;
let enabled = false;

function initFirestore() {
  if (config.firestoreDisabled) {
    console.log('[firestore] disabled (FIRESTORE_DISABLED=true) — logging writes only');
    return;
  }

  if (!config.firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID is required when Firestore is enabled');
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: config.firebaseProjectId,
  });

  db = admin.firestore();
  enabled = true;
  console.log(`[firestore] connected to project ${config.firebaseProjectId}`);
}

function nowTs() {
  return enabled ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
}

async function upsertDevice(imei, patch) {
  const data = {
    imei,
    updatedAt: nowTs(),
    ...patch,
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${imei}`, JSON.stringify(data));
    return;
  }

  const ref = db.collection('devices').doc(imei);
  await ref.set(data, { merge: true });
}

async function appendLocation(imei, point) {
  if (!config.writeLocationHistory) return;

  const data = {
    ...point,
    recordedAt: point.recordedAt || nowTs(),
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${imei}/locations`, JSON.stringify(data));
    return;
  }

  await db.collection('devices').doc(imei).collection('locations').add(data);
}

async function createAlert(imei, alert) {
  const data = {
    imei,
    resolved: false,
    resolvedAt: null,
    createdAt: nowTs(),
    ...alert,
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] alerts`, JSON.stringify(data));
    return;
  }

  await db.collection('alerts').add(data);
}

module.exports = {
  initFirestore,
  upsertDevice,
  appendLocation,
  createAlert,
};
