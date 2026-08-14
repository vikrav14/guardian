const admin = require('firebase-admin');
const { evaluateSubscription } = require('./entitlements');

let familyJoinWatchUnsub = null;

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function asDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date?.getTime?.()) ? date : null;
}

function assessFamilyJoin({
  requesterUid,
  ownerUid,
  memberUids,
  caregiverLimit,
  inviteStatus,
  expiresAt,
  now = new Date(),
}) {
  const requester = String(requesterUid || '');
  const owner = String(ownerUid || '');
  if (!requester || !owner) return { ok: false, reason: 'missing_identity' };
  if (requester === owner) return { ok: false, reason: 'cannot_join_own_family' };
  if (inviteStatus !== 'pending') return { ok: false, reason: 'invite_not_pending' };

  const expiry = asDate(expiresAt);
  if (!expiry || expiry <= now) return { ok: false, reason: 'invite_expired' };

  const members = uniqueStrings(memberUids).filter((uid) => uid !== owner);
  if (members.includes(requester)) {
    return { ok: true, alreadyMember: true, members };
  }

  const limit = Number(caregiverLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, reason: 'service_inactive' };
  }
  if (members.length >= limit) {
    return { ok: false, reason: 'caregiver_limit_reached' };
  }

  return { ok: true, alreadyMember: false, members: [...members, requester] };
}

function familyMemberEntry(uid, user = {}) {
  const displayName = String(user.displayName || user.email || 'Family member').trim();
  const entry = { uid: String(uid), displayName: displayName || 'Family member' };
  if (user.email) entry.email = String(user.email);
  return entry;
}

function upsertFamilyMember(entries, next) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object' && entry.uid)
    .map((entry) => ({ ...entry, uid: String(entry.uid) }));
  const index = list.findIndex((entry) => entry.uid === next.uid);
  if (index >= 0) list[index] = next;
  else list.push(next);
  return list;
}

async function processFamilyJoin(db, requestId, { now = new Date() } = {}) {
  if (!db || !requestId) return { ok: false, reason: 'missing_request' };
  const requestRef = db.collection('familyJoinRequests').doc(requestId);

  return db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) return { ok: false, reason: 'request_not_found' };
    const request = requestSnap.data() || {};
    if (request.status !== 'pending') {
      return { ok: false, reason: 'request_not_pending' };
    }

    const requesterUid = String(request.requestedBy || '');
    const code = String(request.inviteCode || '').trim().toUpperCase();
    if (!requesterUid || !code) {
      tx.set(requestRef, {
        status: 'rejected',
        reason: 'invalid_request',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason: 'invalid_request' };
    }

    const inviteQuery = db.collection('invites').where('code', '==', code).limit(2);
    const inviteQuerySnap = await tx.get(inviteQuery);
    if (inviteQuerySnap.size !== 1) {
      const reason = inviteQuerySnap.empty ? 'invite_not_found' : 'ambiguous_invite_code';
      tx.set(requestRef, {
        status: 'rejected',
        reason,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason };
    }

    const inviteSnap = inviteQuerySnap.docs[0];
    const invite = inviteSnap.data() || {};
    const ownerUid = String(invite.createdBy || '');
    const ownerRef = db.collection('users').doc(ownerUid);
    const requesterRef = db.collection('users').doc(requesterUid);
    const subscriptionRef = db.collection('serviceSubscriptions').doc(ownerUid);
    const ownerSnap = await tx.get(ownerRef);
    const requesterSnap = await tx.get(requesterRef);
    const subscriptionSnap = await tx.get(subscriptionRef);

    if (!ownerSnap.exists || !requesterSnap.exists || !subscriptionSnap.exists) {
      const reason = 'family_record_missing';
      tx.set(requestRef, {
        status: 'rejected',
        reason,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason };
    }

    const owner = ownerSnap.data() || {};
    const requester = requesterSnap.data() || {};
    const entitlements = evaluateSubscription(subscriptionSnap.data() || {}, {
      now,
      ownerUid,
    });
    const assessment = assessFamilyJoin({
      requesterUid,
      ownerUid,
      memberUids: owner.memberUids,
      caregiverLimit: entitlements.limits.caregivers,
      inviteStatus: invite.status,
      expiresAt: invite.expiresAt,
      now,
    });

    if (!assessment.ok) {
      tx.set(requestRef, {
        status: 'rejected',
        reason: assessment.reason,
        ownerUid: ownerUid || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return assessment;
    }

    const ownerEntry = familyMemberEntry(ownerUid, owner);
    const requesterEntry = familyMemberEntry(requesterUid, requester);
    const requesterPatch = {
      serviceOwnerUid: ownerUid,
      familyMembers: upsertFamilyMember(requester.familyMembers, ownerEntry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Copy only the owner's current server-visible links. Invitation payloads
    // are never an authorization source.
    const linkedImeis = uniqueStrings(owner.linkedImeis);
    if (linkedImeis.length > 0) {
      requesterPatch.linkedImeis = admin.firestore.FieldValue.arrayUnion(...linkedImeis);
    }

    tx.set(ownerRef, {
      memberUids: assessment.members,
      familyMembers: upsertFamilyMember(owner.familyMembers, requesterEntry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(requesterRef, requesterPatch, { merge: true });
    tx.set(inviteSnap.ref, {
      status: 'accepted',
      acceptedBy: requesterUid,
      acceptedByName: requesterEntry.displayName,
      acceptedByEmail: requesterEntry.email || null,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(requestRef, {
      status: 'accepted',
      ownerUid,
      inviteId: inviteSnap.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      alreadyMember: assessment.alreadyMember,
      ownerUid,
      requesterUid,
    };
  });
}

function startPendingFamilyJoinWatcher(db) {
  if (!db || familyJoinWatchUnsub) return;
  familyJoinWatchUnsub = db
    .collection('familyJoinRequests')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return;
          if ((change.doc.data() || {}).status !== 'pending') return;
          processFamilyJoin(db, change.doc.id).then((result) => {
            const outcome = result.ok ? 'accepted' : result.reason;
            console.log(`[family] join ${change.doc.id} ${outcome}`);
          }).catch((error) => {
            console.error('[family] join watcher error', error.message);
          });
        });
      },
      (error) => {
        console.error('[family] join watcher failed', error.message);
      },
    );
  console.log('[family] watching familyJoinRequests with status=pending');
}

module.exports = {
  assessFamilyJoin,
  familyMemberEntry,
  processFamilyJoin,
  startPendingFamilyJoinWatcher,
  uniqueStrings,
  upsertFamilyMember,
};
