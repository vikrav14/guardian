const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CapAlertProvider,
  matchAlertArea,
  parseCapAlert,
  parseRssFeed,
  refreshTemporalState,
} = require('../src/context/capAlertProvider');

const feedUrl = 'https://cap-sources.s3.amazonaws.com/mu-mms-en/rss.xml';
const alertUrl = 'https://cap-sources.s3.amazonaws.com/mu-mms-en/alert-123.xml';
const updateUrl = 'https://cap-sources.s3.amazonaws.com/mu-mms-en/alert-456.xml';

function rss(items = [{ link: alertUrl }]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <title>Mauritius Meteorological Services</title>
      <lastBuildDate>Wed, 19 Aug 2026 10:00:00 GMT</lastBuildDate>
      ${items.map((item) => `<item>
        <title>Heavy Rain Warning</title>
        <link>${item.link}</link>
        <guid>${item.link}</guid>
        <pubDate>Wed, 19 Aug 2026 10:00:00 GMT</pubDate>
      </item>`).join('')}
    </channel></rss>`;
}

function cap(overrides = {}) {
  const values = {
    identifier: 'alert-123',
    status: 'Actual',
    msgType: 'Alert',
    sent: '2026-08-19T10:00:00+04:00',
    effective: '2026-08-19T10:00:00+04:00',
    expires: '2026-08-19T16:00:00+04:00',
    event: 'Heavy Rain Warning',
    urgency: 'Expected',
    severity: 'Severe',
    certainty: 'Likely',
    areaDesc: 'Mauritius',
    polygon: '-20.50,57.10 -19.80,57.10 -19.80,58.00 -20.50,58.00 -20.50,57.10',
    references: '',
    ...overrides,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
    <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>${values.identifier}</identifier>
      <sender>mms@govmu.org</sender>
      <sent>${values.sent}</sent>
      <status>${values.status}</status>
      <msgType>${values.msgType}</msgType>
      <scope>Public</scope>
      ${values.references ? `<references>${values.references}</references>` : ''}
      <info>
        <language>en</language>
        <category>Met</category>
        <event>${values.event}</event>
        <urgency>${values.urgency}</urgency>
        <severity>${values.severity}</severity>
        <certainty>${values.certainty}</certainty>
        <effective>${values.effective}</effective>
        <expires>${values.expires}</expires>
        <headline>${values.event}</headline>
        <description>Official test warning.</description>
        <instruction>Keep away from flooded roads.</instruction>
        <area>
          <areaDesc>${values.areaDesc}</areaDesc>
          ${values.polygon ? `<polygon>${values.polygon}</polygon>` : ''}
        </area>
      </info>
    </alert>`;
}

test('RSS entries are parsed without treating headlines as full alert facts', () => {
  const parsed = parseRssFeed(rss());
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].link, alertUrl);
  assert.equal(parsed.items[0].title, 'Heavy Rain Warning');
});

test('CAP documents normalize official severity, expiry and geometry', () => {
  const alert = parseCapAlert(cap(), {
    rssItem: { link: alertUrl },
    now: new Date('2026-08-19T08:00:00.000Z'),
  });
  assert.equal(alert.active, true);
  assert.equal(alert.eventType, 'heavy_rain');
  assert.equal(alert.severity, 'severe');
  assert.equal(alert.source.authority, 'official_authority');
  assert.equal(matchAlertArea(alert, { lat: -20.16, lng: 57.5 }).matches, true);
  assert.equal(matchAlertArea(alert, { lat: -21, lng: 57.5 }).matches, false);
});

test('cancelled and expired CAP documents fail closed', () => {
  const cancelled = parseCapAlert(cap({ msgType: 'Cancel' }), {
    now: new Date('2026-08-19T08:00:00.000Z'),
  });
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.inactiveReason, 'cancelled');

  const expired = refreshTemporalState(
    parseCapAlert(cap(), { now: new Date('2026-08-19T08:00:00.000Z') }),
    new Date('2026-08-19T13:00:00.000Z')
  );
  assert.equal(expired.active, false);
  assert.equal(expired.inactiveReason, 'outside_effective_window');
});

