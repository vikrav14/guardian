'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { checkPhotoAi } = require('../scripts/check-incident-photo-ai');
const { DESCRIPTION_SCHEMA } = require('../src/incident-photo-analysis');
const { ORIENTATION_SCHEMA } = require('../src/incident-photo-orientation');
const config = { apiKey: 'test-key-never-print', model: 'claude-test-model' };
const success = body => new Response(JSON.stringify({ model: config.model, stop_reason: 'end_turn',
  content: [{ type: 'text', text: body.messages[0].content[0].text }] }), { status: 200 });

test('both photo schemas declare a single compatible primitive type at each enum', () => {
  // The live Sonnet 4.6 API rejected enum A with type ['string', 'null'].
  // Check all nested enums, including the description's numeric quarter-turns.
  function check(schema) {
    if (!schema || typeof schema !== 'object') return;
    if (Object.hasOwn(schema, 'enum')) {
      for (const value of schema.enum) {
        assert(schema.type === 'string' && typeof value === 'string' ||
          schema.type === 'integer' && Number.isInteger(value) ||
          schema.type === 'null' && value === null,
        `Enum ${JSON.stringify(value)} requires a compatible scalar type; got ${JSON.stringify(schema.type)}`);
      }
    }
    for (const value of Object.values(schema)) {
      if (Array.isArray(value)) value.forEach(check);
      else check(value);
    }
  }
  check(ORIENTATION_SCHEMA);
  check(DESCRIPTION_SCHEMA);
});

test('checks both production schemas with synthetic text only and original API budgets', async () => {
  const requests = [];
  const report = await checkPhotoAi({ ...config, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.redirect, 'error');
    assert(request.signal instanceof AbortSignal);
    assert.equal(request.headers['x-api-key'], config.apiKey);
    const body = JSON.parse(request.body);
    requests.push(body);
    assert.equal(body.model, config.model);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content.length, 1);
    assert.equal(body.messages[0].content[0].type, 'text');
    assert.match(body.system, /synthetic/);
    assert(!JSON.stringify(body).includes(config.apiKey));
    return success(body);
  } });
  assert.deepEqual(requests.map(body => body.output_config.format.schema), [ORIENTATION_SCHEMA, DESCRIPTION_SCHEMA]);
  assert.deepEqual(requests.map(body => body.max_tokens), [160, 900]);
  assert.equal(report.ok, true);
  assert.equal(report.configurationSource, 'this_shell_not_running_gateway');
  assert.equal(report.checks.length, 2);
  assert(report.checks.every(check => check.ok && check.responseModel === config.model));
  assert(!JSON.stringify(report).includes(config.apiKey));
});

test('first-stage HTTP rejection exposes only bounded scrubbed provider detail and stops', async () => {
  let calls = 0;
  const report = await checkPhotoAi({ ...config, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { type: 'invalid_request_error',
      message: `Unsupported output_config. ${config.apiKey} sk-ant-another-secret Bearer token-secret\n` + 'x'.repeat(1000),
      secret: 'unselected-private-field' }, headers: { key: 'unselected-private-header' } }), { status: 400 });
  } });
  assert.equal(calls, 1);
  assert.equal(report.ok, false);
  const check = report.checks[0];
  assert.equal(check.stage, 'orientation_schema');
  assert.equal(check.reason, 'analysis_http_error');
  assert.equal(check.httpStatus, 400);
  assert.equal(check.providerErrorType, 'invalid_request_error');
  assert.match(check.providerMessage, /^Unsupported output_config/);
  assert(check.providerMessage.length <= 800);
  assert(!/[\u0000-\u001f\u007f]/.test(check.providerMessage));
  for (const secret of [config.apiKey, 'sk-ant-another-secret', 'token-secret', 'unselected-private-field', 'unselected-private-header']) {
    assert(!JSON.stringify(report).includes(secret));
  }
});

test('description rejection preserves successful orientation check and never retries', async () => {
  let calls = 0;
  const report = await checkPhotoAi({ ...config, fetchImpl: async (url, request) => {
    calls++;
    return calls === 1 ? success(JSON.parse(request.body)) : new Response(JSON.stringify({ error: {
      type: 'invalid_request_error', message: 'Schema rejected.' } }), { status: 400 });
  } });
  assert.equal(calls, 2);
  assert.equal(report.ok, false);
  assert.equal(report.checks[0].ok, true);
  assert.equal(report.checks[1].stage, 'description_schema');
  assert.equal(report.checks[1].providerMessage, 'Schema rejected.');
});

test('oversized error bodies are cancelled and not exposed', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16_385)); },
    cancel() { cancelled = true; } });
  const report = await checkPhotoAi({ ...config, fetchImpl: async () => new Response(body, { status: 400 }) });
  assert.equal(cancelled, true);
  assert.equal(report.checks[0].providerDetail, 'response_too_large');
  assert.equal(report.checks[0].httpStatus, 400);
  assert.equal(report.checks[0].providerMessage, undefined);
});

test('HTML, missing error message and interrupted bodies preserve status without leaking content', async () => {
  for (const response of [new Response('<html>private server details</html>', { status: 503 }),
    new Response(JSON.stringify({ error: { message: { private: 'not text' }, type: 'private' } }), { status: 400 }),
    new Response(new ReadableStream({ start(controller) { controller.error(Error('private stream failure')); } }), { status: 400 })]) {
    const report = await checkPhotoAi({ ...config, fetchImpl: async () => response });
    assert.equal(report.ok, false);
    assert.equal(report.checks[0].httpStatus, response.status);
    assert(!JSON.stringify(report).includes('private'));
  }
});

test('missing credentials or invalid model never reach the provider', async () => {
  for (const override of [{ apiKey: '' }, { model: '' }, { model: 'bad\nmodel' }]) {
    const report = await checkPhotoAi({ ...config, ...override, fetchImpl: async () => assert.fail('must not call API') });
    assert.equal(report.ok, false);
    assert.equal(report.reason, 'api_key_or_model_missing_or_invalid');
    assert.deepEqual(report.checks, []);
  }
});

test('network failures and malformed successful responses retain only fixed reasons', async () => {
  for (const fetchImpl of [async () => { throw Error('private transport detail'); },
    async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'private malformed reply' }] })),
    async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"private":"extra"}' }] }))]) {
    const report = await checkPhotoAi({ ...config, fetchImpl });
    assert.equal(report.ok, false);
    assert.equal(report.checks.length, 1);
    assert(!JSON.stringify(report).includes('private'));
  }
});

test('CLI without --run does not load configuration or start live services', () => {
  const result = spawnSync(process.execPath, [require.resolve('../scripts/check-incident-photo-ai')],
    { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).outcome, 'not_run');
});
