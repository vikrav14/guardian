'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const dotenv = require('dotenv');
const { fingerprintRouter, normalizeRouterId } = require('../src/wifi-home-observer');

const START = '# BEGIN GUARDIAN WIFI HOME OBSERVER';
const END = '# END GUARDIAN WIFI HOME OBSERVER';
const KEYS = ['WIFI_HOME_OBSERVE_ENABLED', 'WIFI_HOME_PILOT_IMEI',
  'WIFI_HOME_ROUTER_HASH', 'WIFI_HOME_HASH_KEY', 'WIFI_HOME_DISPLAY_PILOT_ENABLED'];
const IMEI_ERROR = 'Pilot watch IMEI must contain exactly 15 digits. Please try again.';

function routerInputError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'No router identifier was received. Paste the complete BSSID, then press Enter.';
  if (!normalizeRouterId(value)) {
    return 'Paste only the complete BSSID: six pairs of hexadecimal characters separated by colons or hyphens. Leave out the BSSID label and quotation marks; use a valid unicast radio address.';
  }
  return null;
}

function removeManagedBlock(text) {
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts !== ends || starts > 1) throw new Error('Wi-Fi observer configuration block is invalid.');
  if (!starts) return text;
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (end < start || (start > 0 && text[start - 1] !== '\n') ||
      (end > 0 && text[end - 1] !== '\n') ||
      !/^(\r?\n|$)/.test(text.slice(start + START.length)) ||
      !/^(\r?\n|$)/.test(text.slice(end + END.length))) {
    throw new Error('Wi-Fi observer configuration block is invalid.');
  }
  const tail = text.slice(end + END.length).replace(/^\r?\n/, '');
  return text.slice(0, start) + tail;
}

function buildObserverEnv(text, { imei, routerId, hashKey, disable = false } = {}) {
  const remaining = removeManagedBlock(text);
  const existing = dotenv.parse(remaining);
  if (KEYS.some(key => Object.hasOwn(existing, key))) {
    throw new Error('Existing WIFI_HOME settings are outside the managed block; reconcile them privately first.');
  }
  if (disable) return remaining;
  if (!/^\d{15}$/.test(imei || '')) throw new Error(IMEI_ERROR);
  const routerError = routerInputError(routerId);
  if (routerError) throw new Error(routerError);
  const key = hashKey || crypto.randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Wi-Fi fingerprint key must contain exactly 64 hexadecimal characters.');
  const routerHash = fingerprintRouter({ imei, routerId, hashKey: key });
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const prefix = remaining && !remaining.endsWith('\n') ? remaining + newline : remaining;
  return prefix + [START, 'WIFI_HOME_OBSERVE_ENABLED=true',
    `WIFI_HOME_PILOT_IMEI=${imei}`, `WIFI_HOME_ROUTER_HASH=${routerHash}`,
    `WIFI_HOME_HASH_KEY=${key}`, 'WIFI_HOME_DISPLAY_PILOT_ENABLED=false', END, ''].join(newline);
}

