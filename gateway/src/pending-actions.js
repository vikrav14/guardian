/**
 * Pending actions store for multi-turn confirmations.
 *
 * When a user needs to confirm an action (e.g., ring device, schedule reminder),
 * we store it temporarily and check for confirmation on the next message.
 *
 * TTL: 10 minutes (600 seconds)
 */

const PENDING_TTL_SECONDS = 600;

/**
 * Store a pending action for a user.
 *
 * @param {Object} db - Firestore instance
 * @param {string} userId - User ID (from auth)
 * @param {Object} action - {type, device, ...params}
 * @returns {Promise<string>} - Action ID
 */
async function storePendingAction(db, userId, action) {
  const docRef = db.collection('pending_actions').doc();

  await docRef.set({
    userId,
    action,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000),
  });

  return docRef.id;
}

/**
 * Get most recent pending action for a user.
 *
 * @param {Object} db - Firestore instance
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - {id, action, createdAt} or null
 */
async function getPendingAction(db, userId) {
  const snap = await db
    .collection('pending_actions')
    .where('userId', '==', userId)
    .where('expiresAt', '>', new Date())
    .orderBy('expiresAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  const doc = snap.docs[0];
  const data = doc.data();

  return {
    id: doc.id,
    action: data.action,
    createdAt: data.createdAt,
  };
}

/**
 * Remove a pending action (after execution or expiry).
 *
 * @param {Object} db - Firestore instance
 * @param {string} actionId - Action ID
 * @returns {Promise<void>}
 */
async function removePendingAction(db, actionId) {
  await db.collection('pending_actions').doc(actionId).delete();
}

/**
 * Clean up expired pending actions.
 *
 * @param {Object} db - Firestore instance
 * @returns {Promise<number>} - Number of deleted documents
 */
async function cleanupExpiredActions(db) {
  const snap = await db
    .collection('pending_actions')
    .where('expiresAt', '<=', new Date())
    .get();

  let count = 0;
  for (const doc of snap.docs) {
    await doc.ref.delete();
    count++;
  }

  return count;
}

module.exports = {
  storePendingAction,
  getPendingAction,
  removePendingAction,
  cleanupExpiredActions,
};
