'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const dotenv = require('dotenv');
const { fingerprintRouter } = require('../src/wifi-home-observer');

const START = '# BEGIN GUARDIAN WIFI HOME OBSERVER';
const END = '# END GUARDIAN WIFI HOME OBSERVER';
const KEYS = ['WIFI_HOME_OBSERVE_ENABLED', 'WIFI_HOME_PILOT_IMEI',
  'WIFI_HOME_ROUTER_HASH', 'WIFI_HOME_HASH_KEY'];

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
  const key = hashKey || crypto.randomBytes(32).toString('hex');
  const routerHash = fingerprintRouter({ imei, routerId, hashKey: key });
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const prefix = remaining && !remaining.endsWith('\n') ? remaining + newline : remaining;
  return prefix + [START, 'WIFI_HOME_OBSERVE_ENABLED=true',
    `WIFI_HOME_PILOT_IMEI=${imei}`, `WIFI_HOME_ROUTER_HASH=${routerHash}`,
    `WIFI_HOME_HASH_KEY=${key}`, END, ''].join(newline);
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
  if (process.argv.slice(2).some(arg => arg !== '--disable')) {
    throw new Error('Use this interactive setup without identifier arguments, or pass --disable.');
  }
  if (process.argv.includes('--disable')) {
    writeObserverEnv(envPath, buildObserverEnv(original, { disable: true }), original);
    console.log('Wi-Fi observer configuration removed. Restart the gateway to stop observation.');
    return;
  }
  const settings = dotenv.parse(original);
  let imei = settings.WIFI_HOME_PILOT_IMEI || settings.META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI || '';
  let hideInput = false;
  const privateOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!hideInput) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const input = readline.createInterface({ input: process.stdin, output: privateOutput,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
  async function askPrivate(prompt) {
    process.stdout.write(prompt);
    hideInput = true;
    try { return await input.question(''); }
    finally { hideInput = false; process.stdout.write('\n'); }
  }
  let routerId;
  try {
    console.log('Private, read-only router observation. This does not enable the Home map or send watch commands.');
    if (!/^\d{15}$/.test(imei)) imei = (await askPrivate('Pilot watch IMEI (input hidden): ')).trim();
    else console.log('Using the existing pilot watch configuration.');
    routerId = await askPrivate('Your Home router\'s 2.4 GHz Wi-Fi BSSID / radio MAC (input hidden): ');
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

module.exports = { buildObserverEnv, removeManagedBlock, writeObserverEnv };
