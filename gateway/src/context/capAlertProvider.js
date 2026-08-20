/**
 * Official Common Alerting Protocol (CAP) source for Guardian context.
 *
 * The WMO Register of Alerting Authorities lists the default feed below for
 * Mauritius Meteorological Services. Feed entries point to complete CAP XML
 * documents; RSS headlines alone are never treated as safety facts.
 */

const crypto = require('crypto');
const https = require('https');
const { XMLParser } = require('fast-xml-parser');
const Logger = require('../logger');

const logger = new Logger({ module: 'cap-alert-provider' });

const MMS_CAP_SOURCE = Object.freeze({
  id: 'mu-mms-en',
  name: 'Mauritius Meteorological Services',
  authority: 'official_authority',
  countryCode: 'MU',
  feedUrl: 'https://cap-sources.s3.amazonaws.com/mu-mms-en/rss.xml',
  allowedHosts: ['cap-sources.s3.amazonaws.com'],
  categories: ['Geo', 'Met'],
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

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

function bounded(value, maxLength) {
  return textValue(value).replace(/\s+/g, ' ').slice(0, maxLength);
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

function contentHashFor(alert) {
  return sha256(JSON.stringify({
    ...alert,
    observedAt: undefined,
    documentId: undefined,
    contentHash: undefined,
    missingPolls: undefined,
  }));
}

function normalizeToken(value) {
  return textValue(value).trim().toLowerCase().replace(/[\s_-]+/g, '_');
}

function normalizeEventType(eventName) {
  const value = normalizeToken(eventName);
  if (/tsunami/.test(value)) return 'tsunami';
  if (/storm_surge/.test(value)) return 'storm_surge';
  if (/(heavy_swell|high_wave|high_swell|rough_sea)/.test(value)) return 'heavy_swell';
  if (/(torrential_rain|heavy_rain|flash_flood|flood)/.test(value)) return 'heavy_rain';
  if (/(tropical_cyclone|cyclone|tropical_storm)/.test(value)) return 'cyclone';
  if (/(strong_wind|gale|wind_warning)/.test(value)) return 'strong_wind';
  if (/thunderstorm/.test(value)) return 'thunderstorm';
  if (/landslide/.test(value)) return 'landslide';
  return value || 'official_warning';
}

function parseRssFeed(xml) {
  const parsed = xmlParser.parse(String(xml || ''));
  const channel = parsed?.rss?.channel;
  if (!channel) throw new Error('CAP source did not return a valid RSS channel');
  return {
    title: bounded(channel.title, 200),
    lastBuildAt: isoDate(channel.lastBuildDate || channel.pubDate),
    items: asArray(channel.item).map((item) => ({
      title: bounded(item?.title, 500),
      description: bounded(item?.description, 2000),
      link: textValue(item?.link),
      guid: textValue(item?.guid),
      publishedAt: isoDate(item?.pubDate),
    })).filter((item) => item.link),
  };
}

function parseGeocode(value) {
  const entries = asArray(value);
  const result = {};
  for (const entry of entries) {
    const key = bounded(entry?.valueName, 100);
    const itemValue = bounded(entry?.value, 300);
    if (key && itemValue) result[key] = itemValue;
  }
  return result;
}

function parseArea(area) {
  return {
    description: bounded(area?.areaDesc, 500),
    polygons: asArray(area?.polygon).map(textValue).filter(Boolean),
    circles: asArray(area?.circle).map(textValue).filter(Boolean),
    geocodes: parseGeocode(area?.geocode),
    altitude: textValue(area?.altitude) || null,
    ceiling: textValue(area?.ceiling) || null,
  };
}

function selectInfo(alert) {
  const infos = asArray(alert?.info);
  return infos.find((info) => /^en(?:-|$)/i.test(textValue(info?.language))) || infos[0] || {};
}

function parseReferenceIds(references) {
  return textValue(references)
    .split(/\s+/)
    .map((reference) => reference.split(',')[1])
    .filter(Boolean)
    .slice(0, 50);
}

function parseCapAlert(xml, { rssItem = {}, source = MMS_CAP_SOURCE, now = new Date() } = {}) {
  const parsed = xmlParser.parse(String(xml || ''));
  const alert = parsed?.alert;
  if (!alert) throw new Error('Feed entry did not return a CAP alert document');

  const info = selectInfo(alert);
  const externalId = bounded(alert.identifier, 500);
  if (!externalId) throw new Error('CAP alert is missing its identifier');

  const status = normalizeToken(alert.status);
  const messageType = normalizeToken(alert.msgType);
  const scope = normalizeToken(alert.scope);
  const sentAt = isoDate(alert.sent) || rssItem.publishedAt || null;
  const effectiveAt = isoDate(info.effective || info.onset) || sentAt;
  const expiresAt = isoDate(info.expires);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const effectiveMs = effectiveAt ? new Date(effectiveAt).getTime() : Number.NaN;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const isTimeActive = Number.isFinite(expiresMs) && expiresMs > nowMs &&
    (!Number.isFinite(effectiveMs) || effectiveMs <= nowMs);
  const active = status === 'actual' && messageType !== 'cancel' && isTimeActive;
  const areas = asArray(info.area).map(parseArea).filter((area) => (
    area.description || area.polygons.length || area.circles.length
  ));

  const normalized = {
    version: 1,
    id: `${source.id}:${externalId}`,
    documentId: sha256(`${source.id}:${externalId}`).slice(0, 40),
    externalId,
    source: {
      id: source.id,
      name: source.name,
      authority: source.authority,
      countryCode: source.countryCode,
      feedUrl: source.feedUrl,
    },
    sourceUrl: rssItem.link || source.feedUrl,
    status,
    messageType,
    scope,
    sentAt,
    effectiveAt,
    expiresAt,
    active,
    inactiveReason: active
      ? null
      : (messageType === 'cancel' ? 'cancelled' : (status !== 'actual' ? `status_${status || 'unknown'}` : 'outside_effective_window')),
    event: bounded(info.event || rssItem.title, 300),
    eventType: normalizeEventType(info.event || rssItem.title),
    headline: bounded(info.headline || rssItem.title, 500),
    description: bounded(info.description || rssItem.description, 4000),
    instruction: bounded(info.instruction, 2000),
    language: bounded(info.language || 'en', 20),
    category: asArray(info.category).map((item) => bounded(item, 50)).filter(Boolean),
    responseTypes: asArray(info.responseType).map(normalizeToken).filter(Boolean),
    urgency: normalizeToken(info.urgency) || 'unknown',
    severity: normalizeToken(info.severity) || 'unknown',
    certainty: normalizeToken(info.certainty) || 'unknown',
    areas,
    references: parseReferenceIds(alert.references),
    observedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
  };
  normalized.contentHash = contentHashFor(normalized);
  return normalized;
}

function refreshTemporalState(alert, now = new Date(), { resetMissingPolls = true } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const effectiveMs = alert.effectiveAt ? new Date(alert.effectiveAt).getTime() : Number.NaN;
  const expiresMs = alert.expiresAt ? new Date(alert.expiresAt).getTime() : Number.NaN;
  const timeActive = Number.isFinite(expiresMs) && expiresMs > nowMs &&
    (!Number.isFinite(effectiveMs) || effectiveMs <= nowMs);
  const active = alert.status === 'actual' && alert.messageType !== 'cancel' && timeActive;
  const refreshed = {
    ...alert,
    active,
    inactiveReason: active
      ? null
      : (alert.messageType === 'cancel'
        ? 'cancelled'
        : (alert.status !== 'actual'
          ? `status_${alert.status || 'unknown'}`
          : 'outside_effective_window')),
    observedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    missingPolls: resetMissingPolls ? 0 : Number(alert.missingPolls || 0),
  };
  refreshed.contentHash = contentHashFor(refreshed);
  return refreshed;
}

function parseLatLng(value) {
  const [lat, lng] = String(value || '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parsePolygon(value) {
  return String(value || '').trim().split(/\s+/).map(parseLatLng).filter(Boolean);
}

function pointInPolygon(point, polygon) {
  if (!point || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const crosses = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceKm(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseCircle(value) {
  const parts = String(value || '').trim().split(/\s+/);
  const center = parseLatLng(parts[0]);
  const radiusKm = Number(parts[1]);
  return center && Number.isFinite(radiusKm) && radiusKm >= 0
    ? { center, radiusKm }
    : null;
}

function inMainMauritius(point) {
  return point.lat >= -20.60 && point.lat <= -19.83 &&
    point.lng >= 57.12 && point.lng <= 57.99;
}

function matchAlertArea(alert, location) {
  const point = parseLatLng(`${location?.lat},${location?.lng}`);
  if (!point) return { matches: false, confidence: 'none', reason: 'invalid_location' };

  for (const area of alert?.areas || []) {
    for (const polygonValue of area.polygons || []) {
      if (pointInPolygon(point, parsePolygon(polygonValue))) {
        return { matches: true, confidence: 'exact', reason: 'inside_cap_polygon' };
      }
    }
    for (const circleValue of area.circles || []) {
      const circle = parseCircle(circleValue);
      if (circle && distanceKm(point, circle.center) <= circle.radiusKm) {
        return { matches: true, confidence: 'exact', reason: 'inside_cap_circle' };
      }
    }
  }

  const descriptions = (alert?.areas || []).map((area) => area.description.toLowerCase()).join(' ');
  const hasGeometry = (alert?.areas || []).some((area) => area.polygons.length || area.circles.length);
  if (hasGeometry) return { matches: false, confidence: 'exact', reason: 'outside_cap_geometry' };

  // Island-wide marine warnings still require coastal/activity context. A
  // wearer merely being somewhere in Mauritius is not enough evidence.
  if (['heavy_swell', 'storm_surge', 'tsunami'].includes(alert?.eventType)) {
    return { matches: false, confidence: 'unknown', reason: 'coastal_context_required' };
  }
  if (/\bmauritius\b|\bmain island\b/.test(descriptions) && inMainMauritius(point)) {
    return { matches: true, confidence: 'area', reason: 'mauritius_area_description' };
  }
  return { matches: false, confidence: 'unknown', reason: 'area_not_machine_resolvable' };
}

function safeUrl(value, allowedHosts) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function fetchText(url, {
  headers = {},
  allowedHosts = [],
  timeoutMs = 10_000,
  maxBytes = 1_000_000,
  redirects = 0,
} = {}) {
  const safe = safeUrl(url, allowedHosts);
  if (!safe) return Promise.reject(new Error('CAP URL is outside the trusted source allowlist'));
  return new Promise((resolve, reject) => {
    const request = https.get(safe, { headers }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 2) return reject(new Error('CAP source redirected too many times'));
        const target = new URL(response.headers.location, safe).toString();
        return resolve(fetchText(target, {
          headers,
          allowedHosts,
          timeoutMs,
          maxBytes,
          redirects: redirects + 1,
        }));
      }
      if (response.statusCode === 304) {
        response.resume();
        return resolve({ statusCode: 304, headers: response.headers, body: '' });
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`CAP source returned HTTP ${response.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('CAP source response exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode: 200,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('CAP source request timed out')));
    request.on('error', reject);
  });
}

class CapAlertProvider {
  constructor(config = {}, dependencies = {}) {
    this.source = {
      ...MMS_CAP_SOURCE,
      feedUrl: config.contextCapFeedUrl || MMS_CAP_SOURCE.feedUrl,
    };
    const feedHost = new URL(this.source.feedUrl).hostname;
    this.source.allowedHosts = Array.from(new Set([...MMS_CAP_SOURCE.allowedHosts, feedHost]));
    this.maxItems = Math.max(1, Math.min(100, Number(config.contextCapMaxItems || 50)));
    this.fetchText = dependencies.fetchText || fetchText;
    this.records = new Map();
    this.itemCache = new Map();
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
      'User-Agent': 'Guardian-Mauritius/1.0 (+family-safety-context)',
    };
    if (this.etag) headers['If-None-Match'] = this.etag;
    if (this.lastModified) headers['If-Modified-Since'] = this.lastModified;

    try {
      const response = await this.fetchText(this.source.feedUrl, {
        headers,
        allowedHosts: this.source.allowedHosts,
        maxBytes: 512_000,
      });
      if (response.statusCode === 304) {
        const changed = [];
        for (const [id, record] of this.records.entries()) {
          const refreshed = refreshTemporalState(record, now, { resetMissingPolls: false });
          this.records.set(id, refreshed);
          if (refreshed.contentHash !== record.contentHash) changed.push(refreshed);
        }
        this.lastSuccessAt = now.toISOString();
        this.lastError = null;
        return this._result(changed, true);
      }
      this.etag = response.headers?.etag || this.etag;
      this.lastModified = response.headers?.['last-modified'] || this.lastModified;
      const feed = parseRssFeed(response.body);
      const items = feed.items.slice(0, this.maxItems);
      const changed = [];
      const presentUrls = new Set(items.map((item) => item.link));
      const referencedRetirements = new Map();

      for (const item of items) {
        const capUrl = safeUrl(item.link, this.source.allowedHosts);
        if (!capUrl) {
          logger.warn('Ignored CAP item outside trusted host allowlist', { link: item.link });
          continue;
        }
        const itemKey = `${item.guid}|${item.publishedAt}|${capUrl}`;
        let normalized = this.itemCache.get(itemKey);
        if (!normalized) {
          const capResponse = await this.fetchText(capUrl, {
            headers: {
              Accept: 'application/cap+xml, application/xml;q=0.9, text/xml;q=0.8',
              'User-Agent': headers['User-Agent'],
            },
            allowedHosts: this.source.allowedHosts,
          });
          normalized = parseCapAlert(capResponse.body, {
            rssItem: { ...item, link: capUrl },
            source: this.source,
            now,
          });
          this.itemCache.set(itemKey, normalized);
        } else {
          normalized = refreshTemporalState(normalized, now);
          this.itemCache.set(itemKey, normalized);
        }
        const previous = this.records.get(normalized.id);
        normalized.missingPolls = 0;
        this.records.set(normalized.id, normalized);
        if (!previous || previous.contentHash !== normalized.contentHash) changed.push(normalized);
        if (['update', 'cancel'].includes(normalized.messageType)) {
          for (const referenceId of normalized.references || []) {
            referencedRetirements.set(
              referenceId,
              normalized.messageType === 'cancel'
                ? 'cancelled_by_reference'
                : 'superseded_by_update'
            );
          }
        }
      }

      // CAP Update/Cancel documents explicitly reference the alert they
      // replace. Honour that relationship immediately instead of waiting for
      // two missing-feed snapshots.
      for (const [externalId, inactiveReason] of referencedRetirements.entries()) {
        const id = `${this.source.id}:${externalId}`;
        const record = this.records.get(id);
        if (!record?.active) continue;
        const retired = {
          ...record,
          active: false,
          inactiveReason,
          observedAt: now.toISOString(),
        };
        retired.contentHash = contentHashFor(retired);
        this.records.set(id, retired);
        changed.push(retired);
      }

      // Treat disappearance as a withdrawal only after two complete successful
      // feed snapshots. This avoids inventing an all-clear from one bad poll.
      for (const [id, record] of this.records.entries()) {
        if (presentUrls.has(record.sourceUrl) || !record.active) continue;
        const missingPolls = Number(record.missingPolls || 0) + 1;
        if (missingPolls < 2) {
          this.records.set(id, { ...record, missingPolls });
          continue;
        }
        const withdrawn = {
          ...record,
          active: false,
          inactiveReason: 'removed_from_authoritative_feed',
          observedAt: now.toISOString(),
          missingPolls,
        };
        withdrawn.contentHash = contentHashFor(withdrawn);
        this.records.set(id, withdrawn);
        changed.push(withdrawn);
      }

      this.lastSuccessAt = now.toISOString();
      this.lastError = null;
      return this._result(changed, false, feed);
    } catch (error) {
      this.lastError = error.message;
      logger.error('Official CAP poll failed', { source: this.source.id, error: error.message });
      return { ...this._result([], false), ok: false, error: error.message };
    }
  }

  getApplicableAlerts(location, { now = new Date() } = {}) {
    const nowMs = now.getTime();
    return Array.from(this.records.values()).filter((alert) => {
      if (!alert.active || alert.status !== 'actual') return false;
      if (alert.expiresAt && new Date(alert.expiresAt).getTime() <= nowMs) return false;
      return matchAlertArea(alert, location).matches;
    }).map((alert) => ({
      ...alert,
      applicability: matchAlertArea(alert, location),
    }));
  }

  _result(changed, notModified, feed = null) {
    const alerts = Array.from(this.records.values());
    return {
      ok: true,
      source: this.source.id,
      notModified,
      feed,
      alerts,
      activeAlerts: alerts.filter((alert) => alert.active),
      changedAlerts: changed,
    };
  }

  getSnapshot() {
    const alerts = Array.from(this.records.values());
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
      totalRecords: alerts.length,
      activeAlerts: alerts.filter((alert) => alert.active),
    };
  }
}

module.exports = {
  CapAlertProvider,
  MMS_CAP_SOURCE,
  fetchText,
  matchAlertArea,
  normalizeEventType,
  parseCapAlert,
  parseRssFeed,
  pointInPolygon,
  refreshTemporalState,
};
