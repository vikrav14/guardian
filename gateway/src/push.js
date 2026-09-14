const admin = require('firebase-admin');
const {
  FEATURE, hasEntitlement, loadEntitlementsForUser,
} = require('./entitlements');

function requiredFeatureForAlert(alert) {
  const type = String(alert?.type || '').toLowerCase();
  if (type === 'sos' || type === 'fall') return FEATURE.SOS_ALERTS;
  if (type === 'low_battery') return FEATURE.BATTERY_ALERTS;
  if (type === 'geofence_exit' || type === 'geofence_enter') return FEATURE.SAFE_ZONES;
  if (type === 'watch_removed') return FEATURE.WATCH_REMOVAL_ALERTS;
  return FEATURE.PROACTIVE_SMART_NOTIFICATIONS;
}

/**
 * Find guardian users linked to this IMEI who have at least one FCM token
 * registered (i.e. have the app installed and notifications enabled).
 */
async function findRecipientsForImei(db, imei, alert = {}) {
  const snap = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  const recipients = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const entitlements = await loadEntitlementsForUser(db, { uid: doc.id, ...data });
    if (!hasEntitlement(entitlements, requiredFeatureForAlert(alert))) continue;
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    if (tokens.length) recipients.push({ uid: doc.id, tokens });
  }
  return recipients;
}

function titleFor(alert) {
  switch (String(alert.type || '').toLowerCase()) {
    case 'sos':
      return 'SOS alert';
    case 'fall':
      return 'Possible fall detected';
    case 'geofence_exit':
      return 'Left safe zone';
    case 'geofence_enter':
      return 'Entered safe zone';
    case 'low_battery':
      return 'Pendant battery low';
    case 'watch_removed':
      return 'Watch may have been removed';
    default:
      return 'Guardian alert';
  }
}

/**
 * Push a notification to every guardian device linked to this IMEI.
 * Best-effort: never throws, always returns a summary. Prunes tokens that
 * FCM reports as no-longer-registered so `users/{uid}.fcmTokens` stays clean.
 */
async function notifyGuardianDevices(db, imei, alert) {
  if (!db) return { sent: 0, pruned: 0 };

  const recipients = await findRecipientsForImei(db, imei, alert);
  const allTokens = recipients.flatMap((r) => r.tokens);
  if (!allTokens.length) return { sent: 0, pruned: 0 };

  const message = {
    notification: {
      title: titleFor(alert),
      body: alert.message || `Device ${imei}`,
    },
    data: {
      imei: String(imei),
      type: String(alert.type || 'other'),
    },
    tokens: allTokens,
  };

  let response;
  try {
    response = await admin.messaging().sendEachForMulticast(message);
  } catch (err) {
    console.error('[push] send failed', err.message);
    return { sent: 0, pruned: 0, error: err.message };
  }

  const deadTokens = new Set();
  response.responses.forEach((r, i) => {
    if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
      deadTokens.add(allTokens[i]);
    }
  });

  if (deadTokens.size) {
    await Promise.all(
      recipients
        .filter((r) => r.tokens.some((t) => deadTokens.has(t)))
        .map((r) =>
          db
            .collection('users')
            .doc(r.uid)
            .update({
              fcmTokens: admin.firestore.FieldValue.arrayRemove(...Array.from(deadTokens)),
            })
        )
    );
  }

  console.log(`[push] ${imei} sent=${response.successCount} failed=${response.failureCount} pruned=${deadTokens.size}`);
  return { sent: response.successCount, pruned: deadTokens.size };
}

module.exports = {
  notifyGuardianDevices,
  requiredFeatureForAlert,
};
