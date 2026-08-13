const {
  ACTION_STATUS, getPendingAction, claimPendingAction,
  cancelPendingAction, setActionOutcome,
} = require('./pending-actions');

function normalized(text) {
  return String(text || '').trim().toLowerCase().replace(/[.!]+$/g, '').replace(/\s+/g, ' ');
}

function actionReplyKind(text) {
  const value = normalized(text);
  if (['yes', 'yes confirm', 'confirm', 'oui', 'wi'].includes(value)) return 'confirm';
  if (['no', 'cancel', 'stop', 'never mind', 'nevermind', 'non'].includes(value)) return 'cancel';
  return null;
}

function actionDescription(action) {
  const name = action.wearerName || 'the selected wearer';
  if (action.actionType === 'schedule_reminder') {
    return `set ${action.parameters.medicineName} at ${action.parameters.time} (${action.parameters.frequency}) for ${name}`;
  }
  const labels = { ring: 'ring', locate: 'request a location ping from', vibrate: 'vibrate', alarm: 'sound' };
  return `${labels[action.actionType] || action.actionType} ${name}'s watch`;
}

async function handleActionReply({ db, ctx, text, execute }) {
  const kind = actionReplyKind(text);
  if (!kind || !ctx?.uid) return null;
  if (kind === 'cancel') {
    const cancelled = await cancelPendingAction(db, ctx.uid);
    return {
      handled: true,
      reply: cancelled ? 'Okay, the pending action was cancelled.' : "There's no pending action to cancel.",
      status: cancelled ? ACTION_STATUS.CANCELLED : null,
    };
  }
  const pending = await getPendingAction(db, ctx.uid);
  if (!pending) return { handled: true, reply: "There's no pending action to confirm.", status: null };
  const claim = await claimPendingAction(db, pending, ctx.uid, ctx.linkedImeis || []);
  if (!claim.ok) {
    return {
      handled: true,
      reply: claim.reason === 'expired'
        ? 'That confirmation expired. Please request the action again.'
        : 'That action could not be confirmed safely. Please request it again.',
      status: null,
    };
  }
  try {
    const result = await execute(claim.action);
    if (result?.error) throw new Error(result.error);
    const status = result?.status === ACTION_STATUS.ACKNOWLEDGED
      ? ACTION_STATUS.ACKNOWLEDGED : ACTION_STATUS.QUEUED;
    await setActionOutcome(db, claim.action.id, status, {
      result: { commandId: result?.commandId || null, reminderId: result?.reminderId || null, channel: result?.channel || null },
    });
    return {
      handled: true,
      reply: status === ACTION_STATUS.ACKNOWLEDGED
        ? `Confirmed: ${actionDescription(claim.action)}. The watch acknowledged it.`
        : `Confirmed: ${actionDescription(claim.action)}. It is queued; Guardian has not yet received a watch acknowledgement.`,
      status,
    };
  } catch (error) {
    await setActionOutcome(db, claim.action.id, ACTION_STATUS.FAILED, { error: error.message });
    return { handled: true, reply: `The action failed and was not completed: ${error.message}`, status: ACTION_STATUS.FAILED };
  }
}

module.exports = { actionReplyKind, actionDescription, handleActionReply };
