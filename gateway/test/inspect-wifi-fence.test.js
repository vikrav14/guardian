'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectWifiFence, parseArguments } = require('../scripts/inspect-wifi-fence');

test('status/report/preview are read-only and unsupported write commands are rejected', async () => {
  for (const args of [[], ['--report']]) {
    const calls = [];
    await inspectWifiFence({ args, request: async input => {
      calls.push(input); return { version: 1, configured: true };
    } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].timeline, args.length === 1);
  }
  const preview = await inspectWifiFence({ args: ['--preview'], request: () => {
    throw new Error('preview must not connect to a gateway');
  } });
  assert.equal(preview.liveProvisioningAvailable, false);
  for (const args of [['--apply'], ['--send'], ['--start', '--report'], ['--mark=private text']]) {
    assert.throws(() => parseArguments(args), /invalid_arguments/);
  }
});

test('capture markers/stops use the running capture ID and a failed POST is not retried', async () => {
  for (const args of [['--stop'], ['--mark=router_off']]) {
    const calls = [];
    await inspectWifiFence({ args, request: async input => {
      calls.push(input);
      return { version: 1, configured: true, capture: { captureId: 'run-a', phase: 'recording' } };
    } });
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].captureId, 'run-a');
  }
  let posts = 0;
  await assert.rejects(inspectWifiFence({ args: ['--start'], request: async ({ method }) => {
    if (method === 'GET') return { version: 1, configured: true, capture: null };
    posts++;
    throw new Error('network timeout');
  } }), /network timeout/);
  assert.equal(posts, 1);
  await assert.rejects(inspectWifiFence({ args: ['--start'], request: async () => ({
    version: 1, configured: true, capture: { captureId: 'run-a', phase: 'recording' },
  }) }), /capture_already_running/);
  await assert.rejects(inspectWifiFence({ args: ['--stop'], request: async () => ({
    version: 1, configured: true, capture: null,
  }) }), /capture_not_started/);
});
