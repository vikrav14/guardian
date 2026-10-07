'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { database, imei } = require('./helpers/command-database');
const { policy, hash, cost, monthKey, normalizedUsage } = require('../src/intelligence-core/policy');
const { createLedger } = require('../src/intelligence-core/ledger');
const { runAiScope } = require('../src/intelligence-core/runtime');
const { anthropicMessage } = require('../src/intelligence-core/provider');
const { authorizeIntelligence } = require('../src/intelligence-core/access');
const { createIntelligenceService, selection } = require('../src/intelligence-core/service');
const { collectEvidence } = require('../src/intelligence-core/evidence');
const model = 'claude-haiku-4-5-20251001';
const clock = Date.parse('2026-10-07T08:00:00Z');
const access = { uid: 'owner', imei, ownerUid: 'owner', plan: 'family', permissions: ['location', 'alerts'], scopeKey: 'scope', serviceKey: 'watch:owner:test' };
const request = { serviceKey: access.serviceKey, plan: 'family', jobId: 'job', attempt: 1, feature: 'question', model, inputTokens: 100, maxTokens: 100 };
function managedDb() {
  const db = database();
  db.rows.set(`familyServices/${imei}`, { ownerUid: 'owner', subscription: { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' },
    members: { owner: { status: 'active', permissions: {} }, member: { status: 'active', permissions: { alerts: true } } } });
  db.rows.set(`devices/${imei}`, { nickname: 'Test wearer', online: false, batteryPercent: 70,
    batteryUpdatedAt: new Date(clock - 86400000), lastHeartbeatAt: new Date(clock - 86400000) });
  return db;
}

test('input size guards cannot be bypassed by a field named data or unpriced options', async () => {
  const scope = { db: database(), ...request, authorize: async () => {} };
  for (const extra of [{ messages: [{ data: 'x'.repeat(25000) }] }, { cache_control: { type: 'ephemeral' } },
    { inference_geo: 'us' }, { messages: [{ type: 'image', source: { type: 'url', url: 'https://private.test' } }] }]) {
    await assert.rejects(runAiScope(scope, () => anthropicMessage({ apiKey: 'test', body: { model, max_tokens: 100, ...extra },
      fetchImpl: async () => assert.fail('must reject before any network call') })), /ai_request_too_large|ai_unsupported_pricing_option|ai_invalid_image/);
  }
  assert.deepEqual(normalizedUsage('anthropic', { input_tokens: 10, output_tokens: 3,
    cache_creation_input_tokens: 5, cache_read_input_tokens: 7 }),
  { input_tokens: 22, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 });
});

test('question allowance is shared across assistant and app but excludes photo calls', async () => {
  const db = database(), ledger = createLedger(db, { now: () => clock, limits: { ...policy({}), callsPerDay: 500 } });
  for (let i = 0; i < 50; i++) await ledger.reserve({ ...request, jobId: 'question-' + i, feature: i % 2 ? 'assistant' : 'question' });
  await assert.rejects(ledger.reserve({ ...request, jobId: 'over-limit' }), /ai_question_limit/);
  await ledger.reserve({ ...request, jobId: 'question-0', attempt: 2, feature: 'assistant' });
  await ledger.reserve({ ...request, jobId: 'photo', feature: 'photo_description' });
});

test('comparative and medical questions are never reduced to a keyword lookup', () => {
  const { directSelection } = require('../src/intelligence-core/service');
  for (const question of ['Was the battery lower yesterday?', 'Is the wearer safe at home?', 'Why was there a fall?', 'Should medicine be taken?']) {
    assert.equal(directSelection(question, { facts: [] }), null);
  }
});

test('future check-ins and profile updates cannot freshen unknown battery evidence', async () => {
  const db = managedDb(), access = await authorizeIntelligence(db, 'owner', imei, { now: clock });
  db.rows.set(`devices/${imei}`, { online: true, batteryPercent: 42, updatedAt: new Date(clock), lastHeartbeatAt: new Date(clock + 60000) });
  const packet = await collectEvidence(db, access, { now: clock });
  assert(packet.facts.some(f => f.kind === 'connection' && f.text.startsWith('No current')));
  assert(packet.facts.some(f => f.kind === 'battery' && f.recordedAt === null && f.text.includes('time is unavailable')));
});

test('real photo pipeline meters orientation and description once each', async () => {
  const db = database(); let counts = 0, generations = 0;
  const analyze = require('../src/incident-photo-orientation').createOrientedPhotoAnalyzer({ apiKey: 'test', model,
    fetchImpl: async (url, req) => {
      if (url.endsWith('/count_tokens')) { counts++; return { ok: true, json: async () => ({ input_tokens: 900 }) }; }
      generations++;
      const orientation = JSON.parse(req.body).max_tokens === 160;
      const value = orientation ? { view: 'A', confidence: 'high' } : { status: 'ready', summary: 'A chair is visible.',
        visibleDetails: [], uncertainDetails: [], limitations: [], orientation: { clockwiseDegrees: 0, confidence: 'high' } };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(value) }],
        stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 90 } }) };
    } });
  await runAiScope({ db, ...request, jobId: 'real-photo', feature: 'photo_description', authorize: async () => {} },
    () => analyze(require('./fixtures/photo-synthetic'), { reauthorize: async () => {} }));
  assert.equal(counts, 2); assert.equal(generations, 2);
  const attempts = [...db.rows].filter(([key]) => key.startsWith('aiAttempts/')).map(([, value]) => value);
  assert.deepEqual(attempts.map(row => row.feature).sort(), ['photo_description', 'photo_orientation']);
  assert.equal(attempts.reduce((sum, row) => sum + row.charged, 0), 2700);
  await assert.rejects(runAiScope({ db, ...request, jobId: 'real-photo', authorize: async () => {} },
    () => analyze(require('./fixtures/photo-synthetic'), { reauthorize: async () => {} })), /analysis_provider_unavailable/);
  assert.equal(generations, 2);
});

