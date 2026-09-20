'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHomeWifiWalkBuffer } = require('../src/home-wifi-walk-buffer');

function runtime(settings = {}, publisherAvailable = true) {
  const epoch = Date.parse('2026-09-14T08:00:00Z');
  let clock = epoch, buffers = 0, starts = 0, stopped = 0;
  const config = { wifiHomeObserveEnabled: true, wifiHomeDisplayPilotEnabled: true,
    wifiHomePilotImei: 'synthetic-watch', ...settings };
  const anchor = { lat: -20.25, lng: 57.5, radiusMeters: 50 };
  const context = () => ({ ready: true, key: 'synthetic-binding', anchor,
    home: clock < epoch + 120000 ? { observedAt: new Date(epoch).toISOString() } : null,
    observation: { observedAt: new Date(epoch).toISOString(), reason: 'observation_expired' } });
  const timers = [];
  const sandbox = { module: { exports: {} }, console: { log() {} },
    setInterval(tick) { const timer = { tick, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearInterval(timer) { timer.cleared = true; },
    require(name) {
      if (name === './config') return config;
      if (name === './wifi-home-observer') return {};
      if (name === './sessions') return { findSocketsForDevice: () => [] };
      if (name === './wifi-home-display') return { startHomeWifiPublisher() {
        starts++;
        if (!publisherAvailable) return null;
        const stop = () => { stopped++; };
        stop.getStatus = () => ({ active: true, publishedHomeFresh: !!context().home });
        stop.getEvidence = () => context().home;
        stop.getTrackingContext = context;
        return stop;
      } };
      if (name === './home-wifi-walk-buffer') return { createHomeWifiWalkBuffer(options) {
        buffers++;
        return createHomeWifiWalkBuffer({ ...options, now: () => clock });
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/wifi-home-runtime.js'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  function observe(seconds, metres, imei = config.wifiHomePilotImei) {
    clock = epoch + seconds * 1000;
    const recordedAt = new Date(clock);
    api.observeHomeWifiWalk(imei, { lat: anchor.lat + metres / 111195, lng: anchor.lng,
      source: 'gps', gpsValid: true, satellites: 7, recordedAt }, recordedAt);
  }
  return { api, config, observe, timers, counts: () => ({ buffers, starts, stopped }),
    advance: seconds => { clock = epoch + seconds * 1000; },
    tick: async () => { for (const timer of timers) if (!timer.cleared) timer.tick();
      await new Promise(resolve => setImmediate(resolve)); } };
}

test('walk experiment defaults off even when the existing Home pilot is enabled', () => {
  for (const value of [undefined, '', 'false', '1', 'true']) {
    const env = { WIFI_HOME_OBSERVE_ENABLED: 'true', WIFI_HOME_DISPLAY_PILOT_ENABLED: 'true' };
    if (value !== undefined) env.WIFI_HOME_WALK_RECOVERY_EXPERIMENT_ENABLED = value;
    const sandbox = { module: { exports: {} }, process: { env }, __dirname,
      require: name => name === 'dotenv' ? { config() {} } : require(name) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8'), sandbox);
    assert.equal(sandbox.module.exports.wifiHomeDisplayPilotEnabled, true);
    assert.equal(sandbox.module.exports.wifiHomeWalkRecoveryExperimentEnabled, value === 'true');
  }
});

test('ordinary Home display cannot allocate, observe or recover experimental walks', async () => {
  for (const setting of [undefined, false]) {
    const run = runtime({ wifiHomeWalkRecoveryExperimentEnabled: setting });
    const stop = run.api.startWifiHomeDisplayPilot({}, { recoverWalk: () => assert.fail('recovery is disabled') });
    assert.equal(run.api.getWifiHomeRuntimeStatus().publisher.publishedHomeFresh, true);
    assert.ok(run.api.getHomeWifiPriority('synthetic-watch'));
    run.observe(68, 107); run.observe(113, 41); run.advance(121); await run.tick();
    assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryEnabled, false);
    assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryActive, false);
    assert.equal(run.counts().buffers, 0);
    assert.equal(run.timers.length, 0);
    stop(); assert.equal(run.counts().stopped, 1);
  }
});

test('explicit opt-in retains pilot scoping and stops recovery when restarted with the flag off', async () => {
  const run = runtime({ wifiHomeWalkRecoveryExperimentEnabled: true });
  const recovered = [];
  const recoverWalk = async points => { recovered.push(points); return { recovered: true }; };
  run.api.startWifiHomeDisplayPilot({}, { recoverWalk });
  assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryActive, true);
  run.observe(68, 107, 'other-watch'); run.observe(113, 41, 'other-watch');
  run.advance(121); await run.tick(); assert.equal(recovered.length, 0);
  run.observe(68, 107); run.observe(113, 41); run.advance(121); await run.tick();
  assert.equal(recovered.length, 1); assert.equal(recovered[0].length, 2);
  run.observe(68, 107); run.observe(113, 41);
  run.config.wifiHomeWalkRecoveryExperimentEnabled = false;
  const stop = run.api.startWifiHomeDisplayPilot({}, { recoverWalk });
  assert.equal(run.api.getWifiHomeRuntimeStatus().publisher.active, true);
  assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryActive, false);
  assert.equal(run.timers[0].cleared, true);
  run.advance(121); run.timers[0].tick(); await run.tick();
  assert.equal(recovered.length, 1, 'a stopped timer must not replay the old candidate');
  assert.equal(run.counts().buffers, 1, 'the restarted display must not create another buffer');
  stop(); assert.equal(run.counts().stopped, 2);
});

test('experiment opt-in cannot bypass observer, display, publisher or callback prerequisites', () => {
  for (const [settings, publisherAvailable, withCallback] of [
    [{ wifiHomeObserveEnabled: false }, true, true],
    [{ wifiHomeDisplayPilotEnabled: false }, true, true],
    [{}, false, true], [{}, true, false],
  ]) {
    const run = runtime({ wifiHomeWalkRecoveryExperimentEnabled: true, ...settings }, publisherAvailable);
    const stop = run.api.startWifiHomeDisplayPilot({}, withCallback ? { recoverWalk() {} } : {});
    assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryEnabled, true);
    assert.equal(run.api.getWifiHomeRuntimeStatus().walkRecoveryActive, false);
    assert.equal(run.counts().buffers, 0); assert.equal(run.timers.length, 0);
    stop?.();
  }
});