function enableDisplayPilot(text) {
  const remaining = removeManagedBlock(text);
  const settings = dotenv.parse(text);
  if (remaining === text || KEYS.some(key => Object.hasOwn(dotenv.parse(remaining), key)) ||
      settings.WIFI_HOME_OBSERVE_ENABLED !== 'true' ||
      !/^\d{15}$/.test(settings.WIFI_HOME_PILOT_IMEI || '') ||
      !/^[0-9a-f]{64}$/i.test(settings.WIFI_HOME_ROUTER_HASH || '') ||
      !/^[0-9a-f]{64}$/i.test(settings.WIFI_HOME_HASH_KEY || '')) {
    throw new Error('Complete private router setup before enabling its Home display pilot.');
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  const block = text.slice(start, end).replace(/^WIFI_HOME_DISPLAY_PILOT_ENABLED=.*\r?\n/gm, '');
  return text.slice(0, start) + block + 'WIFI_HOME_DISPLAY_PILOT_ENABLED=true' + newline + text.slice(end);
}

function writeObserverEnv(envPath, text, expectedOriginal) {
  if (fs.lstatSync(envPath).isSymbolicLink()) throw new Error('Use a regular private environment file.');
  if (fs.readFileSync(envPath, 'utf8') !== expectedOriginal) {
    throw new Error('Environment file changed during setup; retry without overwriting it.');
  }
  // This sibling is covered by the repository's .env.* ignore rule. Never put
  // the private environment in a tracked backup or print it to the terminal.
  const temporary = `${envPath}.wifi-home-${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    if (fs.readFileSync(envPath, 'utf8') !== expectedOriginal) {
      throw new Error('Environment file changed during setup; retry without overwriting it.');
    }
    fs.renameSync(temporary, envPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) throw new Error('Configure the gateway private .env file first.');
  if (KEYS.some(key => Object.hasOwn(process.env, key))) {
    throw new Error('Shell WIFI_HOME overrides are present; reconcile them privately before using file setup.');
  }
  const original = fs.readFileSync(envPath, 'utf8');
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--disable', '--display-pilot'].includes(arg))) {
    throw new Error('Use interactive setup without identifier arguments, --disable, or --display-pilot.');
  }
  if (process.argv.includes('--disable')) {
    writeObserverEnv(envPath, buildObserverEnv(original, { disable: true }), original);
    console.log('Wi-Fi observer configuration removed. Restart the gateway to stop observation.');
    return;
  }
  if (args.includes('--display-pilot')) {
    writeObserverEnv(envPath, enableDisplayPilot(original), original);
    console.log('Home display pilot enabled for the configured watch. Restart the gateway and Flutter app.');
    console.log('The pilot uses one active Home safe-zone pin owned by a linked Family/Care service owner.');
    console.log('It displays fresh Home Wi-Fi evidence with expiry; GPS, journeys and SOS remain separate.');
    return;
  }
  const settings = dotenv.parse(original);
  let imei = settings.WIFI_HOME_PILOT_IMEI || settings.META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI || '';
  // Never echo private typing or a buffered paste, including between retries.
  const privateOutput = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  const input = readline.createInterface({ input: process.stdin, output: privateOutput,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    historySize: 0, crlfDelay: Infinity });
  // Register before reading so pasted lines are not lost between questions.
  const lines = input[Symbol.asyncIterator]();
  input.once('SIGINT', () => input.close());
  async function askPrivate(prompt, validate) {
    while (true) {
      process.stdout.write(prompt);
      let value;
      try {
        const line = await lines.next();
        if (line.done) throw new Error('Setup cancelled; gateway settings were not changed.');
        value = line.value.trim();
      } finally { process.stdout.write('\n'); }
      const error = validate(value);
      if (!error) return value;
      console.log(error);
    }
  }
  let routerId;
  try {
    console.log('Private, read-only router observation. This does not enable the Home map or send watch commands.');
    if (!/^\d{15}$/.test(imei)) imei = await askPrivate('Pilot watch IMEI (input hidden): ',
      value => /^\d{15}$/.test(value) ? null : IMEI_ERROR);
    else console.log('Using the existing pilot watch configuration.');
    routerId = await askPrivate('Your Home router\'s 2.4 GHz Wi-Fi BSSID / radio MAC (input hidden): ', routerInputError);
  } finally {
    input.close();
  }
  const updated = buildObserverEnv(original, { imei, routerId });
  writeObserverEnv(envPath, updated, original);
  console.log('Private observer configured. Router ID stored only as a keyed, watch-scoped fingerprint.');
  console.log('Restart the gateway, leave the watch near that router, and share only the [wifi-home] diagnostic lines.');
  console.log('Customer Home display stays disabled. No Wi-Fi password was requested.');
}

if (require.main === module) {
  main().catch(error => {
    // All deliberate validation errors are static; filesystem errors can
    // contain private paths, so report a fixed message for those failures.
    console.error(error.code ? 'Private Wi-Fi setup could not update the environment file.' : error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildObserverEnv, enableDisplayPilot, removeManagedBlock, writeObserverEnv };
