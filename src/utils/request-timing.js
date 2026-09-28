// Per-request timing for Canvas and Notion calls (see #61).
//
// A sync's duration is otherwise observable only as a single total, which says
// nothing about whether the time went on Canvas pagination, per-assignment
// submission fetches, Notion writes, or sitting in a rate limiter. This records
// one entry per HTTP attempt, keyed by the *shape* of the endpoint rather than
// the specific IDs, so repeated calls aggregate into a single row.
//
// Waiting is tracked separately from requesting: a rate limiter's pre-request
// delay and its retry backoff are time the sync spent throttled, not time spent
// waiting on the API, and reading them as the same number hides which one is
// actually slow.
//
// Everything here is diagnostics. It is logged through Debug, so it costs
// nothing when debug mode is off, and no call site is allowed to fail because
// timing failed. Loaded as a plain script (content scripts) and via
// side-effect import (service worker); access through globalThis, matching
// debug.js and canvas-hosts.js.

// Bounded so a long sync against an unusual Canvas instance can't grow the map
// without limit. Endpoints beyond the cap collapse into a single "other" row.
const MAX_TRACKED_ENDPOINTS = 40;
const OTHER_ENDPOINT = '(other)';

// Path segments that identify a specific record rather than a kind of record.
// Numeric Canvas IDs, Notion UUIDs (dashed or bare 32-hex).
const NUMERIC_ID_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARE_UUID_RE = /^[0-9a-f]{32}$/i;
// Canvas also accepts prefixed lookups, e.g. "sis_course_id:2257-CSC-413".
const PREFIXED_ID_RE = /^[a-z_]+:.+$/i;

/**
 * Reduce a URL (or a bare path) to the shape of its endpoint: no origin, no
 * query string, and every ID-like segment replaced with `:id`.
 *
 *   https://school.instructure.com/api/v1/courses/12345/assignments?per_page=100
 *     -> /api/v1/courses/:id/assignments
 *   https://api.notion.com/v1/pages/8a2b...  -> /v1/pages/:id
 *
 * Dropping the origin lets calls aggregate, and — since this ends up in a log —
 * also keeps the specific course, assignment, page, and database IDs out of it.
 * @param {string} urlString
 * @returns {string} normalised endpoint, or '(unknown)' when there is nothing to parse
 */
