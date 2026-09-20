'use strict';

// Supplier protocol II.20 (page 7), example page 2. Operator acceptance only:
// these builders are deliberately absent from commands.js and the scheduler.
function clockAlarmCommand(slots) {
  if (!Array.isArray(slots) || slots.length !== 3) {
    throw new Error('REMIND requires all three clock slots explicitly');
  }
  const encoded = slots.map((slot) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)
        || Object.keys(slot).some((key) => !['time', 'enabled', 'frequency', 'weekMask'].includes(key))) {
      throw new Error('Invalid clock slot');
    }
    if (typeof slot.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)) {
      throw new Error('Clock time must be HH:MM (watch local time)');
    }
    if (typeof slot.enabled !== 'boolean' || ![1, 2, 3].includes(slot.frequency)) {
      throw new Error('Clock slot requires boolean enabled and frequency 1, 2, or 3');
    }
    let segment = `${slot.time}-${slot.enabled ? 1 : 0}-${slot.frequency}`;
    if (slot.frequency === 3) {
      // Raw vendor mask only. Do not borrow TAKEPILLS day ordering: validate
      // Monday/Sunday on the target firmware before mapping customer weekdays.
      if (typeof slot.weekMask !== 'string' || !/^[01]{7}$/.test(slot.weekMask)
          || (slot.enabled && slot.weekMask === '0000000')) {
        throw new Error('Weekly clock requires a seven-bit weekMask with an active day');
      }
      segment += `-${slot.weekMask}`;
    } else if (slot.weekMask !== undefined) {
      throw new Error('weekMask is only valid for weekly clocks');
    }
    return segment;
  });
  return `REMIND,${encoded.join(',')}`;
}

function buildCareReminderTrial({ imei, action, time }) {
  if (typeof imei !== 'string' || !/^\d{10}(?:\d{5})?$/.test(imei)) {
    throw new Error('Use the watch 10-digit protocol ID or 15-digit hardware IMEI');
  }
  const base = { imei, action, hardwareAccepted: false, wearerAcknowledgement: 'unavailable' };
  if (action === 'hsw-zero' || action === 'sedentary-example') {
    if (time !== undefined) throw new Error('time is only valid for remind-once');
    return {
      ...base,
      command: action === 'hsw-zero' ? 'HSW,0' : 'SEDENTARY,1,26',
      sendAllowed: false,
      reason: action === 'hsw-zero'
        ? 'Supplier protocol says speak time; example says switch. Polarity and restore behavior need confirmation.'
        : 'Only this literal example is documented. Field meanings, interval units/range and disable/restore payload are unknown.',
    };
  }
  if (!['remind-once', 'remind-off'].includes(action)) {
    throw new Error('Choose remind-once, remind-off, hsw-zero, or sedentary-example');
  }
  if (action === 'remind-off' && time !== undefined) {
    throw new Error('time is only valid for remind-once');
  }
  const slots = Array.from({ length: 3 }, () => ({ time: '00:00', enabled: false, frequency: 1 }));
  if (action === 'remind-once') slots[0] = { time, enabled: true, frequency: 1 };
  return {
    ...base,
    command: clockAlarmCommand(slots),
    sendAllowed: true,
    replacesAllClockSlots: true,
    reason: 'Operator trial only. Check all watch clocks are disposable, use watch local time, and verify all three slots after sending.',
  };
}

// No retry: a timeout may happen after the watch receives the command.
async function runCareReminderTrial(options, send) {
  const plan = buildCareReminderTrial(options);
  if (options.send !== true) return { ...plan, status: 'preview', commandSent: false };
  if (!plan.sendAllowed) throw new Error(plan.reason);
  if (options.confirmReplaceClocks !== true) {
    throw new Error('Sending replaces all three clock slots; first inspect the watch, then use --confirm-replace-clocks');
  }
  const result = await send(plan.imei, plan.command);
  if (result?.ok !== true) {
    throw new Error('Gateway did not confirm socket handoff. Inspect the watch before retrying.');
  }
  return {
    ...plan,
    status: 'socket_handoff',
    commandSent: true,
    protocolId: result.protocolId,
    sessions: result.sessions,
    note: 'Socket handoff is not a device acknowledgement or proof that a clock rang. Record the watch result separately.',
  };
}

module.exports = { clockAlarmCommand, buildCareReminderTrial, runCareReminderTrial };
