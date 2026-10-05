'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DYNAMIC_CALL_TEMPLATES } = require('../src/watch-call-links');
const { templateDefinitions, checkPhotoTemplates, withIncidentPhotoTemplate,
  PHOTO_NOTICE, V3_TEMPLATES, buildFollowupPlan } = require('../src/incident-photo-templates');
const { manageTemplates, parseArgs } = require('../scripts/incident-photo-templates');

const callOrigin = 'https://gateway.example.test';
const appUrl = 'https://app.example.test';
const settings = { watchCallPublicOrigin: callOrigin, metaWhatsAppWabaId: '12345',
  metaWhatsAppAccessToken: 'private-test-token', metaGraphVersion: 'v25.0' };
function baseline() {
  return Object.entries(DYNAMIC_CALL_TEMPLATES).flatMap(([type, states]) => Object.entries(states).map(([state, name]) => ({
    name, status: 'APPROVED', category: 'UTILITY', language: 'en', parameter_format: 'POSITIONAL',
    components: [
      { type: 'HEADER', format: 'TEXT', text: `Guardian ${type}` },
      { type: 'BODY', text: `${type}/${state}: {{1}}. Time {{2}}. Location {{3}}. Battery {{4}}.`,
        example: { body_text: [['Alex', '12:00', 'Unavailable', '50%']] } },
      { type: 'FOOTER', text: 'Keep checking on the wearer.' },
      { type: 'BUTTONS', buttons: [
        { type: 'URL', text: 'Call watch', url: `${callOrigin}/call-watch/{{1}}`, example: [`${callOrigin}/call-watch/unavailable`] },
        ...(state === 'unavailable' ? [] : [{ type: 'URL', text: state === 'fresh' ? 'Incident location' : 'Last known location',
          url: 'https://maps.google.com/?q={{1}}', example: ['https://maps.google.com/?q=-20,57'] }]),
      ] },
    ],
  })));
}
const definitions = () => templateDefinitions({ appUrl, callOrigin, baseTemplates: baseline() });

test('guardian-hour templates preserve call/map buttons and replace the five-photo promise', () => {
  const legacy = definitions();
  const next = templateDefinitions({ appUrl, callOrigin, baseTemplates: baseline(), guardianWindow: true });
  assert.equal(next.length, 7);
  assert.equal(new Set(next.slice(0, 6).map(row => row.components.find(c => c.type === 'BODY').text)).size, 6,
    'fresh, historical and unavailable location contracts remain distinct');
  for (let i = 0; i < 6; i++) {
    assert(next[i].name.endsWith('_v5'));
    assert.deepEqual(next[i].components.find(c => c.type === 'BUTTONS'), legacy[i].components.find(c => c.type === 'BUTTONS'));
    const body = next[i].components.find(c => c.type === 'BODY').text;
    assert(body.includes('One photo may follow'));assert(!body.includes('up to 5'));
  }
  assert.equal(next[6].name, 'guardian_incident_photo_update_v3');
  assert(!next[6].components.find(c => c.type === 'BODY').text.includes('up to 5'));
});
const approved = () => definitions().map(row => ({ ...row, status: 'APPROVED' }));
function api(rows, handler) {
  const requests = [];
  return { requests, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), method: options.method || 'GET', payload: options.body && JSON.parse(options.body) });
    if (handler) return handler(requests.at(-1), requests.length);
    return { ok: true, json: async () => ({ data: rows }) };
  } };
}
const run = (network, mode = 'preview') => manageTemplates({ options: { mode, appUrl, callOrigin }, settings,
  env: {}, fetchImpl: network.fetchImpl });

test('six v3 contracts preserve the complete approved v2 wording and actions; follow-up owns the gallery', () => {
  const originals = baseline(), before = structuredClone(originals);
  const result = templateDefinitions({ appUrl, callOrigin, baseTemplates: originals });
  assert.equal(result.length, 7);
  originals.forEach((original, index) => {
    const next = result[index];
    assert.equal(next.name, original.name.replace(/_v2$/, '_v3'));
    const expected = structuredClone(original.components);
    expected.find(row => row.type === 'BODY').text += PHOTO_NOTICE;
    assert.deepEqual(next.components, expected);
    const buttons = next.components.find(row => row.type === 'BUTTONS').buttons;
    assert.ok(buttons.length <= 2);
    assert.equal(buttons[0].text, 'Call watch');
    assert.ok(buttons.every(button => button.type === 'URL'));
    assert.doesNotMatch(JSON.stringify(buttons), /incident=/);
  });
  assert.deepEqual(originals, before);
  assert.equal(result[6].name, 'guardian_incident_photo_update_v1');
  assert.equal(result[6].components[2].buttons[0].url, `${appUrl}/?incident={{1}}`);
});

