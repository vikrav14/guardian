'use strict';

// Defaults to a read-only snapshot of the RUNNING gateway, not a fresh observer.
// --request-location uses the existing protected CR endpoint once, then watches
// publication for at most two minutes. No enrollment or reporting settings change.
function summary(status) {
  const p = status.publisher;
  return {
    displayEnabled: status.displayEnabled === true,
    publisherActive: p?.active === true,
    homeBindingReady: p?.homeBindingReady === true,
    bindingReason: p?.bindingReason || 'publisher_not_started',
    phase: p?.phase || 'not_started',
    pendingSeconds: p?.pendingSeconds ?? null,
    sessionConnected: status.sessionConnected === true,
    matchState: status.observer?.matchState || 'no_observation',
    matchReason: status.observer?.reason || 'no_observation',
    consecutiveMatches: status.observer?.consecutiveMatches || 0,
    observationAgeSeconds: status.observer?.lastMatchAgeSeconds ?? null,
    homeEvidenceEligible: p?.homeEvidenceEligible === true,
    selectionReason: p?.selectionReason || null,
    publishedHomeFresh: p?.publishedHomeFresh === true,
    lastHomePublication: p?.lastHomePublication || null,
    lastClearedAt: p?.lastClearedAt || null,
    lastClearedReason: p?.lastClearedReason || null,
  };
}

async function inspectWifiHome({ readStatus, requestLocation, requestFresh = false,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  emit = value => console.log(JSON.stringify(value, null, 2)) }) {
  const startedAt = now();
  const deadline = startedAt + 120_000;
  let sent = false;
  let previous;
  while (true) {
    if (previous && now() >= deadline) return { outcome: 'publication_not_confirmed' };
    const status = await readStatus();
    if (status?.version !== 1) throw new Error('unsupported_gateway');
    const safe = summary(status);
    const serialized = JSON.stringify(safe);
    if (serialized !== previous) { emit(safe); previous = serialized; }
    if (!requestFresh) return { outcome: 'read_only' };
    if (!status.observerEnabled || !status.displayEnabled || !status.pilotConfigured ||
        !status.publisher?.active) return { outcome: 'pilot_not_running' };
    if (status.publisher.operationSlow) return { outcome: 'publisher_io_pending' };
    if (safe.homeEvidenceEligible && safe.publishedHomeFresh) return { outcome: 'home_ready' };
    if (!status.sessionConnected) return { outcome: 'watch_not_connected' };
    if (now() >= deadline) return { outcome: 'publication_not_confirmed' };

    if (!sent) {
      if (safe.homeBindingReady) {
        // Exactly one handoff attempt. A timeout/unknown response is never an
        // excuse to send a second CR, or to claim the watch returned evidence.
        sent = true;
        const result = await requestLocation();
        if (result?.ok !== true) return { outcome: 'location_request_not_sent' };
        emit({ locationRequestSent: true });
      } else if (status.publisher.phase !== 'home_binding_read') {
        return { outcome: 'home_binding_unavailable' };
      }
    }

    // Keep proof of a successful publication even if its short lease expired
    // between polls. This proves publication, not a currently usable Home pin.
    const publication = status.publisher.lastHomePublication;
    if (sent && Date.parse(publication?.confirmedAt) >= startedAt) {
      return { outcome: 'home_published_then_unavailable' };
    }
    await sleep(Math.min(5000, Math.max(0, deadline - now())));
  }
}

async function main() {
  const config = require('../src/config');
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--request-location')) {
    throw new Error('invalid_arguments');
  }
  if (!config.adminApiKey || !/^\d{15}$/.test(config.wifiHomePilotImei || '') ||
      !Number.isInteger(config.httpPort) || config.httpPort < 1 || config.httpPort > 65535) {
    throw new Error('local_configuration_missing');
  }
  const base = `http://127.0.0.1:${config.httpPort}`;
  const pilot = encodeURIComponent(config.wifiHomePilotImei);
  const deadline = Date.now() + 120_000;
  async function request(path, method = 'GET') {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('check_timeout');
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'X-Admin-Key': config.adminApiKey }, redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(8000, remaining))),
    });
    // Never print arbitrary API error bodies, keys, URLs or returned CR frames.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 404 ? 'route_or_watch_unavailable' :
        response.status === 409 ? 'running_pilot_mismatch' : 'gateway_request_rejected');
    }
    return response.json();
  }
  const result = await inspectWifiHome({
    requestFresh: args.includes('--request-location'),
    readStatus: () => request(`/ops/wifi-home?imei=${pilot}`),
    requestLocation: () => request(`/dev/send-cr?imei=${pilot}`, 'POST'),
  });
  console.log(JSON.stringify(result));
  if (result.outcome === 'home_ready') {
    console.log('Home publication confirmed. Open the app and ask location? in WhatsApp now.');
  } else if (result.outcome === 'publisher_io_pending') {
    console.log('A gateway Home read/write has been pending for at least 15 seconds. Check its network connection and restart the gateway after connectivity returns.');
  } else if (result.outcome !== 'read_only') {
    console.log('Current Home display was not confirmed. Share this redacted output.');
  }
  if (!['home_ready', 'read_only'].includes(result.outcome)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    const known = new Set(['invalid_arguments', 'local_configuration_missing',
      'route_or_watch_unavailable', 'running_pilot_mismatch', 'gateway_request_rejected',
      'check_timeout', 'unsupported_gateway']);
    console.error(JSON.stringify({ outcome: 'check_failed',
      reason: known.has(error.message) ? error.message : 'gateway_response_unavailable' }));
    console.error('Run from gateway with its private ADMIN_API_KEY configured and the updated gateway running. If a location request was attempted, inspect its log before retrying.');
    process.exitCode = 1;
  });
}

module.exports = { inspectWifiHome, summary };
