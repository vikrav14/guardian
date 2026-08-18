const test = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('./fixtures/guardian-utterances.json');
const { classifyIntent } = require('../src/intent-classifier');
const {
  extractTimePeriod,
  extractRequestedTimePeriod,
  normalizeLanguage,
} = require('../src/language-understanding');

test('Guardian utterance corpus maps to the expected deterministic intents', () => {
  const failures = [];
  for (const example of corpus) {
    const actual = classifyIntent(example.text).type;
    if (actual !== example.intent) {
      failures.push(`${JSON.stringify(example.text)}: expected ${example.intent}, got ${actual}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('time-period extraction recognises English, French and Mauritian yesterday', () => {
  const now = new Date('2026-08-14T08:00:00.000Z');
  for (const text of ['yesterday summary', "resume d'hier", 'kouma so lazourne yer']) {
    assert.equal(extractTimePeriod(text, now).key, 'yesterday', text);
  }
  assert.equal(extractTimePeriod('how was Jesh today', now).key, 'today');
});

test('journey period extraction only filters when a period was requested', () => {
  const now = new Date('2026-08-18T09:55:00.000Z');
  assert.equal(extractRequestedTimePeriod('Journey?', now), null);
  assert.equal(extractRequestedTimePeriod('Show Jesh journey today', now).key, 'today');
  assert.equal(extractRequestedTimePeriod('Trajet Jesh hier', now).key, 'yesterday');
  assert.equal(extractRequestedTimePeriod('Kot Jesh finn ale zordi?', now).key, 'today');
});

test('language normalisation removes accents without losing apostrophes', () => {
  assert.equal(normalizeLanguage("Où est Jesh aujourd’hui?"), "ou est jesh aujourd'hui");
});