test('refuse unsafe or incompatible base contracts before constructing v3', () => {
  for (const mutate of [
    rows => { rows[0].status = 'PENDING'; }, rows => { rows[0].category = 'MARKETING'; },
    rows => { rows[0].language = 'en_US'; }, rows => { rows[0].parameter_format = 'NAMED'; },
    rows => { rows[0].components[1].text += ' {{5}}'; },
    rows => { rows[0].components[0].format = 'IMAGE'; },
    rows => { rows[0].components[2].text += '{{1}}'; },
    rows => { rows[0].components.push(rows[0].components[1]); },
    rows => { rows.push(rows[0]); }, rows => { rows.splice(5, 1); },
    rows => { rows[0].components[3].buttons[0] = { type: 'PHONE_NUMBER', phone_number: '+23050000000' }; },
    rows => { rows[0].components[3].buttons[0].url = 'https://wrong.example/call-watch/{{1}}'; },
    rows => { rows[0].components[3].buttons.reverse(); },
    rows => { rows[0].components[1].text += 'x'.repeat(1024); },
  ]) {
    const rows = baseline(); mutate(rows);
    assert.throws(() => templateDefinitions({ appUrl, callOrigin, baseTemplates: rows }));
  }
  for (const badUrl of ['http://app.example', 'https://localhost', 'https://app.example/?x=1', 'https://a:b@app.example']) {
    assert.throws(() => templateDefinitions({ appUrl: badUrl, callOrigin, baseTemplates: baseline() }));
  }
});

test('per-family v3 gates change only a recipient-specific v2 name, preserving all frozen parameters', () => {
  for (const type of ['sos', 'fall']) for (const state of ['fresh', 'last_known', 'unavailable']) {
    const prepared = { composeResult: { text: 'frozen' }, plan: { templateName: DYNAMIC_CALL_TEMPLATES[type][state],
      locationState: state, dynamicCallLink: true, components: [{ token: 'recipient-token', map: 'frozen-map' }], bodyParameters: ['a', 'b', 'c', 'd'] } };
    const before = structuredClone(prepared);
    for (const env of [{}, { INCIDENT_PHOTO_TEMPLATES_APPROVED: 'true' },
      { [type === 'sos' ? 'INCIDENT_PHOTO_FALL_V3_ENABLED' : 'INCIDENT_PHOTO_SOS_V3_ENABLED']: 'true' }]) {
      assert.equal(withIncidentPhotoTemplate(prepared, { type, env }), prepared);
    }
    const env = { [`INCIDENT_PHOTO_${type.toUpperCase()}_V3_ENABLED`]: 'true' };
    const result = withIncidentPhotoTemplate(prepared, { type, env });
    assert.equal(result.plan.templateName, V3_TEMPLATES[type][state]);
    assert.equal(result.plan.components, prepared.plan.components);
    assert.equal(result.plan.bodyParameters, prepared.plan.bodyParameters);
    assert.deepEqual(prepared, before);
    for (const plan of [{ ...prepared.plan, dynamicCallLink: false }, { ...prepared.plan, templateName: 'legacy_v1' }]) {
      const legacy = { plan };
      assert.equal(withIncidentPhotoTemplate(legacy, { type, env }), legacy);
    }
  }
});

test('partial follow-up counts only received photos and available analysis', () => {
  const result = buildFollowupPlan('incident123', { photos: [
    { state: 'available', analysis: { status: 'ready' } },
    { state: 'available', analysis: { status: 'unavailable' } },
    { state: 'failed', analysis: { status: 'pending' } },
  ], summary: [{ photo: 1, text: 'A chair is visible.' }] });
  assert.deepEqual(result.components[0].parameters.map(p => p.text), ['2', '1', 'Photo 1: A chair is visible.']);
  assert.equal(result.components[1].index, '0');
});

test('follow-up fallback distinguishes failed analysis from actual unclear views without changing the template', () => {
  for (const [statuses, count, expected] of [
    [[], '0', 'No incident photos were received.'],
    [Array(5).fill('unavailable'), '0', 'Photos are available; AI descriptions are unavailable.'],
    [['pending'], '0', 'Photos are available; AI descriptions are unavailable.'],
    [['too_unclear', 'too_unclear'], '2', 'Photos are available; AI found these views too unclear to describe.'],
    [['too_unclear', 'unavailable'], '1', 'Photos are available; AI found some views too unclear. Other AI descriptions are unavailable.'],
  ]) {
    const photos = statuses.map(status => ({ state: 'available', analysis: { status,
      ...(status === 'unavailable' ? { reason: 'analysis_http_error', diagnostics: { httpStatus: 401 } } : {}),
    } }));
    photos.push({ state: 'failed', analysis: { status: 'too_unclear' } });
    const plan = buildFollowupPlan('incident123', { photos, summary: [] });
    assert.equal(plan.templateName, 'guardian_incident_photo_update_v1');
    assert.deepEqual(plan.components[0].parameters.map(p => p.text), [String(statuses.length), count, expected]);
    assert.deepEqual(plan.components[1], { type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: 'incident123' }] });
  }
});