test('Gemini preserves tool thought signatures and charges thinking tokens across rounds', async () => {
  const Gemini = require('../src/providers/gemini-provider');
  const db = database(); let generation = 0;
  const provider = new Gemini({ geminiApiKey: 'test', geminiModel: 'gemini-3.1-flash-lite', fetchImpl: async (url, req) => {
    if (url.endsWith(':countTokens')) return { ok: true, json: async () => ({ totalTokens: 100 }) };
    generation++;
    if (generation === 2) assert.equal(JSON.parse(req.body).contents[1].parts[0].thoughtSignature, 'private-signature');
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: generation === 1
      ? [{ functionCall: { name: 'read_status', args: {} }, thoughtSignature: 'private-signature' }]
      : [{ text: 'Recorded status' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 20 } }) };
  } });
  await runAiScope({ db, ...request, jobId: 'gemini', authorize: async () => {} }, async () => {
    const first = await provider.complete({ messages: [{ role: 'user', content: 'status' }], tools: [] });
    assert.equal(first.usage.output_tokens, 30);
    const second = await provider.complete({ messages: [{ role: 'user', content: 'status' }, { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: first.content[0].id, content: 'offline' }] }], tools: [] });
    assert.equal(second.stopReason, 'end_turn');
  });
  assert.equal([...db.rows].filter(([key]) => key.startsWith('aiAttempts/')).length, 2);
  assert(!JSON.stringify([...db.rows]).includes('private-signature'));
});

