'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildJourneyDocumentId } = require('./journey-id');

const RETENTION_MS = 7 * 86400000;
const clone = value => JSON.parse(JSON.stringify(value));
function key(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function pointKey(point) {
  return key(JSON.stringify([point.recordedAt, Number(point.lat).toFixed(5), Number(point.lng).toFixed(5)]));
}

// A checksummed append-only log commits checkpoint, evidence and outbox together.
// Periodic snapshots compact the log without rewriting a week's GPS per packet.
// Keep this directory on persistent storage. Never put it in a public artifact.
class JourneyJournal {
  constructor(directory, { maxPoints = 25000, now = () => Date.now() } = {}) {
    this.directory = path.resolve(directory);
    this.maxPoints = maxPoints;
    this.now = now;
    this.cache = new Map();
    this.logCounts = new Map();
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  filename(imei) { return path.join(this.directory, `${key(String(imei))}.json`); }

  acquire() {
    const filename = path.join(this.directory, 'writer.lock');
    if (fs.existsSync(filename)) {
      const pid = Number(fs.readFileSync(filename, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('journey_journal_lock_invalid');
      try { process.kill(pid, 0); throw new Error('journey_journal_writer_already_running'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      fs.unlinkSync(filename);
    }
    fs.writeFileSync(filename, String(process.pid), { flag: 'wx', mode: 0o600 });
    this.lockFile = filename;
  }

  release() {
    if (this.lockFile && fs.readFileSync(this.lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(this.lockFile);
    this.lockFile = null;
  }

  read(imei) {
    if (!this.cache.has(imei)) {
      const filename = this.filename(imei);
      const value = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) :
        { version: 1, imei, checkpoint: null, points: {}, outbox: {}, homeIntervals: [] };
      if (value.version !== 1 || value.imei !== imei || !value.points || !value.outbox) {
        throw new Error('journey_journal_invalid');
      }
      const log = `${filename}.wal`;
      let count = 0;
      if (fs.existsSync(log)) {
        const lines = fs.readFileSync(log, 'utf8').split('\n');
        // An interrupted final append has no commit delimiter and was not ACKed.
        lines.pop();
        for (const line of lines) {
          const entry = JSON.parse(line);
          if (key(JSON.stringify(entry.change)) !== entry.checksum) throw new Error('journey_journal_checksum');
          if (entry.change.sequence <= (value.sequence || 0)) continue;
          if (entry.change.sequence !== (value.sequence || 0) + 1) throw new Error('journey_journal_sequence');
          for (const field of ['points', 'outbox']) {
            for (const id of entry.change[field]?.remove || []) delete value[field][id];
            Object.assign(value[field], entry.change[field]?.set || {});
          }
          Object.assign(value, entry.change.fields);
          value.sequence = entry.change.sequence;
          count++;
        }
      }
      this.logCounts.set(imei, count);
      this.cache.set(imei, value);
    }
    return clone(this.cache.get(imei));
  }

  write(imei, value) {
    const filename = this.filename(imei);
    const before = this.cache.get(imei);
    const change = { sequence: (before?.sequence || 0) + 1, fields: {} };
    for (const field of ['points', 'outbox']) {
      change[field] = { set: {}, remove: Object.keys(before?.[field] || {}).filter(id => !value[field][id]) };
      for (const [id, entry] of Object.entries(value[field])) {
        if (JSON.stringify(entry) !== JSON.stringify(before?.[field]?.[id])) change[field].set[id] = entry;
      }
    }
    for (const field of ['checkpoint', 'homeIntervals']) {
      if (JSON.stringify(value[field]) !== JSON.stringify(before?.[field])) change.fields[field] = value[field];
    }
    if (!fs.existsSync(filename)) this.snapshot(filename, before || value);
    const log = `${filename}.wal`;
    const newLog = !fs.existsSync(log);
    // Remove an uncommitted partial append before retrying this transaction.
    if (!newLog) {
      const size = fs.statSync(log).size;
      if (size) {
        const last = Buffer.alloc(1), check = fs.openSync(log, 'r');
        try { fs.readSync(check, last, 0, 1, size - 1); } finally { fs.closeSync(check); }
        if (last[0] !== 10) {
          const bytes = fs.readFileSync(log);
          fs.truncateSync(log, bytes.lastIndexOf(10) + 1);
        }
      }
    }
    const entry = JSON.stringify({ change, checksum: key(JSON.stringify(change)) }) + '\n';
    const fd = fs.openSync(log, 'a', 0o600);
    try { fs.writeFileSync(fd, entry); fs.fsyncSync(fd); }
    catch (error) { this.cache.delete(imei); throw error; }
    finally { fs.closeSync(fd); }
    if (newLog && process.platform !== 'win32') {
      const dir = fs.openSync(this.directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
    value.sequence = change.sequence;
    this.cache.set(imei, clone(value));
    const count = (this.logCounts.get(imei) || 0) + 1;
    this.logCounts.set(imei, count);
    if (count >= 512) {
      // The WAL is already committed. A failed compaction must not roll it back.
      try {
        this.snapshot(filename, value);
        fs.writeFileSync(log, '', { mode: 0o600 });
        this.logCounts.set(imei, 0);
      } catch (error) { console.error(`[journey-journal] compaction deferred: ${error.code || error.message}`); }
    }
  }

  snapshot(filename, value) {
    const temporary = `${filename}.tmp`;
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filename);
    // Windows does not support fsync on directories; the data file is synced.
    if (process.platform !== 'win32') {
      const dir = fs.openSync(this.directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  }

  record(imei, point, receivedAt, home = null) {
    const data = this.read(imei);
    const id = pointKey(point);
    if (data.points[id]) return id;
    const cutoff = this.now() - RETENTION_MS;
    for (const [k, p] of Object.entries(data.points)) {
      if (['live', 'home', 'recovered', 'reviewed_no_trip'].includes(p.status) && Date.parse(p.receivedAt) < cutoff) delete data.points[k];
    }
    // Pending evidence is never silently evicted on capacity pressure.
    if (Object.keys(data.points).length >= this.maxPoints) throw new Error('journey_journal_capacity');
    data.points[id] = { point, receivedAt: new Date(receivedAt).toISOString(), status: 'recorded' };
    if (home?.version === 4 && home.state === 'matched' && home.anchor) {
      const at = Date.parse(home.observedAt), expiry = Date.parse(home.expiresAt);
      if (Number.isFinite(at) && expiry > at && expiry <= at + 120000 &&
          !data.homeIntervals.some(h => h.observedAt === home.observedAt)) {
        data.homeIntervals.push(clone(home));
      }
    }
    data.homeIntervals = data.homeIntervals.filter(h => Date.parse(h.expiresAt) >= cutoff);
    this.write(imei, data);
    return id;
  }

  mark(imei, ids, status) {
    const data = this.read(imei);
    let changed = false;
    for (const id of ids) if (data.points[id] && data.points[id].status !== status) {
      data.points[id].status = status; changed = true;
    }
    if (changed) this.write(imei, data);
  }

  checkpoint(imei, state, journeys = []) {
    const data = this.read(imei);
    const fields = ['currentJourney', 'lastJourneyEndAt', 'lastConfirmedSafeZonePoint',
      'journeyResumeReference', 'journeyResumePending', 'lastPersistedLocation'];
    data.checkpoint = Object.fromEntries(fields.filter(k => state[k] !== undefined).map(k => [k, state[k]]));
    for (const journey of journeys) data.outbox[buildJourneyDocumentId(imei, journey)] = journey;
    this.write(imei, data);
  }

  queue(imei, journey) {
    const data = this.read(imei), id = buildJourneyDocumentId(imei, journey);
    if (!data.outbox[id]) { data.outbox[id] = journey; this.write(imei, data); }
    return id;
  }

  delivered(imei, id) {
    const data = this.read(imei);
    delete data.outbox[id];
    this.write(imei, data);
  }

  devices() {
    return fs.readdirSync(this.directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))
      .map(f => {
        const value = JSON.parse(fs.readFileSync(path.join(this.directory, f), 'utf8'));
        if (typeof value.imei !== 'string') throw new Error('journey_journal_invalid');
        return value.imei;
      });
  }
}

function restoreDates(value) {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return new Date(value);
  if (Array.isArray(value)) return value.map(restoreDates);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, restoreDates(v)]));
  return value;
}

module.exports = { JourneyJournal, pointKey, RETENTION_MS, restoreDates };
