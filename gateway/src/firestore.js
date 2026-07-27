const fs = require('fs');
const admin = require('firebase-admin');
const config = require('./config');
const { notifyEmergencyContacts } = require('./notify');
const { notifyGuardianDevices } = require('./push');
const { sendDeviceCommand } = require('./commands');
const { isFullImei, isProtocolId, normalizeImei } = require('./imei');
const {
  evaluateDeviceIntelligence,
  shouldCreateOfflineAlert,
  buildOfflineAlertCopy,
  buildLocationContext,
} = require('./intelligence');
const { increment: incrementMetric, incrementAlert } = require('./ops-metrics/collector');
const { listConnectedImeis, findSocketsForDevice, listSilentConnectedImeis } = require('./sessions');
const { hasPendingOffline } = require('./device-offline');
const {
  connectionStaleMinutes,
  shouldReconcileStaleOnline,
} = require('./device-presence');

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

  if (Object.prototype.hasOwnProperty.call(rest, 'online')) {
    if (rest.online === true) {
      data.disconnectedAt = admin.firestore.FieldValue.delete();
      if (!Object.prototype.hasOwnProperty.call(rest, 'connectionState')) {
        data.connectionState = 'live';
      }
    } else if (rest.online === false) {
      const linking = rest.connectionState === 'connecting';
      if (rest.disconnectedAt === undefined && !linking) {
        data.disconnectedAt = nowTs();
      }
      if (!Object.prototype.hasOwnProperty.call(rest, 'connectionState')) {
        data.connectionState = 'offline';
      }
    }
  }

  if (rest.connectionState === 'live') {
    data.connectingAt = admin.firestore.FieldValue.delete();
  }

  if (protocolId && isProtocolId(protocolId) && isFullImei(canonicalImei)) {
    data.protocolId = protocolId;
  }

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${canonicalImei}`, JSON.stringify(data));
    incrementMetric('firestoreWrites');
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
  incrementMetric('firestoreWrites');
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

async function appendSegment(imei, segment) {
  const data = {
    ...segment,
    createdAt: nowTs(),
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${imei}/segments`, JSON.stringify(data));
    return;
  }

  await db.collection('devices').doc(imei).collection('segments').add(data);
}

async function appendJourney(imei, journey) {
  const data = {
    ...journey,
    createdAt: nowTs(),
  };

  if (!enabled) {
    console.log(`[firestore:dry-run] devices/${imei}/journeys`, JSON.stringify(data));
    return null;
  }

  const ref = await db.collection('devices').doc(imei).collection('journeys').add(data);
  return ref.id;
}

// Push notifications go to the guardian's own app for anything alert-worthy.
function shouldNotify(alert) {
  const t = String(alert.type || '').toLowerCase();
  return ['sos', 'fall', 'geofence_exit', 'geofence_enter', 'low_battery', 'offline'].includes(
    t
  );
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
    incrementAlert(alert.type || 'unknown');
    incrementMetric('firestoreWrites');
    await deliverAlertNotifications(imei, data, null);
    return null;
  }

  incrementAlert(alert.type || 'unknown');
  incrementMetric('firestoreWrites');
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

function intelligenceConfig() {
  return {
    offlineMinutes: config.intelligenceOfflineMinutes,
    offlineAlertCooldownMinutes: config.intelligenceOfflineAlertCooldownMinutes,
  };
}

