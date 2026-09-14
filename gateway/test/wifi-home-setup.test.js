'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const { spawnSync } = require('node:child_process');
const { buildObserverEnv, enableDisplayPilot, removeManagedBlock, writeObserverEnv } = require('../scripts/setup-wifi-home-observer');
const { fingerprintRouter } = require('../src/wifi-home-observer');

const input = { imei: '359633100123456', routerId: '02:00:00:00:00:01', hashKey: 'ab'.repeat(32) };

test('private setup preserves existing settings and stores a scoped fingerprint, never the router ID', () => {
  const original = '# Private gateway config\r\nMETA_WHATSAPP_ACCESS_TOKEN=fixture-token\r\nNOTE="first\nsecond"\r\n';
  const updated = buildObserverEnv(original, input);
  assert.ok(updated.startsWith(original));
  assert.ok(!updated.includes(input.routerId));
  const settings = dotenv.parse(updated);
  assert.equal(settings.META_WHATSAPP_ACCESS_TOKEN, 'fixture-token');
  assert.equal(settings.NOTE, 'first\nsecond');
  assert.equal(settings.WIFI_HOME_OBSERVE_ENABLED, 'true');
  assert.equal(settings.WIFI_HOME_DISPLAY_PILOT_ENABLED, 'false');
  assert.equal(settings.WIFI_HOME_ROUTER_HASH, fingerprintRouter(input));
  assert.equal(settings.WIFI_HOME_HASH_KEY, input.hashKey);
  assert.ok(!Object.keys(settings).some(key => /CUSTOMER|WIFIFENCE/.test(key)));
});

test('re-enrollment replaces its own block and removal restores the prior environment', () => {
  const original = 'NOTIFY_WHATSAPP=true\n';
  const first = buildObserverEnv(original, input);
  const replacement = { ...input, routerId: '02:00:00:00:00:02', hashKey: 'cd'.repeat(32) };
  const second = buildObserverEnv(first, replacement);
  assert.equal(second.split('WIFI_HOME_OBSERVE_ENABLED=').length - 1, 1);
  assert.ok(!second.includes(input.hashKey));
  assert.ok(!second.includes(fingerprintRouter(input)));
  assert.equal(dotenv.parse(second).WIFI_HOME_ROUTER_HASH, fingerprintRouter(replacement));
  assert.equal(buildObserverEnv(second, { disable: true }), original);
  assert.equal(removeManagedBlock(original), original);
});

test('malformed or unmanaged settings are rejected instead of silently shadowed', () => {
  for (const text of [
    '# BEGIN GUARDIAN WIFI HOME OBSERVER\n',
    '# END GUARDIAN WIFI HOME OBSERVER\n# BEGIN GUARDIAN WIFI HOME OBSERVER\n',
    '# BEGIN GUARDIAN WIFI HOME OBSERVER extra\n# END GUARDIAN WIFI HOME OBSERVER\n',
    '# BEGIN GUARDIAN WIFI HOME OBSERVER\nother # END GUARDIAN WIFI HOME OBSERVER\n',
    'WIFI_HOME_OBSERVE_ENABLED=true\n',
    'export WIFI_HOME_HASH_KEY="private-existing-value"\n',
  ]) assert.throws(() => buildObserverEnv(text, input), /configuration block|outside the managed block/);
  assert.throws(() => buildObserverEnv('', { ...input, routerId: 'Home' }), /Paste only the complete BSSID/);
  assert.throws(() => buildObserverEnv('', { ...input, imei: '123' }), /Pilot watch IMEI/);
  assert.throws(() => buildObserverEnv('', { ...input, hashKey: 'invalid-key' }), /Wi-Fi fingerprint key/);
});

test('setup writes atomically and rejects an environment changed during the prompt', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-wifi-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envPath = path.join(dir, '.env');
  const original = 'NOTIFY_WHATSAPP=true\n';
  fs.writeFileSync(envPath, original);
  const updated = buildObserverEnv(original, input);
  writeObserverEnv(envPath, updated, original);
  assert.equal(fs.readFileSync(envPath, 'utf8'), updated);
  assert.deepEqual(fs.readdirSync(dir), ['.env']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
  assert.throws(() => writeObserverEnv(envPath, original, original), /changed during setup/);
  assert.equal(fs.readFileSync(envPath, 'utf8'), updated);
});

