'use strict';

const { randomBytes } = require('node:crypto');
const config = require('./config');
const { FEATURE, hasEntitlement, planBoundaryReply } = require('./entitlements');
const { runTool, restrictedCallerReply, deviceLabel } = require('./assistant/tools');
const { formatLocationReply } = require('./location-reply');
const { formatBatteryReply } = require('./battery-freshness');
const { formatActivityReply } = require('./activity-reply');
const { formatJourneyReply } = require('./journey-reply');
const { formatWellbeingReply } = require('./wellbeing-reply');
const { formatDailySummaryReply } = require('./daily-summary-reply');
const { answerWeatherQuery } = require('./weather-reply');
const { extractTimePeriod } = require('./language-understanding');

const TTL_MS = 30 * 60 * 1000;
const MENU_OPEN = /^(hi|hello|hey|bonjour|bonsoir|salut|help|menu|main menu|what can you do|capabilities)[.!?]*$/i;
const SWITCH_WEARER = /^(switch|change|choose) wearer[.!?]*$/i;
const OPTIONS = Object.freeze([
  ['location', 'Location', 'Last known location and how recent it is', 'Check now'],
  ['status', 'Watch status', 'Connection and latest battery reading', 'Check now'],
  ['weather', 'Weather nearby', 'Weather near the wearer’s recorded location', 'Check now'],
  ['activity', 'Steps & activity', 'Today’s recorded steps', 'Activity & wellbeing', FEATURE.ACTIVITY_STEPS],
  ['journeys', 'Journeys', 'Recent confirmed outings', 'Activity & wellbeing'],
  ['wellbeing', 'Wellbeing readings', 'Saved watch estimates, with wearer consent', 'Activity & wellbeing', FEATURE.WELLNESS_READINGS],
  ['summary', 'Today’s summary', 'Today’s recorded journeys, alerts and watch status', 'Activity & wellbeing', FEATURE.WELLBEING_ACTIVITY_SUMMARIES],
  ['alerts', 'Recent alerts', 'Latest recorded safety alerts', 'Safety & care'],
  ['zones', 'Safe zones', 'View saved active safe zones', 'Safety & care'],
  ['reminders', 'Reminders', 'View saved medication reminders', 'Safety & care', FEATURE.MEDICATION_REMINDERS],
]);

function availableOptions(ctx, flags) {
  return OPTIONS.filter(([key, , , , feature]) =>
    hasEntitlement(ctx.entitlements, feature || FEATURE.WHATSAPP_QA) &&
    (key !== 'activity' || flags.activityStepsCustomerEnabled === true) &&
    (key !== 'wellbeing' || flags.careWellbeingCustomerEnabled === true));
}