test('preview and approval check are GET-only; approval includes the exact content, category and buttons', async () => {
  const network = api([...baseline(), ...approved()]);
  const preview = await run(network);
  assert.equal(preview.definitions.length, 7);
  assert.equal(preview.changesMade, false);
  assert.equal((await run(network, 'check')).ready, true);
  assert.ok(network.requests.every(row => row.method === 'GET'));
  for (const change of [
    row => { row.status = 'PENDING'; }, row => { row.category = 'MARKETING'; },
    row => { row.components[1].text += ' changed'; }, row => { row.components[0].text = 'changed'; },
    row => { row.components[3].buttons[1].url = 'https://wrong.example/{{1}}'; },
  ]) {
    const rows = approved(); change(rows[0]);
    assert.equal(checkPhotoTemplates(rows, definitions())[0].ready, false);
  }
  const rows = approved(); rows[0].components[1].example = { body_text: [['Other examples']] };
  assert.ok(checkPhotoTemplates(rows, definitions()).every(row => row.ready), 'Meta examples do not alter the send contract');
});

test('a conflicting final target blocks every POST, including earlier missing templates', async () => {
  const last = approved().at(-1); last.components[1].text += ' changed';
  const network = api([...baseline(), last]);
  await assert.rejects(run(network, 'submit'), /Nothing was overwritten or submitted/);
  assert.deepEqual(network.requests.map(row => row.method), ['GET']);
});

test('submission creates only missing templates and leaves pending or approved existing versions unchanged', async () => {
  const existing = approved().slice(0, 2); existing[0].status = 'PENDING';
  const rows = [...baseline(), ...existing];
  const network = api(rows, request => {
    if (request.method === 'POST') rows.push({ ...request.payload, status: 'PENDING' });
    return { ok: true, json: async () => ({ data: rows }) };
  });
  const first = await run(network, 'submit');
  assert.equal(first.results.filter(row => row.outcome === 'submitted_for_review').length, 5);
  assert.equal(first.gatewayFlagsChanged, false);
  const second = await run(network, 'submit');
  assert.equal(second.changesMade, false);
  assert.equal(network.requests.filter(row => row.method === 'POST').length, 5);
  assert.ok(network.requests.every(row => ['GET', 'POST'].includes(row.method)));
  assert.equal((await run(network, 'check')).ready, false);
});

test('incomplete pagination and provider failures never masquerade as missing templates', async () => {
  for (const handler of [
    () => ({ ok: false, status: 403 }),
    () => ({ ok: true, json: async () => ({ data: baseline(), paging: { next: 'ignored' } }) }),
    () => ({ ok: true, json: async () => ({ data: baseline(), paging: { next: 'ignored', cursors: { after: 'repeated' } } }) }),
    () => { throw Error('private-test-token'); },
  ]) {
    const network = api([], handler);
    await assert.rejects(run(network, 'submit'), error => !error.message.includes('private-test-token'));
    assert.ok(network.requests.every(row => row.method === 'GET'));
  }
});

test('pagination uses only the fixed Meta origin and gathers all base contracts before submission', async () => {
  const network = api([], (request, count) => ({ ok: true, json: async () => count === 1
    ? { data: baseline().slice(0, 3), paging: { next: 'https://untrusted.example', cursors: { after: 'next-page' } } }
    : { data: baseline().slice(3) } }));
  assert.equal((await run(network)).definitions.length, 7);
  assert.equal(network.requests.length, 2);
  assert.ok(network.requests.every(row => new URL(row.url).origin === 'https://graph.facebook.com'));
  assert.equal(new URL(network.requests[1].url).searchParams.get('after'), 'next-page');
});

test('ambiguous submission is not retried and provider error details are not printed', async () => {
  const network = api([], request => {
    if (request.method === 'POST') throw Error('private-test-token');
    return { ok: true, json: async () => ({ data: baseline() }) };
  });
  await assert.rejects(run(network, 'submit'), /outcome unknown.*Run --check/);
  assert.equal(network.requests.filter(row => row.method === 'POST').length, 1);
});

test('CLI requires explicit submission and rejects old fixed-number or ambiguous options', () => {
  assert.equal(parseArgs([]).mode, 'preview');
  assert.deepEqual(parseArgs(['--check', '--app-url', appUrl, '--call-origin', callOrigin]), { mode: 'check', appUrl, callOrigin });
  for (const args of [['--submit', '--check'], ['--call-number', '+23050000000'], ['--app-url'], ['--app-url', '--submit'], ['--unknown']]) {
    assert.throws(() => parseArgs(args));
  }
});
