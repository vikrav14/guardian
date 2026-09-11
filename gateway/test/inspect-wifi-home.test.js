'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { inspectWifiHome } = require('../scripts/inspect-wifi-home');
const start = Date.parse('2026-09-01T12:00:00Z');

function status() {
  return { version: 1, observerEnabled: true, displayEnabled: true, pilotConfigured: true,
    sessionConnected: true, observer: { matchState: 'candidate', consecutiveMatches: 2 },
    publisher: { active: true, phase: 'idle', homeBindingReady: true,
      bindingReason: 'ready', operationSlow: false, homeEvidenceEligible: false,
      publishedHomeFresh: false, lastHomePublication: null, lastClearedAt: null } };
}

test('default inspection is read-only and preserves evidence of an expired publication', async () => {
  const value = status();
  value.observer.reason = 'repeated_router_observations';
  value.publisher.selectionReason = 'gps_outside_home';
  value.publisher.lastClearedReason = 'gps_outside_home';
  value.publisher.lastHomePublication = { confirmedAt: new Date(start).toISOString(),
    observedAt: new Date(start).toISOString(), expiresAt: new Date(start + 60_000).toISOString() };
  const output = [];
  const result = await inspectWifiHome({
    readStatus: async () => value,
    requestLocation: () => assert.fail('read-only inspection must not request CR'),
    sleep: () => assert.fail('read-only inspection must return immediately'),
    emit: item => output.push(item),
  });
  assert.equal(result.outcome, 'read_only');
  assert.equal(output[0].publishedHomeFresh, false);
  assert.equal(output[0].matchReason, 'repeated_router_observations');
  assert.equal(output[0].selectionReason, 'gps_outside_home');
  assert.equal(output[0].lastClearedReason, 'gps_outside_home');
  assert.deepEqual(output[0].lastHomePublication, value.publisher.lastHomePublication);
});

test('one requested CR waits for published Home, not a candidate or socket handoff', async () => {
  let clock = start; let requests = 0;
  const result = await inspectWifiHome({ requestFresh: true, now: () => clock,
    sleep: async ms => { clock += ms; }, emit: () => {},
    requestLocation: async () => { requests++; return { ok: true }; },
    readStatus: async () => {
      const value = status();
      if (clock >= start + 30_000) {
        value.observer = { matchState: 'matched', consecutiveMatches: 3 };
        value.publisher.homeEvidenceEligible = true;
      }
      if (clock >= start + 35_000) value.publisher.publishedHomeFresh = true;
      return value;
    },
  });
  assert.equal(result.outcome, 'home_ready');
  assert.equal(clock, start + 35_000);
  assert.equal(requests, 1);
});

test('a published conflict is reported without claiming Home or requesting another CR', async () => {
  const value = status();
  value.publisher.wifiConflictEligible = true;
  value.publisher.publishedConflictFresh = true;
  value.publisher.selectionReason = 'gps_outside_home';
  const result = await inspectWifiHome({ requestFresh: true,
    readStatus: async () => value, emit: () => {},
    requestLocation: () => assert.fail('a published conflict needs no extra command'),
  });
  assert.equal(result.outcome, 'home_gps_conflict');
});

test('a candidate-only stream stops at two minutes without retrying the command', async () => {
  let clock = start; let requests = 0;
  const result = await inspectWifiHome({ requestFresh: true, now: () => clock,
    readStatus: async () => status(), emit: () => {}, sleep: async ms => { clock += ms; },
    requestLocation: async () => { requests++; return { ok: true }; },
  });
  assert.equal(result.outcome, 'publication_not_confirmed');
  assert.equal(clock, start + 120_000);
  assert.equal(requests, 1);
});

test('inactive, unbound, disconnected and stalled publishers do not trigger a command', async () => {
  for (const edit of [
    s => { s.displayEnabled = false; },
    s => { s.pilotConfigured = false; },
    s => { s.publisher.active = false; },
    s => { s.publisher.homeBindingReady = false; s.publisher.bindingReason = 'home_family_plan_required'; },
    s => { s.sessionConnected = false; },
    s => { s.publisher.phase = 'home_binding_read'; s.publisher.operationSlow = true; },
  ]) {
    const value = status(); edit(value);
    const result = await inspectWifiHome({ requestFresh: true, readStatus: async () => value,
      emit: () => {}, requestLocation: () => assert.fail('blocked preflight sent CR'),
    });
    assert.notEqual(result.outcome, 'home_ready');
  }
});

test('a lost request response is not retried', async () => {
  let requests = 0;
  await assert.rejects(inspectWifiHome({ requestFresh: true, readStatus: async () => status(),
    emit: () => {}, requestLocation: async () => { requests++; throw new Error('Synthetic timeout'); },
  }), /Synthetic timeout/);
  assert.equal(requests, 1);
});

test('a publication that expired between polls is recorded without claiming a current Home pin', async () => {
  let clock = start;
  const result = await inspectWifiHome({ requestFresh: true, now: () => clock,
    sleep: async ms => { clock += ms; }, emit: () => {}, requestLocation: async () => ({ ok: true }),
    readStatus: async () => {
      const value = status();
      if (clock > start) value.publisher.lastHomePublication = {
        confirmedAt: new Date(start + 1000).toISOString(),
        observedAt: new Date(start - 117_000).toISOString(),
        expiresAt: new Date(start + 3000).toISOString(),
      };
      return value;
    },
  });
  assert.equal(result.outcome, 'home_published_then_unavailable');
});

test('CLI uses authenticated loopback, sends one CR, and keeps identifiers and frames out of output', async t => {
  const imei = '359633100123456'; const key = 'synthetic-admin-key';
  let crs = 0; const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, key: req.headers['x-admin-key'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      crs++;
      res.end(JSON.stringify({ ok: true, imei, frame: 'PRIVATE-CR-FRAME' }));
    } else {
      const value = status();
      if (crs) { value.publisher.publishedHomeFresh = true; value.publisher.homeEvidenceEligible = true; }
      res.end(JSON.stringify(value));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const child = spawn(process.execPath, ['scripts/inspect-wifi-home.js', '--request-location'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, ADMIN_API_KEY: key,
      WIFI_HOME_PILOT_IMEI: imei, HTTP_PORT: String(server.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let output = ''; child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, output);
  assert.equal(crs, 1);
  assert.match(output, /home_ready/);
  assert.ok(calls.every(call => call.key === key));
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.url),
    [`/dev/send-cr?imei=${imei}`]);
  assert.ok(calls.filter(call => call.method === 'GET').every(call => call.url === `/ops/wifi-home?imei=${imei}`));
  for (const secret of [imei, key, 'PRIVATE-CR-FRAME']) assert.ok(!output.includes(secret));
});