function clip(value, max) {
  const chars = Array.from(String(value || '').replace(/[\r\n]+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

// Preserve every character of a longer factual answer. Each page stays below
// Meta's interactive-body limit; More re-reads with current access/consent.
function pagesOf(text, max = 850) {
  const chars = Array.from(String(text));
  const pages = [];
  while (chars.length > max) {
    let cut = chars.slice(0, max).lastIndexOf('\n');
    if (cut < max / 2) cut = chars.slice(0, max).lastIndexOf(' ');
    if (cut < max / 2) cut = max;
    else cut++;
    pages.push(chars.splice(0, cut).join(''));
  }
  pages.push(chars.join(''));
  return pages;
}

function localTime(value) {
  const date = value?.toDate?.() || new Date(value || NaN);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
    : 'time unavailable';
}

async function readMenuAnswer({ db, ctx, device, action, contextService }) {
  const imei = device.imei;
  const name = clip(deviceLabel(device), 80);
  const read = (tool, input = {}) => runTool(db, ctx, tool, { ...input, imei });
  if (action === 'weather') return answerWeatherQuery({ device, contextService });
  if (action === 'location') return formatLocationReply(await read('get_last_location'));
  if (action === 'status') {
    const result = await read('get_battery');
    if (result.error) throw new Error('Watch status unavailable');
    return `${formatBatteryReply(result)}\n${result.online
      ? 'The watch has a recent connection report.'
      : 'No recent connection report. The watch may be offline.'}`;
  }
  if (action === 'activity') return formatActivityReply(await read('get_activity_summary', { days: 1 }));
  if (action === 'journeys') return formatJourneyReply(await read('get_recent_journeys', { limit: 3 }));
  if (action === 'wellbeing') {
    const result = await read('get_wellbeing_readings', { limit: 6 });
    if (result.code === 'consent_required') {
      return 'Current wearer consent is needed for wellbeing readings. Review consent in the Guardian app.';
    }
    return formatWellbeingReply(result);
  }
  if (action === 'summary') {
    const period = extractTimePeriod('today');
    return formatDailySummaryReply(await read('get_daily_summary', {
      start_at: period.startAt.toISOString(), end_at: period.endAt.toISOString(), period_label: period.label,
    }));
  }
  if (action === 'alerts') {
    const result = await read('get_recent_alerts', { limit: 5 });
    if (result.error) throw new Error('Alerts unavailable');
    const labels = { sos: 'SOS', fall: 'Possible fall', low_battery: 'Low battery',
      offline: 'Watch offline', geofence_enter: 'Safe-zone entry', geofence_exit: 'Safe-zone exit' };
    const rows = (result.alerts || []).filter(alert => alert.imei === imei);
    return rows.length
      ? `Recent alerts for ${name} (Mauritius time):\n` + rows.map(alert =>
        `• ${labels[alert.type] || 'Watch alert'} · ${localTime(alert.createdAt)}${alert.resolved ? ' · marked resolved' : ''}`).join('\n')
      : `No recent alerts were found for ${name}. This does not confirm the wearer is safe.`;
  }
  if (action === 'zones' || action === 'reminders') {
    // Exact linked device is validated before this bounded read. No global
    // fallback and no watch writes on list selection.
    if (!db) throw new Error('Storage unavailable');
    const zones = action === 'zones';
    const snapshot = await db.collection(zones ? 'geofences' : 'medicationReminders')
      .where('imei', '==', imei).limit(51).get();
    const rows = snapshot.docs.map(doc => doc.data()).filter(row => row.imei === imei &&
      (zones ? row.active === true : row.enabled !== false)).slice(0, 50);
    const lines = zones
      ? rows.map(row => `• ${clip(row.name || 'Unnamed safe zone', 80)}${Number.isFinite(row.radiusMeters) ? ` · ${row.radiusMeters} m radius` : ''}`)
      : rows.map(row => `• ${clip(row.text || 'Medication reminder', 100)} · ${clip(row.time || 'time unavailable', 20)} · ${
        ({ 1: 'once', 2: 'daily', 3: 'selected days' })[row.frequency] || 'schedule in app'} · ${
        ['delivered', 'read'].includes(row.deliveryStatus) ? 'WhatsApp delivery recorded' : 'WhatsApp delivery not confirmed'}`);
    const heading = zones ? 'Saved active safe zones' : 'Saved enabled medication reminders';
    return `${heading} for ${name}:\n${lines.length ? lines.join('\n') : 'None found in the checked records.'}\n\n` +
      (zones ? 'These are saved boundaries; they do not confirm the wearer is currently inside. Open the app to edit them.'
        : 'Times are shown as saved. A reminder does not confirm medication was taken. Open the app to edit reminders.') +
      (snapshot.docs.length >= 51 ? '\nShowing a limited set. See the full list in the app.' : '');
  }
  if (action === 'reminder_help') {
    return `To create a reminder, type the wearer’s name, medicine, time and frequency. For example: “Remind ${name} to take my medicine at 20:00 every day.” Guardian will ask you to confirm before saving.`;
  }
  throw new Error('Unknown menu action');
}

class WhatsAppMenu {
  constructor({ now = () => Date.now(), ttlMs = TTL_MS, maxTokens = 10000,
    flags = config, readAnswer = readMenuAnswer } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxTokens = maxTokens;
    this.flags = flags;
    this.readAnswer = readAnswer;
    this.tokens = new Map();
  }

  prune() {
    for (const [id, token] of this.tokens) {
      if (token.expiresAt <= this.now()) this.tokens.delete(id);
    }
    while (this.tokens.size >= this.maxTokens) this.tokens.delete(this.tokens.keys().next().value);
  }

  token(ctx, selection) {
    this.prune();
    const id = `gm_${randomBytes(16).toString('hex')}`;
    this.tokens.set(id, { ...selection, uid: ctx.uid, from: ctx.from, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  devices(ctx) {
    return (ctx.devices || []).filter(device => (ctx.linkedImeis || []).includes(device.imei));
  }

  picker(ctx, page = 0, notice = '') {
    const devices = this.devices(ctx);
    if (!devices.length) return { reply: 'No linked watches are available. Add or share a watch in the Guardian app.' };
    if (devices.length === 1) return this.menu(ctx, devices[0], notice);
    const start = Math.max(0, Math.min(page * 8, Math.floor((devices.length - 1) / 8) * 8));
    const rows = devices.slice(start, start + 8).map((device, i) => ({
      id: this.token(ctx, { action: 'menu', imei: device.imei }),
      title: clip(deviceLabel(device), 24),
      description: `Watch ${start + i + 1} · ending ${String(device.imei).slice(-4)}`,
    }));
    if (start > 0) rows.push({ id: this.token(ctx, { action: 'wearers', page: start / 8 - 1 }), title: 'Previous wearers' });
    if (start + 8 < devices.length) rows.push({ id: this.token(ctx, { action: 'wearers', page: start / 8 + 1 }), title: 'More wearers' });
    const reply = `${notice ? notice + '\n\n' : ''}Who would you like to check? Choose a wearer below. You can also type a question with their name.`;
    return { reply, interactive: { type: 'list', body: { text: reply },
      action: { button: 'Choose wearer', sections: [{ title: 'Your wearers', rows }] } } };
  }

  menu(ctx, device, notice = '') {
    const sections = [];
    for (const [key, title, description, sectionTitle] of availableOptions(ctx, this.flags)) {
      let section = sections.find(item => item.title === sectionTitle);
      if (!section) { section = { title: sectionTitle, rows: [] }; sections.push(section); }
      section.rows.push({ id: this.token(ctx, { action: key, imei: device.imei }), title, description });
    }
    const reply = `${notice ? notice + '\n\n' : ''}Hi, I’m Guardian. What would you like to check for ${clip(deviceLabel(device), 80)}?\n\nChoose an option below, or type your question.${this.devices(ctx).length > 1 ? '\nType “switch wearer” to choose someone else.' : ''}`;
    return { reply, menuWearerImei: device.imei, interactive: { type: 'list', body: { text: reply },
      action: { button: 'Choose an option', sections } } };
  }

  answer(ctx, device, action, reply, page = 0) {
    const pages = pagesOf(reply);
    const index = Math.min(Math.max(page, 0), pages.length - 1);
    const body = pages[index] + (pages.length > 1 ? `\n\nPart ${index + 1} of ${pages.length}` : '');
    const choices = [];
    const available = new Set(availableOptions(ctx, this.flags).map(row => row[0]));
    if (index + 1 < pages.length) choices.push(['More', action, { page: index + 1 }]);
    else if (action === 'reminders') choices.push(['Add reminder', 'reminder_help']);
    else {
      const related = ({ location: ['Watch status', 'status'], status: ['Location', 'location'],
        weather: ['Location', 'location'], activity: ['Journeys', 'journeys'],
        journeys: ['Location', 'location'], wellbeing: ['Steps & activity', 'activity'],
        alerts: ['Location', 'location'], zones: ['Location', 'location'],
        summary: ['Recent alerts', 'alerts'] })[action];
      if (related && available.has(related[1])) choices.push(related);
    }
    if (this.devices(ctx).length > 1) choices.push(['Change wearer', 'wearers']);
    else if (pages.length === 1 && action === 'location' && available.has('weather')) {
      choices.push(['Weather nearby', 'weather']);
    }
    choices.push(['Main menu', 'menu']);
    return { reply: body, menuWearerImei: device.imei, interactive: {
      type: 'button', body: { text: body }, action: { buttons: choices.map(([title, next, extra]) => ({
        type: 'reply', reply: { title, id: this.token(ctx, { action: next, imei: device.imei, ...extra }) },
      })) },
    } };
  }

  async handle({ db, ctx, text = '', interaction, contextService }) {
    const opening = MENU_OPEN.test(text.trim());
    const switching = SWITCH_WEARER.test(text.trim());
    if (!interaction && !opening && !switching) return null;
    if (!ctx.uid) return { reply: restrictedCallerReply(ctx), accessRestricted: true };
    if (!hasEntitlement(ctx.entitlements, FEATURE.WHATSAPP_QA)) {
      return { reply: planBoundaryReply(ctx.entitlements, FEATURE.WHATSAPP_QA), planRestricted: true };
    }
    this.prune();
    if (!interaction) return this.picker(ctx);
    const selection = ['button_reply', 'list_reply'].includes(interaction.type)
      ? this.tokens.get(interaction.id) : null;
    if (!selection || selection.uid !== ctx.uid || selection.from !== ctx.from) {
      return this.picker(ctx, 0, 'That menu has expired or is unavailable. Please choose again.');
    }
    if (selection.action === 'wearers') return this.picker(ctx, selection.page);
    const device = this.devices(ctx).find(item => item.imei === selection.imei);
    if (!device) return this.picker(ctx, 0, 'That watch is no longer available to this account.');
    if (selection.action === 'menu') return this.menu(ctx, device);
    const featureKey = selection.action === 'reminder_help' ? 'reminders' : selection.action;
    if (!availableOptions(ctx, this.flags).some(row => row[0] === featureKey)) {
      return this.menu(ctx, device, 'That option is not currently available for your account.');
    }
    let reply;
    try {
      reply = await this.readAnswer({ db, ctx, device, action: selection.action, contextService });
    } catch {
      reply = 'I could not retrieve that information right now. Please try again in a moment.';
    }
    return this.answer(ctx, device, selection.action, reply, selection.page);
  }
}

module.exports = { WhatsAppMenu, availableOptions, readMenuAnswer, pagesOf, TTL_MS };
