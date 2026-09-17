import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

// Issue #61: a sync's duration is only actionable if it can be attributed to
// particular endpoints, and if time spent throttled is distinguishable from
// time spent waiting on the API.
describe('request timing', () => {
  let RequestTimings, normalizeEndpoint;

  beforeAll(async () => {
    await import('../src/utils/request-timing.js');
    ({ RequestTimings, normalizeEndpoint } = globalThis);
  });

  describe('normalizeEndpoint', () => {
    test('strips the origin so calls to any Canvas instance aggregate', () => {
      expect(normalizeEndpoint('https://school.instructure.com/api/v1/courses'))
        .toBe('/api/v1/courses');
      expect(normalizeEndpoint('https://other.canvaslms.com/api/v1/courses'))
        .toBe('/api/v1/courses');
    });

    test('replaces numeric Canvas IDs with :id', () => {
      expect(normalizeEndpoint('https://school.instructure.com/api/v1/courses/12345/assignments'))
        .toBe('/api/v1/courses/:id/assignments');
    });

    test('collapses different IDs of the same endpoint to one key', () => {
      const a = normalizeEndpoint('/api/v1/courses/1/assignments/9/submissions/self');
      const b = normalizeEndpoint('/api/v1/courses/2/assignments/8/submissions/self');
      expect(a).toBe(b);
      // "self" is a real endpoint segment, not an ID — it must survive.
      expect(a).toBe('/api/v1/courses/:id/assignments/:id/submissions/self');
    });

    test('replaces dashed and bare Notion UUIDs with :id', () => {
      expect(normalizeEndpoint('https://api.notion.com/v1/pages/1f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f'))
        .toBe('/v1/pages/:id');
      expect(normalizeEndpoint('https://api.notion.com/v1/pages/1f0c1d2e3a4b4c5d8e9f0a1b2c3d4e5f'))
        .toBe('/v1/pages/:id');
    });

    test('replaces Canvas prefixed IDs (sis_course_id:...)', () => {
      expect(normalizeEndpoint('/api/v1/courses/sis_course_id:2257-CSC-413/assignments'))
        .toBe('/api/v1/courses/:id/assignments');
    });

    test('drops the query string, so paged calls share one key', () => {
      expect(normalizeEndpoint('/api/v1/courses?per_page=100&page=2')).toBe('/api/v1/courses');
      expect(normalizeEndpoint('/api/v1/courses#frag')).toBe('/api/v1/courses');
    });

    test('handles a URL with no path, a trailing slash, and junk input', () => {
      expect(normalizeEndpoint('https://api.notion.com')).toBe('/');
      expect(normalizeEndpoint('/api/v1/courses/')).toBe('/api/v1/courses');
      expect(normalizeEndpoint('')).toBe('(unknown)');
      expect(normalizeEndpoint(null)).toBe('(unknown)');
      expect(normalizeEndpoint(undefined)).toBe('(unknown)');
    });

    test('does not throw on a malformed percent escape', () => {
      expect(() => normalizeEndpoint('/api/v1/courses/%E0%A4%A')).not.toThrow();
    });
  });

  describe('RequestTimings aggregation', () => {
    let timings;

    beforeEach(() => {
      timings = new RequestTimings({ label: 'Canvas' });
    });

    test('a fresh instance is empty', () => {
      expect(timings.isEmpty()).toBe(true);
      expect(timings.summary().requests).toBe(0);
    });

    test('aggregates call count, total, average, and max per endpoint', () => {
      timings.record({ url: '/api/v1/courses/1/assignments', durationMs: 100, status: 200 });
      timings.record({ url: '/api/v1/courses/2/assignments', durationMs: 300, status: 200 });
      timings.record({ url: '/api/v1/courses', durationMs: 50, status: 200 });

      const summary = timings.summary();
      expect(summary.requests).toBe(3);
      expect(summary.requestMs).toBe(450);

      // Slowest endpoint first — the point of the summary is to name it.
      expect(summary.endpoints[0]).toEqual({
        endpoint: '/api/v1/courses/:id/assignments',
        calls: 2,
        totalMs: 400,
        averageMs: 200,
        maxMs: 300,
        errors: 0
      });
      expect(summary.endpoints[1].endpoint).toBe('/api/v1/courses');
    });

    test('counts an error status as a failed call without losing its duration', () => {
      timings.record({ url: '/api/v1/courses', durationMs: 20, status: 200 });
      timings.record({ url: '/api/v1/courses', durationMs: 30, status: 403 });
      timings.record({ url: '/api/v1/courses', durationMs: 40, failed: true });

      const summary = timings.summary();
      expect(summary.endpoints[0].calls).toBe(3);
      expect(summary.endpoints[0].errors).toBe(2);
      expect(summary.endpoints[0].totalMs).toBe(90);
      expect(summary.errors).toBe(2);
    });

    test('keeps throttle time separate from request time', () => {
      timings.record({ url: '/api/v1/courses', durationMs: 100, status: 200 });
      timings.recordWait('canvas_throttle', 250);
      timings.recordWait('canvas_throttle', 250);
      timings.recordWait('canvas_rate_limit_backoff', 1000);

      const summary = timings.summary();
      expect(summary.requestMs).toBe(100);
      expect(summary.waitMs).toBe(1500);
      expect(summary.waits).toEqual([
        { reason: 'canvas_rate_limit_backoff', count: 1, totalMs: 1000 },
        { reason: 'canvas_throttle', count: 2, totalMs: 500 }
      ]);
    });

    test('ignores waits that did not happen', () => {
      timings.recordWait('canvas_throttle', 0);
      timings.recordWait('canvas_throttle', -5);
      timings.recordWait('canvas_throttle', NaN);
      expect(timings.summary().waits).toEqual([]);
    });

    test('folds the rate-limit headers the limiter already parses into the summary', () => {
      timings.record({ url: '/api/v1/courses', durationMs: 10, status: 200, cost: 2.5, remaining: 690 });
      timings.record({ url: '/api/v1/courses', durationMs: 10, status: 200, cost: 3, remaining: 120 });
      // updateFromHeaders returns NaN when Canvas sent no header — must not poison the totals.
      timings.record({ url: '/api/v1/courses', durationMs: 10, status: 200, cost: NaN, remaining: NaN });

      const summary = timings.summary();
      expect(summary.totalCost).toBe(5.5);
      expect(summary.minRemaining).toBe(120);
    });

    test('reset starts a fresh window so a summary describes one sync', () => {
      timings.record({ url: '/api/v1/courses', durationMs: 10, status: 200, cost: 2 });
      timings.recordWait('canvas_throttle', 10);
      timings.reset();

      expect(timings.isEmpty()).toBe(true);
      const summary = timings.summary();
      expect(summary.requests).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.minRemaining).toBe(null);
    });

    test('bounds the number of tracked endpoints, folding the rest into one row', () => {
      const bounded = new RequestTimings({ label: 'Canvas', maxEndpoints: 3 });
      for (let i = 0; i < 25; i++) {
        bounded.record({ url: `/api/v1/thing${i}`, durationMs: 10, status: 200 });
      }

      const summary = bounded.summary();
      // 3 distinct endpoints plus the single "(other)" overflow row.
      expect(summary.endpoints.length).toBe(4);
      expect(summary.endpoints.some(row => row.endpoint === '(other)')).toBe(true);
      // No call is dropped: the counts still add up to what was recorded.
      expect(summary.requests).toBe(25);
    });

    test('a malformed record never throws at the call site', () => {
      expect(() => timings.record(null)).not.toThrow();
      expect(() => timings.record({ url: '/api/v1/courses' })).not.toThrow();
      expect(() => timings.record({ url: '/api/v1/courses', durationMs: 'slow' })).not.toThrow();
      expect(timings.summary().requestMs).toBe(0);
    });
  });

  describe('summary formatting and logging', () => {
    let originalDebug;

    beforeEach(() => {
      originalDebug = globalThis.Debug;
    });

    afterEach(() => {
      globalThis.Debug = originalDebug;
    });

    test('formats a line per endpoint plus the throttle and budget totals', () => {
      const timings = new RequestTimings({ label: 'Canvas' });
      timings.record({ url: '/api/v1/courses/1/assignments', durationMs: 200, status: 200, cost: 3, remaining: 500 });
      timings.recordWait('canvas_throttle', 120);

      const lines = RequestTimings.formatSummary(timings.summary());
      expect(lines[0]).toContain('Canvas request timing: 1 requests');
      expect(lines[0]).toContain('200ms on requests');
      expect(lines[0]).toContain('120ms throttled');
      expect(lines.some(line => line.includes('/api/v1/courses/:id/assignments: 1 calls'))).toBe(true);
      expect(lines.some(line => line.includes('wait/canvas_throttle'))).toBe(true);
      expect(lines.some(line => line.includes('rate-limit cost: 3 units'))).toBe(true);
      expect(lines.some(line => line.includes('low-water mark: 500'))).toBe(true);
    });

    test('formats nothing for a missing or malformed snapshot', () => {
      expect(RequestTimings.formatSummary(null)).toEqual([]);
      expect(RequestTimings.formatSummary({})).toEqual([]);
    });

    test('logs through Debug, which gates it on debug mode', () => {
      const log = jest.fn();
      globalThis.Debug = { log };

      const timings = new RequestTimings({ label: 'Notion' });
      timings.record({ url: 'https://api.notion.com/v1/pages', durationMs: 90, status: 200 });
      RequestTimings.logSummary(timings.summary());

      expect(log).toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain('Notion request timing');
    });

    test('logs nothing when there is nothing to report', () => {
      const log = jest.fn();
      globalThis.Debug = { log };

      RequestTimings.logSummary(null);
      expect(log).not.toHaveBeenCalled();
    });

    test('a missing Debug global does not throw', () => {
      globalThis.Debug = undefined;
      const timings = new RequestTimings();
      timings.record({ url: '/v1/pages', durationMs: 5, status: 200 });
      expect(() => RequestTimings.logSummary(timings.summary())).not.toThrow();
    });
  });
});