function normalizeEndpoint(urlString) {
  if (typeof urlString !== 'string' || urlString.trim() === '') return '(unknown)';

  let path = urlString.trim();

  // Strip the origin when there is one; otherwise treat the input as a path.
  const schemeEnd = path.indexOf('://');
  if (schemeEnd !== -1) {
    const afterScheme = path.slice(schemeEnd + 3);
    const slash = afterScheme.indexOf('/');
    path = slash === -1 ? '/' : afterScheme.slice(slash);
  }

  // Query and fragment carry per-request parameters, not endpoint identity.
  const queryStart = path.search(/[?#]/);
  if (queryStart !== -1) path = path.slice(0, queryStart);

  const segments = path.split('/').map((segment) => {
    if (segment === '') return segment;
    const decoded = safeDecode(segment);
    if (NUMERIC_ID_RE.test(decoded)) return ':id';
    if (UUID_RE.test(decoded) || BARE_UUID_RE.test(decoded)) return ':id';
    if (PREFIXED_ID_RE.test(decoded)) return ':id';
    return decoded;
  });

  const normalized = segments.join('/').replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    // A malformed escape sequence is not worth failing a diagnostic over.
    return segment;
  }
}

/**
 * Collects per-request timings for one sync run.
 *
 * Each instance belongs to a single API surface (one for Canvas in the content
 * script, one for Notion in the service worker), because the two run in
 * different contexts and cannot share memory.
 */
class RequestTimings {
  /**
   * @param {Object} [options]
   * @param {string} [options.label] - name used in the logged summary, e.g. 'Canvas'
   * @param {number} [options.maxEndpoints] - cap on distinct endpoint rows
   */
  constructor({ label = 'API', maxEndpoints = MAX_TRACKED_ENDPOINTS } = {}) {
    this.label = label;
    this.maxEndpoints = maxEndpoints > 0 ? maxEndpoints : MAX_TRACKED_ENDPOINTS;
    this.reset();
  }

  /** Start a fresh collection window. Called at the start of each sync. */
  reset() {
    this.endpoints = new Map();
    this.waits = new Map();
    this.startedAt = Date.now();
    this.totalCost = 0;
    this.minRemaining = null;
  }

  /**
   * Record one completed HTTP attempt — successful or not. A request retried by
   * a rate limiter records once per attempt, because each attempt is a request
   * the API actually served.
   *
   * @param {Object} entry
   * @param {string} [entry.url] - full URL; normalised to an endpoint shape
   * @param {string} [entry.endpoint] - pre-normalised endpoint, used instead of url
   * @param {number} entry.durationMs - wall time for the attempt
   * @param {number} [entry.status] - HTTP status, when one was received
   * @param {boolean} [entry.failed] - true when the attempt failed, whether it
   *   produced an error status or no response at all
   * @param {number} [entry.cost] - X-Request-Cost, when Canvas reported one
   * @param {number} [entry.remaining] - X-Rate-Limit-Remaining, when Canvas reported one
   */
  record(entry) {
    try {
      const { durationMs, status, failed, cost, remaining } = entry || {};
      const key = entry?.endpoint || normalizeEndpoint(entry?.url);
      const stats = this._statsFor(key);
      const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;

      stats.calls++;
      stats.totalMs += duration;
      if (duration > stats.maxMs) stats.maxMs = duration;

      const isError = failed === true || (Number.isFinite(status) && status >= 400);
      if (isError) stats.errors++;

      this._recordRateLimit(cost, remaining);
    } catch (error) {
      // Diagnostics must never take a sync down with them.
    }
  }

  /**
   * Record time deliberately spent not making a request: a rate limiter's
   * pre-request delay, or a backoff between retries.
   * @param {string} reason - coarse bucket, e.g. 'rate_limit_delay'
   * @param {number} ms
   */
  recordWait(reason, ms) {
    try {
      if (!Number.isFinite(ms) || ms <= 0) return;
      const key = typeof reason === 'string' && reason !== '' ? reason : 'unspecified';
      const existing = this.waits.get(key) || { count: 0, totalMs: 0 };
      existing.count++;
      existing.totalMs += ms;
      this.waits.set(key, existing);
    } catch (error) {
      // As above: never throw out of a diagnostic.
    }
  }

  /**
   * Fold in the rate-limit headers the Canvas limiter already parses, so budget
   * consumption is visible next to the timings that spent it.
   */
  _recordRateLimit(cost, remaining) {
    if (Number.isFinite(cost)) this.totalCost += cost;
    if (Number.isFinite(remaining)) {
      this.minRemaining = this.minRemaining === null
        ? remaining
        : Math.min(this.minRemaining, remaining);
    }
  }

  _statsFor(endpoint) {
    const existing = this.endpoints.get(endpoint);
    if (existing) return existing;

    // At the cap, everything further folds into one row rather than being
    // dropped, so the call count in the summary still adds up. That row is the
    // one entry allowed past the cap.
    if (this.endpoints.size >= this.maxEndpoints) {
      return this.endpoints.get(OTHER_ENDPOINT) || this._createStats(OTHER_ENDPOINT);
    }

    return this._createStats(endpoint);
  }

  _createStats(endpoint) {
    const stats = { endpoint, calls: 0, totalMs: 0, maxMs: 0, errors: 0 };
    this.endpoints.set(endpoint, stats);
    return stats;
  }

  /** True when nothing was recorded, so callers can skip an empty summary. */
  isEmpty() {
    return this.endpoints.size === 0 && this.waits.size === 0;
  }

  /**
   * A plain, serialisable snapshot. Serialisable matters: the Canvas summary is
   * collected in the content script and has to survive chrome.tabs.sendMessage
   * to be logged alongside the Notion one.
   * @returns {Object}
   */
  summary() {
    const endpoints = [...this.endpoints.values()]
      .map((stats) => ({
        endpoint: stats.endpoint,
        calls: stats.calls,
        totalMs: Math.round(stats.totalMs),
        averageMs: stats.calls > 0 ? Math.round(stats.totalMs / stats.calls) : 0,
        maxMs: Math.round(stats.maxMs),
        errors: stats.errors
      }))
      // Slowest first: the point of the summary is to name the expensive one.
      .sort((a, b) => b.totalMs - a.totalMs);

    const waits = [...this.waits.entries()]
      .map(([reason, stats]) => ({
        reason,
        count: stats.count,
        totalMs: Math.round(stats.totalMs)
      }))
      .sort((a, b) => b.totalMs - a.totalMs);

    return {
      label: this.label,
      requests: endpoints.reduce((sum, row) => sum + row.calls, 0),
      errors: endpoints.reduce((sum, row) => sum + row.errors, 0),
      requestMs: endpoints.reduce((sum, row) => sum + row.totalMs, 0),
      waitMs: waits.reduce((sum, row) => sum + row.totalMs, 0),
      totalCost: Math.round(this.totalCost * 100) / 100,
      minRemaining: this.minRemaining,
      endpoints,
      waits
    };
  }

  /**
   * Render a summary (this one, or a snapshot passed across a message boundary)
   * as lines ready for Debug.log.
   * @param {Object} [snapshot] - defaults to this instance's own summary()
   * @returns {Array<string>}
   */
  static formatSummary(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.endpoints)) return [];

    const lines = [
      `${snapshot.label} request timing: ${snapshot.requests} requests, ` +
      `${snapshot.requestMs}ms on requests, ${snapshot.waitMs}ms throttled` +
      (snapshot.errors > 0 ? `, ${snapshot.errors} failed` : '')
    ];

    for (const row of snapshot.endpoints) {
      lines.push(
        `  ${row.endpoint}: ${row.calls} calls, ${row.totalMs}ms total, ` +
        `${row.averageMs}ms avg, ${row.maxMs}ms max` +
        (row.errors > 0 ? `, ${row.errors} failed` : '')
      );
    }

    for (const row of snapshot.waits || []) {
      lines.push(`  wait/${row.reason}: ${row.count} waits, ${row.totalMs}ms total`);
    }

    if (Number.isFinite(snapshot.totalCost) && snapshot.totalCost > 0) {
      lines.push(`  rate-limit cost: ${snapshot.totalCost} units consumed`);
    }
    if (Number.isFinite(snapshot.minRemaining)) {
      lines.push(`  rate-limit budget low-water mark: ${snapshot.minRemaining}`);
    }

    return lines;
  }

  /**
   * Log a summary through Debug, which gates it on debug mode being on.
   * Accepts a snapshot so the service worker can log the Canvas summary the
   * content script collected.
   * @param {Object} [snapshot]
   */
  static logSummary(snapshot) {
    try {
      const lines = RequestTimings.formatSummary(snapshot);
      if (lines.length === 0) return;
      const debug = globalThis.Debug;
      if (!debug || typeof debug.log !== 'function') return;
      lines.forEach((line) => debug.log(line));
    } catch (error) {
      // Logging a diagnostic is never worth an exception.
    }
  }
}

// Make available as global for content scripts, popup, and the service worker.
if (typeof globalThis !== 'undefined') {
  globalThis.RequestTimings = RequestTimings;
  globalThis.normalizeEndpoint = normalizeEndpoint;
}
