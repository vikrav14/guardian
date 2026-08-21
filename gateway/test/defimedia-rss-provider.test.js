const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DefiMediaRssProvider,
  classifySafetyCandidate,
  extractPlaceMentions,
  parseDefiMediaFeed,
  safeSourceUrl,
} = require('../src/context/defiMediaRssProvider');
const {
  runDefiMediaRssPoll,
  startDefiMediaRssScheduler,
  stopDefiMediaRssSchedulerForTests,
} = require('../src/context/defiMediaRssScheduler');

const feedUrl = 'https://defimedia.info/rss.xml';

function rss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <title>Defi Media</title>
      <lastBuildDate>Thu, 20 Aug 2026 12:00:00 GMT</lastBuildDate>
      ${items.map((item) => `<item>
        <title><![CDATA[${item.title}]]></title>
        <description><![CDATA[${item.description || ''}]]></description>
        <link>${item.link || 'https://defimedia.info/article-test'}</link>
        <guid>${item.guid || item.link || 'article-test'}</guid>
        <pubDate>${item.pubDate || 'Thu, 20 Aug 2026 11:30:00 GMT'}</pubDate>
        <category>${item.category || 'Actualites'}</category>
      </item>`).join('')}
    </channel></rss>`;
}

test('site-wide RSS items are parsed without fetching article pages', () => {
  const parsed = parseDefiMediaFeed(rss([{
    title: 'Collision a Grand-Baie',
    description: '<p>La circulation est perturbee.</p>',
    link: 'https://defimedia.info/collision-grand-baie',
    category: 'Faits Divers',
  }]));

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, 'Collision a Grand-Baie');
  assert.equal(parsed.items[0].description, 'La circulation est perturbee.');
  assert.deepEqual(parsed.items[0].categories, ['Faits Divers']);
});

test('deterministic prefilter classifies local safety signals and place mentions', () => {
  const result = classifySafetyCandidate({
    title: 'Collision a Grand-Baie : trafic perturbe',
    description: 'La police demande aux automobilistes d eviter la zone.',
    categories: ['Faits Divers'],
  });

  assert.equal(result.safetyCandidate, true);
  assert.equal(result.eventType, 'road_disruption');
  assert.deepEqual(result.placeMentions, ['Grand Baie']);
  assert.equal(result.localityEvidence, 'place_mentions');
  assert.equal(result.classification, 'deterministic_prefilter');
});

test('Mauritius-wide safety wording is eligible without inventing a locality', () => {
  const result = classifySafetyCandidate({
    title: 'Fermeture des ecoles a travers le pays',
    description: 'Les classes sont suspendues a Maurice.',
    categories: ['Actualites'],
  });

  assert.equal(result.safetyCandidate, true);
  assert.equal(result.eventType, 'school_disruption');
  assert.deepEqual(result.placeMentions, []);
  assert.equal(result.mauritiusWide, true);
  assert.equal(result.localityEvidence, 'mauritius_wide');
});

test('foreign safety news is rejected without Mauritius location evidence', () => {
  const result = classifySafetyCandidate({
    title: "Epidemie d Ebola en RDC",
    description: 'Des vaccins sont distribues en Republique democratique du Congo.',
    categories: ['Monde'],
  });

  assert.equal(result.safetyCandidate, false);
  assert.equal(result.eventType, 'other');
  assert.equal(result.reason, 'no_mauritius_location_signal');
  assert.equal(result.localityEvidence, 'none');
});

test('politics and general editorial sections cannot become safety candidates', () => {
  const result = classifySafetyCandidate({
    title: 'Le gouvernement repond apres un accident',
    description: 'Debat parlementaire.',
    categories: ['Politique'],
  });

  assert.equal(result.safetyCandidate, false);
  assert.equal(result.reason, 'excluded_editorial_section');
  assert.equal(result.eventType, 'other');
});

test('Mauritius place recognition is accent and punctuation tolerant', () => {
  assert.deepEqual(
    extractPlaceMentions('Incendie à Bel-Air-Rivière-Sèche, près de Flacq.'),
    ['Flacq', 'Bel Air Riviere Seche']
  );
});

test('trusted HTTP article links are upgraded to HTTPS', () => {
  assert.equal(
    safeSourceUrl('http://defimedia.info/incendie-bel-air#video'),
    'https://defimedia.info/incendie-bel-air'
  );
  assert.equal(safeSourceUrl('http://example.com/copied-story'), null);
  assert.equal(safeSourceUrl('ftp://defimedia.info/archive'), null);
});

test('provider deduplicates an unchanged conditional feed and remains observe-only', async () => {
  let calls = 0;
  const provider = new DefiMediaRssProvider({}, {
    fetchText: async (url, options) => {
      assert.equal(url, feedUrl);
      assert.deepEqual(options.allowedHosts, ['defimedia.info', 'www.defimedia.info']);
      calls += 1;
      return calls === 1
        ? {
            statusCode: 200,
            headers: { etag: 'feed-one' },
            body: rss([{
              title: 'Incendie a Port-Louis',
              description: 'Les pompiers sont mobilises.',
              link: 'https://defimedia.info/incendie-port-louis',
            }]),
          }
        : { statusCode: 304, headers: {}, body: '' };
    },
  });

  const first = await provider.poll({ now: new Date('2026-08-20T12:00:00.000Z') });
  const second = await provider.poll({ now: new Date('2026-08-20T13:00:00.000Z') });

  assert.equal(first.changedItems.length, 1);
  assert.equal(first.changedCandidates.length, 1);
  assert.equal(first.changedCandidates[0].deliveryEligible, false);
  assert.equal(first.changedCandidates[0].deliverySent, false);
  assert.equal(second.notModified, true);
  assert.equal(second.changedItems.length, 0);
});

test('untrusted article hosts are ignored', async () => {
  const provider = new DefiMediaRssProvider({}, {
    fetchText: async () => ({
      statusCode: 200,
      headers: {},
      body: rss([{
        title: 'Incendie a Port-Louis',
        link: 'https://example.com/copied-story',
      }]),
    }),
  });
  const poll = await provider.poll({ now: new Date('2026-08-20T12:00:00.000Z') });
  assert.equal(poll.items.length, 0);
  assert.equal(poll.changedCandidates.length, 0);
});

test('shadow poll reports candidates without device, LLM, Firestore, or delivery work', async () => {
  const result = await runDefiMediaRssPoll({
    provider: {
      poll: async () => ({
        ok: true,
        source: 'mu-defimedia-rss',
        notModified: false,
        items: [{ id: 'one' }],
        changedItems: [{ id: 'one' }],
        candidateItems: [{ id: 'one', eventType: 'fire' }],
        changedCandidates: [{ id: 'one', eventType: 'fire' }],
      }),
    },
  });

  assert.equal(result.changedCandidates, 1);
  assert.deepEqual(result.eventTypes, { fire: 1 });
  assert.equal(result.deviceSweep, null);
  assert.equal(result.llmCalls, 0);
  assert.equal(result.firestoreWrites, 0);
  assert.equal(result.automaticDelivery, false);
});

test('unchanged actionable articles are rechecked against movement without becoming new articles', async () => {
  let evaluated = null;
  const candidate = {
    id: 'one',
    documentId: 'one',
    eventType: 'fire',
    actionable: true,
  };
  const result = await runDefiMediaRssPoll({
    db: {},
    config: {
      contextDefiMediaPersistEvents: true,
      contextDefiMediaEvaluateDevices: true,
      contextDefiMediaPersistMatches: true,
    },
    provider: {
      poll: async () => ({
        ok: true,
        source: 'mu-defimedia-rss',
        notModified: true,
        items: [candidate],
        changedItems: [],
        candidateItems: [candidate],
        changedCandidates: [],
      }),
    },
    persistEvents: async () => ({
      persistent: true,
      created: [],
      updated: [],
      unchanged: [],
      writes: 0,
    }),
    evaluateExposure: async (options) => {
      evaluated = options;
      return { familyMatches: 0, observeOnly: true };
    },
  });

  assert.deepEqual(evaluated.candidates, [candidate]);
  assert.equal(evaluated.persist, true);
  assert.equal(result.changedItems, 0);
  assert.equal(result.changedCandidates, 0);
  assert.equal(result.exposure.familyMatches, 0);
});

test('Defi Media scheduler is disabled by default and clamps polling to 15 minutes', () => {
  stopDefiMediaRssSchedulerForTests();
  const disabled = startDefiMediaRssScheduler({ config: {} });
  assert.equal(disabled.active, false);

  const scheduler = startDefiMediaRssScheduler({
    provider: {
      source: { id: 'mu-defimedia-rss' },
      poll: async () => ({}),
      getSnapshot: () => ({}),
    },
    config: {
      contextDefiMediaEnabled: true,
      contextDefiMediaPollMinutes: 5,
      contextDefiMediaRunOnStartup: false,
    },
  });
  assert.equal(scheduler.active, true);
  assert.equal(scheduler.intervalMinutes, 15);
  scheduler.stop();
});
