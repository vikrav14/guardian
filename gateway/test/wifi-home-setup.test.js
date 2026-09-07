'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const { spawnSync } = require('node:child_process');
const { buildObserverEnv, removeManagedBlock, writeObserverEnv } = require('../scripts/setup-wifi-home-observer');
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
  assert.throws(() => buildObserverEnv('', { ...input, routerId: 'Home' }), /Valid pilot/);
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

test('the actual setup CLI reuses the pilot, saves privately and prints no identifiers or keys', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-wifi-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(__dirname, '../scripts/setup-wifi-home-observer.js'), path.join(dir, 'scripts/setup.js'));
  fs.copyFileSync(path.join(__dirname, '../src/wifi-home-observer.js'), path.join(dir, 'src/wifi-home-observer.js'));
  fs.writeFileSync(path.join(dir, '.env'), `META_WHATSAPP_SOS_CALLBACK_PILOT_IMEI=${input.imei}\nMETA_WHATSAPP_ACCESS_TOKEN=fixture-token\n`);
  const env = { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') };
  for (const key of Object.keys(env)) if (key.startsWith('WIFI_HOME_')) delete env[key];
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/setup.js')], {
    env, input: input.routerId + '\n', encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const saved = dotenv.parse(fs.readFileSync(path.join(dir, '.env')));
  assert.equal(saved.META_WHATSAPP_ACCESS_TOKEN, 'fixture-token');
  assert.equal(saved.WIFI_HOME_OBSERVE_ENABLED, 'true');
  assert.equal(saved.WIFI_HOME_ROUTER_HASH, fingerprintRouter({
    imei: input.imei, routerId: input.routerId, hashKey: saved.WIFI_HOME_HASH_KEY,
  }));
  for (const secret of [input.imei, input.routerId, saved.WIFI_HOME_HASH_KEY, saved.WIFI_HOME_ROUTER_HASH, 'fixture-token']) {
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
});