function setupCliFixture(t, original = `META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI=${input.imei}\nMETA_WHATSAPP_ACCESS_TOKEN=fixture-token\n`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-wifi-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(__dirname, '../scripts/setup-wifi-home-observer.js'), path.join(dir, 'scripts/setup.js'));
  fs.copyFileSync(path.join(__dirname, '../src/wifi-home-observer.js'), path.join(dir, 'src/wifi-home-observer.js'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, original);
  const env = { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') };
  for (const key of Object.keys(env)) if (key.startsWith('WIFI_HOME_')) delete env[key];
  return {
    envPath, original,
    run: (privateInput, args = []) => spawnSync(process.execPath, [path.join(dir, 'scripts/setup.js'), ...args], {
      env, input: privateInput, encoding: 'utf8', timeout: 5000,
    }),
  };
}

test('display opt-in reuses private enrollment and disable/re-enrollment removes activation', t => {
  const original = 'META_WHATSAPP_ACCESS_TOKEN=fixture-token\n';
  const enrollment = buildObserverEnv(original, input);
  const enabled = enableDisplayPilot(enrollment);
  const before = dotenv.parse(enrollment);
  const after = dotenv.parse(enabled);
  assert.deepEqual(after, { ...before, WIFI_HOME_DISPLAY_PILOT_ENABLED: 'true' });
  assert.equal(enableDisplayPilot(enabled), enabled);
  assert.equal(buildObserverEnv(enabled, { disable: true }), original);
  assert.equal(dotenv.parse(buildObserverEnv(enabled, input)).WIFI_HOME_DISPLAY_PILOT_ENABLED, 'false');
  assert.throws(() => enableDisplayPilot(original));
  assert.throws(() => enableDisplayPilot(enrollment.replace(input.hashKey, 'bad-key')));
  const fixture = setupCliFixture(t, enrollment);
  const result = fixture.run('', ['--display-pilot']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(dotenv.parse(fs.readFileSync(fixture.envPath, 'utf8')), after);
  assert.match(result.stdout, /Home display pilot enabled/);
  for (const secret of [input.imei, input.routerId, input.hashKey, before.WIFI_HOME_ROUTER_HASH]) {
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
});

test('the actual setup CLI reuses the pilot, saves privately and prints no identifiers or keys', t => {
  const fixture = setupCliFixture(t);
  const result = fixture.run(input.routerId + '\n');
  assert.equal(result.status, 0, result.stderr);
  const saved = dotenv.parse(fs.readFileSync(fixture.envPath, 'utf8'));
  assert.equal(saved.META_WHATSAPP_ACCESS_TOKEN, 'fixture-token');
  assert.equal(saved.WIFI_HOME_OBSERVE_ENABLED, 'true');
  assert.equal(saved.WIFI_HOME_ROUTER_HASH, fingerprintRouter({
    imei: input.imei, routerId: input.routerId, hashKey: saved.WIFI_HOME_HASH_KEY,
  }));
  for (const secret of [input.imei, input.routerId, saved.WIFI_HOME_HASH_KEY, saved.WIFI_HOME_ROUTER_HASH, 'fixture-token']) {
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
});

test('blank or labelled router input gets a private retry and accepts a complete locally administered BSSID', t => {
  const fixture = setupCliFixture(t);
  const routerId = '82:10:20:30:40:5a'; // Synthetic unicast radio, not a real Home identifier.
  const badPaste = `BSSID 1 : ${routerId}`;
  const acceptedPaste = routerId.toUpperCase().replace(/:/g, '-');
  const result = fixture.run(`\r\n${badPaste}\r\n  ${acceptedPaste}  \r\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No router identifier was received/);
  assert.match(result.stdout, /Paste only the complete BSSID/);
  const saved = dotenv.parse(fs.readFileSync(fixture.envPath, 'utf8'));
  assert.equal(saved.WIFI_HOME_ROUTER_HASH, fingerprintRouter({
    imei: input.imei, routerId, hashKey: saved.WIFI_HOME_HASH_KEY,
  }));
  for (const secret of [input.imei, routerId, badPaste, acceptedPaste, saved.WIFI_HOME_HASH_KEY, saved.WIFI_HOME_ROUTER_HASH]) {
    assert.ok(!(result.stdout + result.stderr).toLowerCase().includes(secret.toLowerCase()));
  }
  assert.ok(fs.readFileSync(fixture.envPath, 'utf8').startsWith(fixture.original));
});

test('ending private input after an invalid router leaves the environment unchanged and exits unsuccessfully', t => {
  const fixture = setupCliFixture(t);
  const result = fixture.run('\nnot-a-radio\n');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /No router identifier was received/);
  assert.match(result.stdout, /Paste only the complete BSSID/);
  assert.match(result.stderr, /Setup cancelled; gateway settings were not changed/);
  assert.ok(!(result.stdout + result.stderr).includes('not-a-radio'));
  assert.equal(fs.readFileSync(fixture.envPath, 'utf8'), fixture.original);
});

test('setup can read and retry both private fields when no existing pilot is configured', t => {
  const fixture = setupCliFixture(t, 'META_WHATSAPP_ACCESS_TOKEN=fixture-token\n');
  const result = fixture.run(`\n${input.imei}\n${input.routerId}\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Pilot watch IMEI must contain exactly 15 digits/);
  const saved = dotenv.parse(fs.readFileSync(fixture.envPath, 'utf8'));
  assert.equal(saved.WIFI_HOME_PILOT_IMEI, input.imei);
  assert.ok(!(result.stdout + result.stderr).includes(input.imei));
  assert.ok(!(result.stdout + result.stderr).includes(input.routerId));
});
