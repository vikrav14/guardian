/**
 * Observe-only local-news source for Guardian context intelligence.
 *
 * Defi Media is corroborating local media, not an emergency authority. This
 * adapter fetches only its RSS feed, applies a conservative deterministic
 * safety prefilter, and never sends notifications or fetches article pages.
 */

const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { fetchText } = require('./capAlertProvider');
const Logger = require('../logger');

const logger = new Logger({ module: 'defimedia-rss-provider' });

const DEFI_MEDIA_SOURCE = Object.freeze({
  id: 'mu-defimedia-rss',
  name: 'Defi Media',
  authority: 'local_media',
  countryCode: 'MU',
  feedUrl: 'https://defimedia.info/rss.xml',
  allowedHosts: ['defimedia.info', 'www.defimedia.info'],
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

const EVENT_PATTERNS = Object.freeze([
  {
    eventType: 'road_disruption',
    patterns: [
      /\baccident\b/,
      /\bcollision\b/,
      /\bcarambolage\b/,
      /\broute (?:bloquee|fermee|impraticable)\b/,
      /\bdeviation routiere\b/,
      /\bembouteillage majeur\b/,
      /\btrafic (?:bloque|interrompu|perturbe)\b/,
    ],
  },
  {
    eventType: 'fire',
    patterns: [
      /\bincendie\b/,
      /\bfeu (?:ravage|maitrise|en cours)\b/,
      /\bproie des flammes\b/,
      /\bpompiers? mobilises?\b/,
    ],
  },
  {
    eventType: 'flood_or_landslide',
    patterns: [
      /\binondations?\b/,
      /\bcrue subite\b/,
      /\bglissement de terrain\b/,
      /\broute submergee\b/,
      /\bfortes pluies\b/,
      /\bpluies torrentielles\b/,
    ],
  },
  {
    eventType: 'public_safety',
    patterns: [
      /\bevacuation\b/,
      /\bexplosion\b/,
      /\bfuite de gaz\b/,
      /\bobjet suspect\b/,
      /\bperimetre de securite\b/,
      /\bdanger public\b/,
    ],
  },
  {
    eventType: 'school_disruption',
    patterns: [
      /\becoles? fermees?\b/,
      /\bfermeture des ecoles\b/,
      /\bcollege ferme\b/,
      /\bclasses suspendues\b/,
    ],
  },
  {
    eventType: 'infrastructure_disruption',
    patterns: [
      /\bcoupure d eau\b/,
      /\bcoupure d electricite\b/,
      /\bpanne (?:majeure|nationale)\b/,
      /\bpont ferme\b/,
      /\breseau (?:hors service|perturbe)\b/,
    ],
  },
  {
    eventType: 'health_hazard',
    patterns: [
      /\balerte sanitaire\b/,
      /\beau impropre a la consommation\b/,
      /\bintoxication alimentaire\b/,
      /\bcontamination\b/,
      /\bepidemie\b/,
    ],
  },
  {
    eventType: 'missing_vulnerable_person',
    patterns: [
      /\benfant (?:porte disparu|disparu|introuvable)\b/,
      /\bpersonne agee (?:portee disparue|disparue|introuvable)\b/,
      /\bappel a temoins\b.*\bdispar/,
    ],
  },
]);

const EXCLUDED_SECTION_PATTERNS = Object.freeze([
  /\bpolitique\b/,
  /\binterview\b/,
  /\bblog\b/,
  /\bsports?\b/,
  /\bbollywood\b/,
  /\bpeople\b/,
  /\bmagazine\b/,
  /\beconomie\b/,
]);

// This is deliberately a recognition list, not a geocoder. Impact matching
// must resolve these labels separately and fail closed when a place is vague.
const MAURITIUS_PLACE_ALIASES = Object.freeze([
  ['Port Louis', ['port louis']],
  ['Grand Baie', ['grand baie', 'grand bay']],
  ['Lower Vale', ['lower vale']],
  ['Pereybere', ['pereybere']],
  ['Goodlands', ['goodlands']],
  ['Petit Raffray', ['petit raffray']],
  ['Riviere du Rempart', ['riviere du rempart']],
  ['Pamplemousses', ['pamplemousses']],
  ['Triolet', ['triolet']],
  ['Calebasses', ['calebasses']],
  ['Terre Rouge', ['terre rouge']],
  ['Baie du Tombeau', ['baie du tombeau']],
  ['Beau Bassin', ['beau bassin']],
  ['Rose Hill', ['rose hill']],
  ['Quatre Bornes', ['quatre bornes']],
  ['Vacoas', ['vacoas']],
  ['Phoenix', ['phoenix']],
  ['Curepipe', ['curepipe']],
  ['Moka', ['moka']],
  ['Saint Pierre', ['saint pierre', 'st pierre']],
  ['Flacq', ['centre de flacq', 'central flacq', 'flacq']],
  ['Belle Mare', ['belle mare']],
  ['Mahebourg', ['mahebourg']],
  ['Plaine Magnien', ['plaine magnien']],
  ['Rose Belle', ['rose belle']],
  ['Souillac', ['souillac']],
  ['Bel Air Riviere Seche', ['bel air riviere seche', 'bel air']],
  ['Bel Etang', ['bel etang']],
  ['Nouvelle France', ['nouvelle france']],
  ['Roche Bois', ['roche bois']],
  ['La Cure', ['la cure']],
  ['Flic en Flac', ['flic en flac']],
  ['Tamarin', ['tamarin']],
  ['Black River', ['black river', 'riviere noire']],
  ['Le Morne', ['le morne']],
]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object' && value['#text'] != null) {
    return String(value['#text']).trim();
  }
  return '';
}

function stripMarkup(value) {
  return textValue(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function bounded(value, maxLength) {
  return stripMarkup(value).slice(0, maxLength);
}

function normalizeForMatch(value) {
  return stripMarkup(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isoDate(value) {
  const raw = textValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeSourceUrl(value, allowedHosts = DEFI_MEDIA_SOURCE.allowedHosts) {
  try {
    const url = new URL(value);
    if (!allowedHosts.includes(url.hostname)) return null;
    if (url.protocol === 'http:') {
      // Defi Media's RSS currently emits same-site HTTP article links even
      // though the public site supports HTTPS. Upgrade only allowlisted hosts;
      // never relax the host boundary or return an insecure source URL.
      url.protocol = 'https:';
    } else if (url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) return null;
    url.port = '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function parseDefiMediaFeed(xml) {
  const parsed = xmlParser.parse(String(xml || ''));
  const channel = parsed?.rss?.channel;
  if (!channel) throw new Error('Defi Media source did not return a valid RSS channel');
  return {
    title: bounded(channel.title, 200),
    lastBuildAt: isoDate(channel.lastBuildDate || channel.pubDate),
    items: asArray(channel.item).map((item) => ({
      title: bounded(item?.title, 500),
      description: bounded(item?.description, 3000),
      link: textValue(item?.link),
      guid: textValue(item?.guid),
      publishedAt: isoDate(item?.pubDate),
      author: bounded(item?.author || item?.creator, 200),
      categories: asArray(item?.category).map((category) => bounded(category, 100)).filter(Boolean),
    })).filter((item) => item.title && item.link),
  };
}

function extractPlaceMentions(value) {
  const normalized = ` ${normalizeForMatch(value)} `;
  return MAURITIUS_PLACE_ALIASES.filter(([, aliases]) => aliases.some((alias) => (
    normalized.includes(` ${normalizeForMatch(alias)} `)
  ))).map(([name]) => name);
}

function classifySafetyCandidate(item) {
  const categoryText = normalizeForMatch((item.categories || []).join(' '));
  const text = normalizeForMatch(`${item.title || ''} ${item.description || ''}`);
  const excludedSection = EXCLUDED_SECTION_PATTERNS.some((pattern) => pattern.test(categoryText));
  const matches = EVENT_PATTERNS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)));
  const eventTypes = matches.map((match) => match.eventType);
  const placeMentions = extractPlaceMentions(text);
  const safetyCandidate = !excludedSection && eventTypes.length > 0;
  return {
    safetyCandidate,
    eventType: safetyCandidate ? eventTypes[0] : 'other',
    eventTypes: safetyCandidate ? eventTypes : [],
    placeMentions,
    classification: 'deterministic_prefilter',
    reason: excludedSection
      ? 'excluded_editorial_section'
      : (eventTypes.length ? 'safety_keyword_match' : 'no_safety_signal'),
  };
}

function normalizeFeedItem(item, {
  source = DEFI_MEDIA_SOURCE,
  now = new Date(),
  maxAgeHours = 24,
} = {}) {
  const sourceUrl = safeSourceUrl(item.link, source.allowedHosts);
  if (!sourceUrl) return null;
  const publishedAt = item.publishedAt || null;
  const publishedMs = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;
  const ageHours = Number.isFinite(publishedMs)
    ? Math.max(0, (now.getTime() - publishedMs) / 3_600_000)
    : null;
  const classification = classifySafetyCandidate(item);
  const externalId = item.guid || sourceUrl;
  const normalized = {
    version: 1,
    id: `${source.id}:${sha256(externalId).slice(0, 32)}`,
    documentId: sha256(`${source.id}:${externalId}`).slice(0, 40),
    externalId: bounded(externalId, 1000),
    source: {
      id: source.id,
      name: source.name,
      authority: source.authority,
      countryCode: source.countryCode,
      feedUrl: source.feedUrl,
    },
    sourceUrl,
    title: bounded(item.title, 500),
    summary: bounded(item.description, 3000),
    author: bounded(item.author, 200),
    categories: (item.categories || []).map((category) => bounded(category, 100)),
    publishedAt,
    observedAt: now.toISOString(),
    ageHours,
    fresh: ageHours != null && ageHours <= maxAgeHours,
    ...classification,
    observeOnly: true,
    deliveryEligible: false,
    deliverySent: false,
  };
  normalized.contentHash = sha256(JSON.stringify({
    title: normalized.title,
    summary: normalized.summary,
    categories: normalized.categories,
    publishedAt: normalized.publishedAt,
    classification,
  }));
  return normalized;
}

class DefiMediaRssProvider {
  constructor(config = {}, dependencies = {}) {
    this.source = {
      ...DEFI_MEDIA_SOURCE,
      feedUrl: config.contextDefiMediaFeedUrl || DEFI_MEDIA_SOURCE.feedUrl,
    };
    const feedHost = new URL(this.source.feedUrl).hostname;
    this.source.allowedHosts = Array.from(new Set([...DEFI_MEDIA_SOURCE.allowedHosts, feedHost]));
    this.maxItems = Math.max(1, Math.min(200, Number(config.contextDefiMediaMaxItems || 100)));
    this.maxAgeHours = Math.max(1, Number(config.contextDefiMediaMaxAgeHours || 24));
    this.fetchText = dependencies.fetchText || fetchText;
    this.records = new Map();
    this.etag = null;
    this.lastModified = null;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
  }

  async poll({ now = new Date() } = {}) {
    this.lastPollAt = now.toISOString();
    const headers = {
      Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
      'User-Agent': 'Guardian-Mauritius/1.0 (+observe-only-local-awareness)',
    };
    if (this.etag) headers['If-None-Match'] = this.etag;
    if (this.lastModified) headers['If-Modified-Since'] = this.lastModified;

    try {
      const response = await this.fetchText(this.source.feedUrl, {
        headers,
        allowedHosts: this.source.allowedHosts,
        maxBytes: 1_000_000,
      });
      if (response.statusCode === 304) {
        this.lastSuccessAt = now.toISOString();
        this.lastError = null;
        return this._result([], true);
      }

      this.etag = response.headers?.etag || this.etag;
      this.lastModified = response.headers?.['last-modified'] || this.lastModified;
      const feed = parseDefiMediaFeed(response.body);
      const changedItems = [];
      for (const item of feed.items.slice(0, this.maxItems)) {
        const normalized = normalizeFeedItem(item, {
          source: this.source,
          now,
          maxAgeHours: this.maxAgeHours,
        });
        if (!normalized) {
          logger.warn('Ignored Defi Media item outside the trusted host allowlist', {
            link: item.link,
          });
          continue;
        }
        const previous = this.records.get(normalized.id);
        this.records.set(normalized.id, normalized);
        if (!previous || previous.contentHash !== normalized.contentHash) {
          changedItems.push(normalized);
        }
      }

      // Keep memory bounded while retaining the newest feed records for
      // process-lifetime deduplication and operational inspection.
      const newest = Array.from(this.records.values())
        .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
        .slice(0, this.maxItems * 2);
      this.records = new Map(newest.map((item) => [item.id, item]));
      this.lastSuccessAt = now.toISOString();
      this.lastError = null;
      return this._result(changedItems, false, feed);
    } catch (error) {
      this.lastError = error.message;
      logger.error('Defi Media RSS poll failed', { error: error.message });
      return { ...this._result([], false), ok: false, error: error.message };
    }
  }

  _result(changedItems, notModified, feed = null) {
    const items = Array.from(this.records.values());
    const candidateItems = items.filter((item) => item.safetyCandidate && item.fresh);
    return {
      ok: true,
      source: this.source.id,
      notModified,
      feed,
      items,
      candidateItems,
      changedItems,
      changedCandidates: changedItems.filter((item) => item.safetyCandidate && item.fresh),
      observeOnly: true,
      automaticDelivery: false,
    };
  }

  getSnapshot() {
    const items = Array.from(this.records.values());
    const candidates = items.filter((item) => item.safetyCandidate && item.fresh);
    return {
      source: {
        id: this.source.id,
        name: this.source.name,
        authority: this.source.authority,
        feedUrl: this.source.feedUrl,
      },
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      totalRecords: items.length,
      freshCandidates: candidates.length,
      recentCandidates: candidates
        .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
        .slice(0, 10),
      observeOnly: true,
      automaticDelivery: false,
    };
  }
}

module.exports = {
  DEFI_MEDIA_SOURCE,
  DefiMediaRssProvider,
  classifySafetyCandidate,
  extractPlaceMentions,
  normalizeFeedItem,
  normalizeForMatch,
  parseDefiMediaFeed,
  safeSourceUrl,
};
