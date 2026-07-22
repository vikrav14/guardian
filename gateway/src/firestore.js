const fs = require('fs');
const admin = require('firebase-admin');
const config = require('./config');
const { notifyEmergencyContacts } = require('./notify');
const { notifyGuardianDevices } = require('./push');
const { sendDeviceCommand } = require('./commands');
const { isFullImei, isProtocolId, normalizeImei } = require('./imei');

let db = null;
let enabled = false;
let alertWatchUnsub = null;
let commandWatchUnsub = null;

function initFirestore() {
  if (config.firestoreDisabled) {
    console.log('[firestore] disabled (FIRESTORE_DISABLED=true) — logging writes only');
    return;
  }

  if (!config.firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID is required when Firestore is enabled');
  }

  if (!config.googleApplicationCredentials) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required when Firestore is enabled');
  }

  if (!fs.existsSync(config.googleApplicationCredentials)) {
    throw new Error(
      `Service account file not found:\n  ${config.googleApplicationCredentials}\n` +
        'Put your Firebase private key JSON there, then restart the gateway.'
    );
  }

  const serviceAccount = JSON.parse(
    fs.readFileSync(config.googleApplicationCredentials, 'utf8')
  );

  if (serviceAccount.type !== 'service_account') {
    throw new Error(
      'Credentials file is not a Firebase service account JSON (missing type: service_account).'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: config.firebaseProjectId,
  });

  db = admin.firestore();
  enabled = true;
  console.log(`[firestore] connected to project ${config.firebaseProjectId}`);
  startPendingAlertWatcher();
  startPendingCommandWatcher();
}

function getDb() {
  return enabled ? db : null;
}

function nowTs() {
  return enabled ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
}

async function migrateLegacyDeviceDoc(canonicalImei, protocolId) {
  if (!enabled || !protocolId || protocolId === canonicalImei) return;

  const legacyRef = db.collection('devices').doc(protocolId);
  const canonicalRef = db.collection('devices').doc(canonicalImei);
  const legacySnap = await legacyRef.get();
  if (!legacySnap.exists) return;

  const legacyData = legacySnap.data() || {};
  await canonicalRef.set(
    {
      ...legacyData,
      imei: canonicalImei,
      protocolId,
      migratedFrom: protocolId,
      updatedAt: nowTs(),
    },
    { merge: true }
  );
  await legacyRef.delete();
  console.log(`[firestore] migrated devices/${protocolId} → devices/${canonicalImei}`);
}

