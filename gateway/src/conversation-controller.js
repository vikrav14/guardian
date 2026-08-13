const DEFAULT_TTL_MS = 30 * 60 * 1000;

const REPLIES = Object.freeze({
  acknowledgement: "You're welcome.",
  greeting:
    "Hi, I'm Guardian. Ask me where someone is, their watch battery, recent alerts, safe zones, journeys, or reminders.",
  help:
    'I can check location, battery and watch status, recent alerts, safe zones and journeys. I can also help set medication reminders and send permitted watch commands.',
  cancelled: 'Okay, cancelled.',
  nothingToCancel: "There's nothing waiting for confirmation.",
  reminderHelp:
    'I can set a medication reminder on the watch. Tell me the medicine, time in 24-hour format, frequency or days, and the wearer—for example: “Remind Mum to take Metformin at 20:00 every day.”',
  journeyHelp:
    'Ask for a wearer’s recent journeys—for example: “Show Jesh’s journeys today.” Guardian can then show confirmed outings, times, stops and route details when available.',
});

function normalized(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function exactMatch(text, values) {
  return values.includes(normalized(text));
}

function deviceName(device) {
  return String(device?.nickname || device?.relationship || device?.name || '')
    .replace(/(?:'s)?\s+(?:pendant|device)$/i, '')
    .trim();
}

function findMentionedDevice(devices, text) {
  const value = normalized(text);
  return (devices || []).find((device) => {
    const name = normalized(deviceName(device));
    return name && (value === name || new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value));
  }) || null;
}

function needsWearer(intentType) {
  return [
    'LOCATION_REQUEST',
    'DEVICE_STATUS',
    'RECENT_ALERTS',
    'SAFE_ZONE_CHECK',
    'JOURNEY_QUERY',
  ].includes(intentType);
}

function expandWithWearer(text, intentType, wearer) {
  const name = deviceName(wearer);
  if (!name) return text;
  if (intentType === 'LOCATION_REQUEST') return `Where is ${name}?`;
  if (intentType === 'DEVICE_STATUS') return `${text} for ${name}`;
  if (intentType === 'RECENT_ALERTS') return `Recent alerts for ${name}?`;
  if (intentType === 'SAFE_ZONE_CHECK') return `${text} for ${name}`;
  if (intentType === 'JOURNEY_QUERY') return `Show ${name}'s recent journeys`;
  return text;
}

class ConversationController {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.states = new Map();
  }

  getState(from) {
    const state = this.states.get(from);
    if (!state) return null;
    if (state.expiresAt <= this.now()) {
      this.states.delete(from);
      return null;
    }
    return state;
  }

  setState(from, patch) {
    const state = { ...(this.getState(from) || {}), ...patch, expiresAt: this.now() + this.ttlMs };
    this.states.set(from, state);
    return state;
  }

  clear(from) {
    this.states.delete(from);
  }

  deterministicReply(from, text) {
    const courtesyText = normalized(text);
    const courtesyReply =
      /^(?:(?:ok|okay|alright|all right)[, ]+)?(?:thanks|thank you|thx|ty|merci|mersi)(?:[, ]+guardian)?$/.test(courtesyText) ||
      /^(?:thanks|thank you|thx|ty|merci|mersi)[, ]+(?:ok|okay|guardian)$/.test(courtesyText);
    if (courtesyReply) {
      return { reply: REPLIES.acknowledgement, reason: 'courtesy_acknowledgement' };
    }
    if (exactMatch(text, ['hi', 'hello', 'hey', 'bonjour', 'bonsoir', 'salut'])) {
      return { reply: REPLIES.greeting, reason: 'greeting' };
    }
    if (exactMatch(text, ['help', 'menu', 'what can you do', 'capabilities'])) {
      return { reply: REPLIES.help, reason: 'help' };
    }
    if (exactMatch(text, ['cancel', 'stop', 'never mind', 'nevermind'])) {
      const hadPending = Boolean(this.getState(from)?.pendingIntent);
      this.clear(from);
      return {
        reply: hadPending ? REPLIES.cancelled : REPLIES.nothingToCancel,
        reason: hadPending ? 'pending_cancelled' : 'nothing_to_cancel',
      };
    }
    if (/^what reminders? can i set$/i.test(normalized(text)) || exactMatch(text, ['reminder', 'reminders', 'reminder help'])) {
      return { reply: REPLIES.reminderHelp, reason: 'reminder_help' };
    }
    if (
      exactMatch(text, ['journey help', 'journeys help', 'trip help']) ||
      /^(?:what|which) (?:journey|trip) (?:information|questions) can i (?:ask|get)$/i.test(normalized(text)) ||
      /^what can i ask about (?:journeys|trips)$/i.test(normalized(text))
    ) {
      return { reply: REPLIES.journeyHelp, reason: 'journey_help' };
    }
    return null;
  }

  resolvePendingWearer(from, text, devices) {
    const state = this.getState(from);
    if (!state?.pendingIntent) return null;
    const wearer = findMentionedDevice(devices, text);
    if (!wearer) return null;
    this.setState(from, {
      pendingIntent: null,
      lastIntent: state.pendingIntent,
      lastWearerImei: wearer.imei,
    });
    return {
      text: expandWithWearer(text, state.pendingIntent, wearer),
      intentType: state.pendingIntent,
      wearer,
    };
  }

  resolveWearer(from, text, intentType, devices) {
    if (!needsWearer(intentType)) return { text, wearer: null };
    const mentioned = findMentionedDevice(devices, text);
    if (mentioned) {
      this.setState(from, { lastIntent: intentType, lastWearerImei: mentioned.imei, pendingIntent: null });
      return { text, wearer: mentioned };
    }

    const state = this.getState(from);
    const remembered = (devices || []).find((device) => device.imei === state?.lastWearerImei);
    const wearer = remembered || ((devices || []).length === 1 ? devices[0] : null);
    if (wearer) {
      this.setState(from, { lastIntent: intentType, lastWearerImei: wearer.imei, pendingIntent: null });
      return { text: expandWithWearer(text, intentType, wearer), wearer };
    }

    if ((devices || []).length > 1) {
      this.setState(from, { pendingIntent: intentType });
      const names = devices.map(deviceName).filter(Boolean);
      return {
        text,
        wearer: null,
        reply: `Who would you like me to check—${names.join(' or ')}?`,
        reason: 'wearer_required',
      };
    }
    return { text, wearer: null };
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  REPLIES,
  ConversationController,
  deviceName,
  findMentionedDevice,
  expandWithWearer,
};
