'use strict';

const { buildWellbeingScheduleCommand } = require('./care-wellbeing');
const { wearAt } = require('./wear-evidence');

const ROUTINES = Object.freeze({ manual: 0, gentle: 12, balanced: 8 });

// ReachFar V46/V48/V52 protocol, II.32–33, page 9. BT=2 is a
// firmware prerequisite, not inferred from a plausible btemp2 upload.
function temperatureCommand({ action, hours = 12 }) {
  if (action === 'single') return 'bodytemp2';
  if (!['start', 'stop'].includes(action) || !Number.isInteger(hours) || hours < 1 || hours > 12) {
    throw new Error('Temperature cycle requires start/stop and 1–12 whole hours.');
  }
  return `bodytemp,${action === 'start' ? 1 : 0},${hours}`;
}

function routineCommands(routine) {
  if (!Object.hasOwn(ROUTINES, routine)) throw new Error('Choose manual, gentle or balanced.');
  const hours = ROUTINES[routine];
  return [
    buildWellbeingScheduleCommand({ enabled: hours !== 0, intervalSeconds: hours * 3600 }),
    temperatureCommand({ action: hours ? 'start' : 'stop', hours: hours || 12 }),
  ];
}

function parseTemperatureMode(decoded) {
  if (decoded?.command !== 'CONFIG' || !Array.isArray(decoded.args)) return undefined;
  const result = { bt: null, tm: null };
  // Duplicate fields are ambiguous. Never persist the other CONFIG fields,
  // which can include identifiers and unrelated hardware/settings data.
  for (const [key, target] of [['BT', 'bt'], ['TM', 'tm']]) {
    const fields = decoded.args.map(a => String(a).trim()).filter(a => a.startsWith(`${key}:`));
    if (fields.length === 1 && new RegExp(`^${key}:[0-9]$`).test(fields[0])) {
      result[target] = Number(fields[0].slice(3));
    }
  }
  return result;
}

function routineBlock(context, live, now) {
  if (!context.enabled) return 'routine_pilot_disabled';
  if (!context.authorized) return 'access_or_consent_unavailable';
  if (context.validUntil && +context.validUntil <= +now) return 'access_or_consent_unavailable';
  if (!live.connected) return 'watch_offline';
  if (live.bt !== 2) return 'temperature_mode_unconfirmed';
  const wear = wearAt(live.wear, now);
  if (!wear.eligible) return wear.state === 'removed' ? 'watch_removed' : 'wearing_unconfirmed';
  return null;
}

// The controller serializes work; the runtime supplies a durable lease and
// checkpoint before socket writes. Handoff is never called device acceptance.
function createRoutineController({ read, live, save, send, clock = () => new Date() }) {
  let pending;
  async function run() {
    const context = await read();
    if (!context) return; // another gateway owns the lease
    const requested = context.request?.routine;
    const valid = Object.hasOwn(ROUTINES, requested);
    const revision = context.request?.revision || null;
    const prior = context.state || {};
    let snapshot = live();
    let block = requested === 'manual'
      ? (context.canStop ? null : 'access_or_consent_unavailable')
      : routineBlock(context, snapshot, clock());
    if (!valid) block = 'no_routine_selected';
    if (prior.failedRevision === revision && requested !== 'manual') block = 'previous_handoff_failed';
    const stop = !valid || requested === 'manual' || block != null;
    const initialSessionId = snapshot.sessionId;
    const desiredKey = `${revision}:${stop ? 'stop' : requested}:${snapshot.sessionId || ''}:bt${snapshot.bt === 2 ? 2 : 'unknown'}`;
    // The marker is saved only after all handoffs. After a process restart,
    // the session changes and fresh wearing/CONFIG evidence is required.
    const unchanged = prior.handoffKey === desiredKey;
    const explicitStop = requested === 'manual' && context.canStop;
    const shouldSend = !unchanged && (!stop || prior.mayBeRunning === true ||
      prior.temperatureMayBeRunning === true || explicitStop);
    const status = { version: 1, routine: valid ? requested : 'manual', revision,
      intervalHours: ROUTINES[requested] || null, temperatureBt: snapshot.bt ?? null,
      wearingStatus: wearAt(snapshot.wear, clock()).state,
      phase: block ? 'blocked' : 'awaiting_readings', reason: block,
      customerAccepted: false, scheduleVerified: false, updatedAt: clock() };

    if (!shouldSend) {
      await save({ ...status, ...(requested === 'manual' && unchanged && !block
        ? { phase: 'stop_sent', reason: prior.reason } : {}),
      });
      return;
    }
    if (!snapshot.connected) {
      await save({ ...status, phase: stop ? 'stop_pending_offline' : 'blocked', reason: 'watch_offline' });
      return;
    }
    // On a first manual action with unknown BT mode, stop the known heart
    // schedule only. Do not claim all metrics are stopped.
    const commands = stop ? routineCommands('manual') : routineCommands(requested);
    const includeTemperature = snapshot.bt === 2 || prior.temperatureMayBeRunning === true;
    if (stop && !includeTemperature) commands.pop();
    await save({ ...status, phase: 'sending', mayBeRunning: true,
      temperatureMayBeRunning: includeTemperature || !stop,
      handoffKey: null });
    // Recheck fresh wearing/session after the checkpoint I/O. Never borrow
    // wearing proof that expired while Firestore was slow.
    snapshot = live();
    const handedOff = [];
    try {
      for (const command of commands) {
        if (!stop) {
          const latest = await read();
          snapshot = live();
          if (!latest || latest.request?.revision !== revision ||
              snapshot.sessionId !== initialSessionId ||
              routineBlock(latest, snapshot, clock())) throw new Error('preflight_changed');
        }
        const result = send(command);
        if (!result?.ok) throw new Error('handoff_failed');
        handedOff.push(command.split(',')[0]);
      }
    } catch {
      // Partial sends may leave a native schedule running. Persist that fact;
      // next reconciliation stops first instead of restarting both blindly.
      await save({ phase: 'handoff_failed', reason: 'device_state_unconfirmed',
        handedOff, failedRevision: revision, updatedAt: clock() });
      return;
    }
    await save({ ...status, phase: stop ? 'stop_sent' : 'awaiting_readings',
      reason: stop ? (includeTemperature ? 'stop_handoff_not_device_confirmation' : 'temperature_mode_unconfirmed') : null,
      handoffKey: desiredKey, handedOff, handoffAt: clock(),
      mayBeRunning: !stop, temperatureMayBeRunning: !stop,
    });
  }
  return { tick() {
    if (!pending) pending = run().finally(() => { pending = null; });
    return pending;
  } };
}

module.exports = { ROUTINES, routineCommands, temperatureCommand, parseTemperatureMode,
  routineBlock, createRoutineController };