async function upsertDevice(imei, patch = {}) {
  const canonicalImei = normalizeImei(imei);
  const { protocolId, ...rest } = patch;
  const data = {
    ...rest,
    imei: canonicalImei,
    updatedAt: nowTs(),
  };

  if (protocolId && isProtocolId(protocolId) && isFullImei(canonicalImei)) {
    data.protocolId = protocolId;
  }

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${canonicalImei}`, JSON.stringify(data));
    if (protocolId && protocolId !== canonicalImei) {
      console.log(`[firestore:dry-run] would migrate devices/${protocolId} → devices/${canonicalImei}`);
    }
    return;
  }

  if (protocolId && protocolId !== canonicalImei) {
    await migrateLegacyDeviceDoc(canonicalImei, protocolId);
  }

  const ref = db.collection('devices').doc(canonicalImei);
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

// Push notifications go to the guardian's own app for anything alert-worthy.
function shouldNotify(alert) {
  const t = String(alert.type || '').toLowerCase();
  return ['sos', 'fall', 'geofence_exit', 'geofence_enter', 'low_battery'].includes(t);
}

// SMS/WhatsApp to emergency contacts stays reserved for the urgent subset.
function shouldSms(alert) {
  const t = String(alert.type || '').toLowerCase();
  return t === 'sos' || t === 'fall' || t === 'geofence_exit';
}

async function deliverAlertNotifications(imei, alert, alertId) {
  if (!shouldNotify(alert)) {
    if (enabled && alertId) {
      await db.collection('alerts').doc(alertId).set(
        { notifyStatus: 'skipped' },
        { merge: true }
      );
    }
    return;
  }

  if (enabled && alertId) {
    const ref = db.collection('alerts').doc(alertId);
    try {
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        if (snap.data().notifyStatus !== 'pending') return false;
        tx.update(ref, { notifyStatus: 'sending' });
        return true;
      });
      if (!claimed) return;
    } catch (err) {
      console.error('[notify] claim failed', err.message);
      return;
    }
  }

  try {
    const tasks = [notifyGuardianDevices(db, imei, alert)];
    if (shouldSms(alert)) tasks.push(notifyEmergencyContacts(db, imei, alert));
    await Promise.all(tasks);
    if (enabled && alertId) {
      await db.collection('alerts').doc(alertId).set(
        {
          notifyStatus: 'sent',
          notifiedAt: nowTs(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error('[notify] failed', err.message);
    if (enabled && alertId) {
      await db.collection('alerts').doc(alertId).set(
        {
          notifyStatus: 'failed',
          notifyError: err.message,
        },
        { merge: true }
      );
    }
  }
}

async function createAlert(imei, alert) {
  const data = {
    imei,
    resolved: false,
    resolvedAt: null,
    notifyStatus: 'pending',
    createdAt: nowTs(),
    ...alert,
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] alerts`, JSON.stringify(data));
    await deliverAlertNotifications(imei, data, null);
    return null;
  }

  const ref = await db.collection('alerts').add(data);
  // Deliver immediately for gateway-originated alerts (watcher also covers app SOS).
  await deliverAlertNotifications(imei, data, ref.id);
  return ref.id;
}

function startPendingAlertWatcher() {
  if (!enabled || alertWatchUnsub) return;

  alertWatchUnsub = db
    .collection('alerts')
    .where('notifyStatus', '==', 'pending')
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return;
          const data = change.doc.data() || {};
          // Skip if gateway createAlert is already delivering the same doc mid-write.
          if (data.notifyStatus !== 'pending') return;
          deliverAlertNotifications(data.imei, data, change.doc.id).catch((err) => {
            console.error('[notify] watcher error', err.message);
          });
        });
      },
      (err) => {
        console.error('[notify] alert watcher failed', err.message);
      }
    );

  console.log('[notify] watching alerts with notifyStatus=pending');
}

async function deliverDeviceCommand(imei, type, params, commandId) {
  const ref = db.collection('deviceCommands').doc(commandId);
  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      if (snap.data().status !== 'pending') return false;
      tx.update(ref, { status: 'sending' });
      return true;
    });
    if (!claimed) return;
  } catch (err) {
    console.error('[commands] claim failed', err.message);
    return;
  }

  try {
    const outcome = await sendDeviceCommand(db, imei, type, params);
    await ref.set(
      { status: 'sent', result: outcome, completedAt: nowTs() },
      { merge: true }
    );
  } catch (err) {
    console.error('[commands] failed', err.message);
    await ref.set(
      { status: 'failed', error: err.message, completedAt: nowTs() },
      { merge: true }
    );
  }
}

function startPendingCommandWatcher() {
  if (!enabled || commandWatchUnsub) return;

  commandWatchUnsub = db
    .collection('deviceCommands')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return;
          const data = change.doc.data() || {};
          if (data.status !== 'pending') return;
          deliverDeviceCommand(data.imei, data.type, data.params, change.doc.id).catch((err) => {
            console.error('[commands] watcher error', err.message);
          });
        });
      },
      (err) => {
        console.error('[commands] watcher failed', err.message);
      }
    );

  console.log('[commands] watching deviceCommands with status=pending');
}

module.exports = {
  initFirestore,
  getDb,
  upsertDevice,
  appendLocation,
  createAlert,
};
