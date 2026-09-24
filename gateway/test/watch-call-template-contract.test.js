'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkCallTemplates } = require('../src/watch-call-template-contract');
const { DYNAMIC_CALL_TEMPLATES } = require('../src/watch-call-links');
const settings = { watchCallPublicOrigin: 'https://guardian.example' };

function templates(type) {
  return Object.entries(DYNAMIC_CALL_TEMPLATES[type]).map(([state, name]) => ({ name, status: 'APPROVED', language: 'en', category: 'UTILITY', components: [
    { type: 'BODY', text: 'Update: {{1}}. Time: {{2}}. Location: {{3}}. Watch: {{4}}.' },
    { type: 'BUTTONS', buttons: [
      { type: 'URL', text: 'Call watch', url: 'https://guardian.example/call-watch/{{1}}' },
      ...(state === 'unavailable' ? [] : [{ type: 'URL', text: 'View location', url: 'https://maps.google.com/?q={{1}}' }]),
    ] },
  ] }));
}

for (const type of ['sos', 'fall']) test(`${type} preflight accepts only approved English four-variable dynamic call/map contracts`, () => {
  assert.ok(checkCallTemplates(templates(type), { type, settings }).every(item => item.ready));
  for (const change of [
    t => { t.status = 'PENDING'; }, t => { t.language = 'en_US'; }, t => { t.category = 'MARKETING'; },
    t => { t.components[0].text += ' {{5}}'; },
    t => { t.components.push({ type: 'HEADER', format: 'IMAGE' }); },
    t => { t.components[1].buttons[0] = { type: 'PHONE_NUMBER', text: 'Call watch', phone_number: '+23050000001' }; },
    t => { t.components[1].buttons.reverse(); },
    t => { t.components[1].buttons[0].url = 'https://other.example/call-watch/{{1}}'; },
    t => { t.components[1].buttons[0].url = 'https://guardian.example/call-watch/fixed'; },
  ]) {
    const list = templates(type); change(list[0]);
    assert.equal(checkCallTemplates(list, { type, settings })[0].ready, false);
  }
  assert.ok(checkCallTemplates([], { type, settings }).every(item => !item.ready));
});