async function loadActiveGeofences(db, imei) {
  const snap = await db
    .collection('geofences')
    .where('imei', '==', imei)
    .where('active', '==', true)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function hasOpenOfflineAlert(db, imei) {
  const snap = await db
    .collection('alerts')
    .where('imei', '==', imei)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  return snap.docs.some((doc) => {
    const data = doc.data() || {};
    return data.type === 'offline' && data.resolved !== true;
  });
}

async function refreshDeviceIntelligence(imei, deviceOverride = null) {
  const canonicalImei = normalizeImei(imei);
  const db = getDb();
  const cfg = intelligenceConfig();

  let device = deviceOverride;
  if (!device && db) {
    const snap = await db.collection('devices').doc(canonicalImei).get();
    device = snap.exists ? { imei: canonicalImei, ...snap.data() } : null;
  }
  if (!device) return [];

  const geofences = db ? await loadActiveGeofences(db, canonicalImei) : [];
  const insights = evaluateDeviceIntelligence({
    imei: canonicalImei,
    device,
    geofences,
    config: cfg,
  });

  const payload = {
    updatedAt: nowTs(),
    insights,
    topInsight: insights[0] || null,
  };

  if (!enabled) {
    console.log(
      `[firestore:dry-run] devices/${canonicalImei}.intelligence`,
      JSON.stringify(payload)
    );
  } else {
    await db.collection('devices').doc(canonicalImei).set({ intelligence: payload }, { merge: true });
  }

  const offlineInsight = insights.find(
    (item) => item.id === 'offline' && item.confidence >= item.suppressBelow
  );
  if (offlineInsight) {
    const staleMinutes =
      offlineInsight.facts.find((f) => f.field === 'minutesSinceHeartbeat')?.value ??
      config.intelligenceOfflineMinutes;
    const loc = buildLocationContext(device);
    const alertCopy = buildOfflineAlertCopy(device, staleMinutes, loc);

    if (device.online !== false) {
      await upsertDevice(canonicalImei, { online: false, connectionState: 'offline' });
    }

    const canCreate =
      shouldCreateOfflineAlert(canonicalImei, cfg) &&
      db &&
      !(await hasOpenOfflineAlert(db, canonicalImei));

    if (canCreate) {
      await createAlert(canonicalImei, {
        type: 'offline',
        severity: offlineInsight.level === 'urgent' ? 'critical' : 'warning',
        title: alertCopy.title,
        message: alertCopy.message,
        payload: {
          source: 'intelligence',
          facts: offlineInsight.facts,
          confidence: offlineInsight.confidence,
        },
      });
    }
  }

  return insights;
}

async function reconcileStaleOnlineFlags() {
  const db = getDb();
  if (!db || !enabled) return 0;

  const activeImeis = listConnectedImeis();
  const silentImeis = listSilentConnectedImeis(config.tcpSilentSeconds * 1000);
  const staleMinutes = connectionStaleMinutes(config);
  const snap = await db.collection('devices').where('online', '==', true).get();
  let cleared = 0;

  for (const silentImei of silentImeis) {
    for (const { socket } of findSocketsForDevice(silentImei)) {
      console.log(`[intelligence] closing silent TCP for ${silentImei} (no packets)`);
      try {
        socket.destroy();
      } catch (_) {
        /* ignore */
      }
    }
  }

  for (const doc of snap.docs) {
    if (hasPendingOffline(doc.id)) continue;

    const device = doc.data();
    // Any open TCP counts as connected. Silent sockets are closed above; do not
    // also force offline here while the socket is still registered.
    if (activeImeis.has(doc.id)) continue;

    if (
      !shouldReconcileStaleOnline(device, {
        staleMinutes,
      })
    ) {
      continue;
    }

    await upsertDevice(doc.id, { online: false, connectionState: 'offline' });
    cleared += 1;
  }

  if (cleared > 0) {
    console.log(`[intelligence] cleared stale online flag on ${cleared} device(s)`);
  }
  return cleared;
}

async function checkOfflineDevices() {
  const db = getDb();
  if (!db) return;

  await reconcileStaleOnlineFlags();

  const snap = await db.collection('devices').where('online', '==', true).get();
  for (const doc of snap.docs) {
    try {
      await refreshDeviceIntelligence(doc.id, { imei: doc.id, ...doc.data() });
    } catch (err) {
      console.error('[intelligence] refresh failed', doc.id, err.message);
    }
  }
}

function startIntelligenceMonitor() {
  if (config.firestoreDisabled) return;
  const intervalMs = config.intelligenceCheckIntervalMs;
  reconcileStaleOnlineFlags().catch((err) => {
    console.error('[intelligence] startup reconcile failed', err.message);
  });
  setInterval(() => {
    checkOfflineDevices().catch((err) => {
      console.error('[intelligence] periodic check failed', err.message);
    });
  }, intervalMs);
  console.log(`[intelligence] monitoring offline devices every ${intervalMs / 1000}s`);
}

async function getDeviceDocument(imei) {
  const db = getDb();
  if (!db || !enabled) return null;
  const canonicalImei = normalizeImei(imei);
  const snap = await db.collection('devices').doc(canonicalImei).get();
  return snap.exists ? snap.data() : null;
}

module.exports = {
  initFirestore,
  getDb,
  getDeviceDocument,
  upsertDevice,
  appendLocation,
  appendSegment,
  appendJourney,
  createAlert,
  refreshDeviceIntelligence,
  reconcileStaleOnlineFlags,
  startIntelligenceMonitor,
};