test('marine warnings without geometry do not match an inland wearer by assumption', () => {
  const alert = parseCapAlert(cap({
    event: 'Heavy Swell Warning',
    areaDesc: 'Mauritius coastal waters',
    polygon: '',
  }), { now: new Date('2026-08-19T08:00:00.000Z') });
  const match = matchAlertArea(alert, { lat: -20.16, lng: 57.5 });
  assert.equal(match.matches, false);
  assert.equal(match.reason, 'coastal_context_required');
});

test('provider fetches full CAP, deduplicates unchanged feeds, and expires cached alerts', async () => {
  let feedCalls = 0;
  let capCalls = 0;
  const provider = new CapAlertProvider({}, {
    fetchText: async (url) => {
      if (url === feedUrl) {
        feedCalls += 1;
        return feedCalls === 1
          ? { statusCode: 200, headers: { etag: 'one' }, body: rss() }
          : { statusCode: 304, headers: {}, body: '' };
      }
      capCalls += 1;
      return { statusCode: 200, headers: {}, body: cap() };
    },
  });

  const first = await provider.poll({ now: new Date('2026-08-19T08:00:00.000Z') });
  const second = await provider.poll({ now: new Date('2026-08-19T08:05:00.000Z') });
  const expired = await provider.poll({ now: new Date('2026-08-19T13:00:00.000Z') });

  assert.equal(first.changedAlerts.length, 1);
  assert.equal(second.changedAlerts.length, 0);
  assert.equal(expired.changedAlerts.length, 1);
  assert.equal(expired.activeAlerts.length, 0);
  assert.equal(capCalls, 1);
});

test('missing feed entries require two successful snapshots before withdrawal', async () => {
  let feedCalls = 0;
  const provider = new CapAlertProvider({}, {
    fetchText: async (url) => {
      if (url !== feedUrl) return { statusCode: 200, headers: {}, body: cap() };
      feedCalls += 1;
      return {
        statusCode: 200,
        headers: {},
        body: feedCalls === 1 ? rss() : rss([]),
      };
    },
  });

  await provider.poll({ now: new Date('2026-08-19T08:00:00.000Z') });
  const firstMissing = await provider.poll({ now: new Date('2026-08-19T08:05:00.000Z') });
  const withdrawn = await provider.poll({ now: new Date('2026-08-19T08:10:00.000Z') });

  assert.equal(firstMissing.activeAlerts.length, 1);
  assert.equal(withdrawn.activeAlerts.length, 0);
  assert.equal(withdrawn.changedAlerts[0].inactiveReason, 'removed_from_authoritative_feed');
});

test('CAP update references retire the replaced alert immediately', async () => {
  let feedCalls = 0;
  const provider = new CapAlertProvider({}, {
    fetchText: async (url) => {
      if (url === feedUrl) {
        feedCalls += 1;
        return {
          statusCode: 200,
          headers: {},
          body: rss([{ link: feedCalls === 1 ? alertUrl : updateUrl }]),
        };
      }
      if (url === updateUrl) {
        return {
          statusCode: 200,
          headers: {},
          body: cap({
            identifier: 'alert-456',
            msgType: 'Update',
            references: 'mms@govmu.org,alert-123,2026-08-19T10:00:00+04:00',
          }),
        };
      }
      return { statusCode: 200, headers: {}, body: cap() };
    },
  });

  await provider.poll({ now: new Date('2026-08-19T08:00:00.000Z') });
  const updated = await provider.poll({ now: new Date('2026-08-19T08:05:00.000Z') });
  const original = updated.alerts.find((alert) => alert.externalId === 'alert-123');
  const replacement = updated.alerts.find((alert) => alert.externalId === 'alert-456');

  assert.equal(original.active, false);
  assert.equal(original.inactiveReason, 'superseded_by_update');
  assert.equal(replacement.active, true);
  assert.equal(updated.activeAlerts.length, 1);
});