test('incident evidence uses frozen location; photo deletion changes IDs and respects media expiry', async () => {
  const db = managedDb(), access = await authorizeIntelligence(db, 'owner', imei, { now: clock });
  db.rows.set('alerts/fall-test', { imei, type: 'fall', createdAt: new Date(clock - 300000), payload: {
    locationSnapshot: { version: 1, state: 'last_known', location: { placeLabel: 'Recorded place', source: 'gps', recordedAt: new Date(clock - 3600000) } } } });
  let deleted = false;
  const gallery = { gallery: async () => ({ photos: deleted ? [] : [{ sequence: 1, state: 'available', mediaExpiresAt: new Date(clock + 10000) }],
    summary: [{ photo: 1, text: 'A chair is visible.' }] }) };
  const before = await collectEvidence(db, access, { now: clock, incidentId: 'fall-test', gallery });
  assert(before.facts.some(f => f.kind === 'incident_location' && f.text.includes('Recorded place')));
  assert(before.facts.every(f => !['connection', 'location'].includes(f.kind)));
  assert.equal(before.validUntil, clock + 10000);
  deleted = true;
  const after = await collectEvidence(db, access, { now: clock, incidentId: 'fall-test', gallery });
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert(after.facts.every(f => f.source !== 'photo_ai'));
  db.rows.set('alerts/other-watch', { imei: '999999999999999', type: 'sos' });
  await assert.rejects(collectEvidence(db, access, { now: clock, incidentId: 'other-watch' }), /incident_unavailable/);
});

