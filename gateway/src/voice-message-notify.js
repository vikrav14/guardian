'use strict';
const admin = require('firebase-admin');
const { authorizeVoice } = require('./voice-message-policy');

// A generic lock-screen notice only; neither audio nor wearer identity leaves
// the authenticated conversation. One bounded attempt, never a media retry.
async function notifyIncomingVoice({ db, access, row, runtime,
  authorize = authorizeVoice, messaging = () => admin.messaging(), now = Date.now,
  timeoutMs = 8000 } = {}) {
  const ref = db.collection('voiceMessages').doc(row.id);
  const record = async (value) => db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) tx.set(ref, { notification: value }, { merge: true });
  });
  let timer;
  try {
    await authorize({ db, ...access, runtime });
    const claimed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref), current = snap.data();
      if (!snap.exists || current.direction !== 'incoming' || current.uid !== access.uid ||
          current.imei !== access.imei || current.deletedAtMs || current.expiresAtMs <= now() ||
          current.notification) return false;
      tx.set(ref, { notification: { status: 'attempting', attemptedAtMs: now() } }, { merge: true });
      return true;
    });
    if (!claimed) return;
    const user = (await db.collection('users').doc(access.uid).get()).data();
    const tokens = [...new Set((user?.fcmTokens || []).filter(t => typeof t === 'string' && t.length > 0))].slice(0, 500);
    if (!tokens.length) { await record({ status: 'no_registered_devices', attemptedAtMs: now() }); return; }
    await authorize({ db, ...access, runtime });
    const current = (await ref.get()).data();
    if (!current || current.deletedAtMs || current.expiresAtMs <= now()) return;
    const response = await Promise.race([
      messaging().sendEachForMulticast({
        tokens,
        notification: { title: 'New voice message', body: 'Open Guardian to listen and reply.' },
        data: { type: 'voice_message', imei: access.imei, messageId: row.id, recipientUid: access.uid },
        android: { priority: 'high', ttl: Math.max(0, Math.min(3600000, current.expiresAtMs - now())),
          notification: { channelId: 'guardian_messages', tag: row.id, visibility: 'private', sound: 'default' } },
        webpush: { headers: { TTL: '3600' }, notification: { tag: row.id },
          fcmOptions: { link: `https://guardian-fbadd.web.app/?voiceImei=${encodeURIComponent(access.imei)}&voiceMessage=${encodeURIComponent(row.id)}` } },
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(), { code: 'push_timeout' })), timeoutMs); }),
    ]);
    clearTimeout(timer);
    await record({ status: 'provider_result', attemptedAtMs: now(),
      accepted: response.successCount, failed: response.failureCount });
  } catch (error) {
    clearTimeout(timer);
    // Push failure never changes stored media or the TK success receipt.
    await record({ status: error.code === 'push_timeout' ? 'unconfirmed' : 'failed', attemptedAtMs: now() }).catch(() => {});
  }
}
module.exports = { notifyIncomingVoice };