test('HTTP endpoint verifies identity, gates the feature and never accepts supplied owner or plan', async () => {
  const { Readable } = require('node:stream');
  const { createIntelligenceHandler } = require('../src/intelligence-core/http');
  const calls = [];
  const handler = createIntelligenceHandler({ enabled: true, getDb: () => database(), verifyToken: async token => {
    if (token !== 'valid') throw Error('private token detail'); return { uid: 'owner' };
  }, factory: () => ({ answer: async input => { calls.push(input); return { mode: 'recorded' }; } }) });
  async function request(path, method = 'GET', body = '', token = 'valid', h = handler) {
    const req = Readable.from([Buffer.from(body)]); req.method = method; req.headers = { authorization: 'Bearer ' + token };
    let status, result, headers;
    const res = { writeHead: (code, value) => { status = code; headers = value; }, end: text => { result = JSON.parse(text); } };
    await h(req, res, new URL('https://example.test' + path)); return { status, result, headers };
  }
  const ok = await request('/app/intelligence?imei=' + imei);
  assert.equal(ok.status, 200); assert.equal(ok.headers['Cache-Control'], 'no-store, private');
  assert.equal(calls[0].uid, 'owner');
  assert.equal((await request('/app/intelligence/ask?imei=' + imei, 'POST', JSON.stringify({ question: 'hello', plan: 'care' }))).status, 400);
  assert.equal((await request('/app/intelligence', 'GET', '', 'bad')).status, 401);
  assert.equal((await request('/app/intelligence/ask', 'POST', 'x'.repeat(2049))).status, 413);
  assert.equal((await request('/app/intelligence', 'GET', '', 'valid', createIntelligenceHandler({ enabled: false }))).status, 503);
  assert.equal(calls.length, 1);
});
test('known model prices, unknown models and Mauritius month boundary', () => {
  assert.equal(cost(model, 600000, 90000), 1050000);
  assert.equal(cost('gemini-3.1-flash-lite', 600000, 90000), 285000);
  assert.throws(() => cost('unpriced', 1, 1), /ai_model_not_priced/);
  assert.equal(monthKey(Date.parse('2026-10-31T20:00:00Z')), '2026-11');
  assert.throws(() => policy({ AI_FAMILY_MONTHLY_MUR: '-1' }), /ai_policy_invalid/);
  assert.deepEqual(normalizedUsage('gemini', { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 7 }), { input_tokens: 12, output_tokens: 10 });
  assert.equal(normalizedUsage('anthropic', {}), null);
});
test('concurrent reservations cannot overspend; duplicate jobs survive a new ledger instance', async () => {
  const db = database(), limits = { ...policy({}), family: 1500, fleet: 10000, routineShare: 1 };
  const ledger = createLedger(db, { now: () => clock, limits });
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => ledger.reserve({ ...request, jobId: `job${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(createLedger(db, { now: () => clock, limits }).reserve({ ...request, jobId: 'job0' }), /ai_duplicate_attempt/);
  const claim = results.find(r => r.status === 'fulfilled').value;
  await ledger.settle(claim, { input_tokens: 100, output_tokens: 10 });
  await ledger.settle(claim, { input_tokens: 0, output_tokens: 0 });
  assert.equal((await claim.service.get()).data().charged, 150);
});
test('routine requests cannot consume the incident reserve; fleet ceiling still applies', async () => {
  const db = database(), limits = { ...policy({}), family: 3000, fleet: 3000, routineShare: 0.3 };
  const ledger = createLedger(db, { now: () => clock, limits });
  await ledger.reserve(request);
  await assert.rejects(ledger.reserve({ ...request, jobId: 'routine2' }), /ai_budget_reached/);
  await ledger.reserve({ ...request, jobId: 'photo1', feature: 'photo_description' });
  await ledger.reserve({ ...request, jobId: 'photo2', feature: 'photo_description' });
  await assert.rejects(ledger.reserve({ ...request, jobId: 'other', serviceKey: 'another-family', feature: 'photo_description' }), /ai_budget_reached/);
});
test('missing usage is retained conservatively and daily attempt limit cannot be refunded', async () => {
  const db = database(), ledger = createLedger(db, { now: () => clock, limits: { ...policy({}), callsPerDay: 1 } });
  const claim = await ledger.reserve(request);
  await ledger.settle(claim, null);
  assert.equal((await claim.ref.get()).data().state, 'unconfirmed');
  assert.equal((await claim.service.get()).data().charged, claim.reserved);
  await assert.rejects(ledger.reserve({ ...request, jobId: 'new' }), /ai_daily_limit/);
});
test('all paid provider attempts require a scope and token count, and retain real usage', async () => {
  let network = 0; const db = database();
  const body = { model, max_tokens: 100, system: 'Select facts', messages: [{ role: 'user', content: 'test' }] };
  const fetchImpl = async (url, options) => {
    network++; assert(options.signal); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => url.endsWith('/count_tokens') ? { input_tokens: 10 } :
      { model, content: [{ type: 'text', text: 'test' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } } };
  };
  await assert.rejects(anthropicMessage({ apiKey: 'test', body, fetchImpl }), /ai_scope_required/);
  assert.equal(network, 0);
  await runAiScope({ db, ...access, jobId: 'one', feature: 'question', authorize: async () => {} },
    () => anthropicMessage({ apiKey: 'test', body, fetchImpl }));
  assert.equal(network, 2);
  const row = [...db.rows.entries()].find(([key]) => key.startsWith('aiAttempts/'))[1];
  assert.equal(row.charged, 20);
  assert(!JSON.stringify(row).includes('Select facts'));
});
test('provider failure is not automatically retried and does not erase a reservation', async () => {
  let network = 0; const db = database();
  await assert.rejects(runAiScope({ db, ...access, jobId: 'timeout', feature: 'question', authorize: async () => {} },
    () => anthropicMessage({ apiKey: 'test', body: { model, max_tokens: 100, messages: [{ role: 'user', content: 'test' }] },
      fetchImpl: async url => { network++; if (url.endsWith('/count_tokens')) return { ok: true, json: async () => ({ input_tokens: 10 }) }; throw Error('private secret'); } })), /ai_network_failed/);
  assert.equal(network, 2);
  assert.equal([...db.rows.entries()].find(([k]) => k.startsWith('aiAttempts/'))[1].state, 'unconfirmed');
});
test('managed per-wearer grants, revocation and subscription are authoritative', async () => {
  const db = managedDb();
  assert.deepEqual((await authorizeIntelligence(db, 'member', imei)).permissions, ['alerts']);
  await assert.rejects(authorizeIntelligence(db, 'outsider', imei), /access_not_shared/);
  const service = db.rows.get(`familyServices/${imei}`);
  service.members.member.status = 'revoked';
  await assert.rejects(authorizeIntelligence(db, 'member', imei), /access_not_shared/);
  db.rows.delete(`familyServices/${imei}`);
  await assert.rejects(authorizeIntelligence(db, 'owner', imei), /access_not_shared/);
});
test('evidence excludes forbidden location and old battery remains explicitly old', async () => {
  const db = managedDb();
  db.rows.get(`devices/${imei}`).location = { lat: -20, lng: 57, placeLabel: 'Private place', recordedAt: new Date(clock) };
  const a = await authorizeIntelligence(db, 'member', imei);
  const packet = await collectEvidence(db, a, { now: clock });
  assert(!JSON.stringify(packet).includes('Private place'));
  assert(packet.facts.some(f => f.kind === 'battery' && /old/.test(f.text)));
  assert(!packet.facts.some(f => f.kind === 'location'));
});
const packet = () => ({ wearerName: 'Test', incidentId: null, facts: [{ id: 'one', kind: 'battery', text: 'Recorded battery 70%.', source: 'watch' }],
  gaps: [], asOf: clock, validUntil: clock + 60000, fingerprint: 'fingerprint' });
test('screen refresh and basic questions never use a model', async () => {
  let calls = 0;
  const service = createIntelligenceService({ db: database(), provider: { complete: async () => { calls++; } },
    authorize: async () => access, collect: async () => packet(), now: () => clock });
  await service.answer({ uid: 'owner', imei });
  const reply = await service.answer({ uid: 'owner', imei, question: 'What is the battery?' });
  assert.equal(reply.facts[0].id, 'one'); assert.equal(calls, 0);
});
test('concurrent identical questions generate once; persistent cache stores only evidence IDs', async () => {
  const db = database(); let calls = 0;
  const options = { db, authorize: async () => access, collect: async () => packet(), now: () => clock,
    provider: { complete: async () => { calls++; return { stopReason: 'end_turn', content: [{ type: 'text', text: '{"evidenceIds":["one"],"answerable":true}' }] }; } } };
  const service = createIntelligenceService(options);
  const values = await Promise.all(Array.from({ length: 5 }, () => service.answer({ uid: 'owner', imei, question: 'Explain the recorded information' })));
  assert(values.every(v => v.mode === 'ai_selected')); assert.equal(calls, 1);
  await createIntelligenceService(options).answer({ uid: 'owner', imei, question: 'Explain the recorded information' });
  assert.equal(calls, 1);
  const rows = JSON.stringify([...db.rows.entries()].filter(([k]) => k.startsWith('aiSelections/')));
  assert(!rows.includes('battery')); assert(!rows.includes('Explain')); assert(rows.includes('one'));
});
test('permission changes and changed evidence suppress an in-flight answer', async () => {
  let version = 0;
  const service = createIntelligenceService({ db: database(), authorize: async () => access, now: () => clock,
    collect: async () => ({ ...packet(), fingerprint: `v${version}` }), provider: { complete: async () => {
      version++; return { stopReason: 'end_turn', content: [{ type: 'text', text: '{"evidenceIds":["one"],"answerable":true}' }] };
    } } });
  const result = await service.answer({ uid: 'owner', imei, question: 'Explain what changed' });
  assert.equal(result.reason, 'evidence_changed'); assert.deepEqual(result.facts, []);
  let revoked = false;
  const other = createIntelligenceService({ db: database(), now: () => clock, collect: async () => packet(),
    authorize: async () => revoked ? { ...access, scopeKey: 'changed' } : access,
    provider: { complete: async () => { revoked = true; return { stopReason: 'end_turn', content: [{ type: 'text', text: '{"evidenceIds":["one"],"answerable":true}' }] }; } } });
  await assert.rejects(other.answer({ uid: 'owner', imei, question: 'Explain what changed' }), /access_changed/);
});
test('model cannot manufacture prose, unknown evidence, safety claims or extra fields', () => {
  for (const raw of ['{"answerable":true,"evidenceIds":["invented"]}', '{"answerable":true,"evidenceIds":["one"],"text":"The wearer is safe"}',
    '{"answerable":false,"evidenceIds":["one"]}', '{"answerable":true,"evidenceIds":["one","one"]}']) {
    assert.throws(() => selection({ stopReason: 'end_turn', content: [{ type: 'text', text: raw }] }, packet()), /ai_invalid_selection/);
  }
});
