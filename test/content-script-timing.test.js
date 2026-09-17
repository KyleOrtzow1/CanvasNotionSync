import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

// Issue #61: Canvas requests are made in the content script, so that is where
// their timings have to be collected — and they have to reach the service
// worker on the extraction response to land in the sync's diagnostics.
describe('CanvasAPIExtractor request timing', () => {
  let CanvasAPIExtractor;
  let originals;

  const okResponse = (data, linkHeader = null, rateLimitHeaders = {}) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: jest.fn((name) => {
        if (name === 'Link') return linkHeader;
        return rateLimitHeaders[name] ?? null; // eslint-disable-line security/detect-object-injection -- test fixture lookup
      })
    },
    json: async () => data,
    text: async () => ''
  });

  beforeAll(async () => {
    originals = {
      window: globalThis.window,
      document: globalThis.document,
      chrome: globalThis.chrome,
      DOMParser: globalThis.DOMParser,
      CanvasRateLimiter: globalThis.CanvasRateLimiter,
      CanvasValidator: globalThis.CanvasValidator,
      getUserFriendlyCanvasError: globalThis.getUserFriendlyCanvasError,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      CanvasAPIExtractor: globalThis.CanvasAPIExtractor,
      Debug: globalThis.Debug
    };

    globalThis.setTimeout = jest.fn(() => 0);
    globalThis.clearTimeout = jest.fn();

    globalThis.Debug = {
      init: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    globalThis.DOMParser = class MockDOMParser {
      parseFromString(html) {
        return { body: { textContent: String(html).replace(/<[^>]*>/g, '') } };
      }
    };

    globalThis.CanvasValidator = {
      validateAssignment: jest.fn((assignment) => ({ valid: true, validated: assignment, warnings: [] }))
    };

    globalThis.getUserFriendlyCanvasError = (error) => ({
      title: 'Canvas Error',
      message: error.message,
      action: ''
    });

    globalThis.window = {
      canvasNotionExtractorLoaded: false,
      location: { href: 'https://school.instructure.com/courses' },
      fetch: jest.fn()
    };

    globalThis.document = {
      querySelector: jest.fn(() => null),
      createElement: jest.fn(() => ({
        style: {}, addEventListener: jest.fn(), appendChild: jest.fn(), textContent: ''
      })),
      body: { appendChild: jest.fn() }
    };

    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(async () => ({ success: true }))
      },
      storage: {
        onChanged: { addListener: jest.fn() },
        local: { set: jest.fn(async () => {}), get: jest.fn(async () => ({})) }
      }
    };

    // The real modules: the extractor reads RequestTimings and the rate limiter
    // off globalThis exactly as the manifest's script order provides them.
    await import('../src/utils/canvas-hosts.js');
    await import('../src/utils/request-timing.js');
    await import('../src/api/canvas-rate-limiter.js');
    await import('../content-script.js');
    CanvasAPIExtractor = globalThis.CanvasAPIExtractor;
  });

  afterAll(() => {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.chrome = originals.chrome;
    globalThis.DOMParser = originals.DOMParser;
    globalThis.CanvasRateLimiter = originals.CanvasRateLimiter;
    globalThis.CanvasValidator = originals.CanvasValidator;
    globalThis.getUserFriendlyCanvasError = originals.getUserFriendlyCanvasError;
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
    globalThis.CanvasAPIExtractor = originals.CanvasAPIExtractor;
    globalThis.Debug = originals.Debug;
  });

  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.window.fetch = jest.fn(async () => okResponse([{ id: 1 }]));

    extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';
    // Straight-through limiter: this suite is about what gets recorded, not
    // about when the limiter decides to send.
    extractor.rateLimiter = {
      execute: jest.fn((requestFunction) => requestFunction()),
      updateFromHeaders: jest.fn(() => ({ cost: 2, remaining: 640 }))
    };
  });

  test('records one entry per request, keyed by endpoint shape', async () => {
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/1/assignments');
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/2/assignments');
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');

    const summary = extractor.timings.summary();
    expect(summary.requests).toBe(3);

    const assignments = summary.endpoints.find(row => row.endpoint === '/api/v1/courses/:id/assignments');
    expect(assignments.calls).toBe(2);
    expect(summary.endpoints.find(row => row.endpoint === '/api/v1/courses').calls).toBe(1);
  });

  test('records the rate-limit headers the limiter already parses', async () => {
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/users/self');

    const summary = extractor.timings.summary();
    expect(summary.totalCost).toBe(4);
    expect(summary.minRemaining).toBe(640);
  });

  test('a failed request is still timed and counted as an error', async () => {
    globalThis.window.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: jest.fn(() => null) },
      json: async () => ({}),
      text: async () => 'rate limit exceeded'
    }));

    await expect(
      extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses')
    ).rejects.toThrow('403');

    const summary = extractor.timings.summary();
    expect(summary.requests).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.endpoints[0].endpoint).toBe('/api/v1/courses');
  });

  test('a request that never got a response is recorded as failed', async () => {
    globalThis.window.fetch = jest.fn(async () => { throw new Error('Failed to fetch'); });

    await expect(
      extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses')
    ).rejects.toThrow('Failed to fetch');

    expect(extractor.timings.summary().errors).toBe(1);
  });

  test('a successful request is recorded exactly once', async () => {
    await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');
    expect(extractor.timings.summary().requests).toBe(1);
  });

  test('extractAssignments resets the window and returns the summary', async () => {
    extractor.timings.record({ url: '/api/v1/stale', durationMs: 999, status: 200 });
    extractor.extractWithAPIToken = jest.fn(async () => {
      await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');
      return { assignments: [], activeCourseIds: [] };
    });

    const result = await extractor.extractAssignments();

    expect(result.timings.requests).toBe(1);
    expect(result.timings.label).toBe('Canvas');
    expect(result.timings.endpoints.map(row => row.endpoint)).toEqual(['/api/v1/courses']);
    // Serialisable: it has to survive chrome.tabs.sendMessage to the worker.
    expect(JSON.parse(JSON.stringify(result.timings))).toEqual(result.timings);
  });

  test('an extraction that made no requests carries no timing payload', async () => {
    extractor.extractWithAPIToken = jest.fn(async () => ({ assignments: [], activeCourseIds: [] }));

    const result = await extractor.extractAssignments();
    expect(result.timings).toBeUndefined();
  });

  test('a failed extraction still logs what it measured', async () => {
    extractor.extractWithAPIToken = jest.fn(async () => {
      await extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');
      throw new Error('Canvas exploded');
    });

    await expect(extractor.extractAssignments()).rejects.toThrow('Canvas exploded');

    const logged = globalThis.Debug.log.mock.calls.map(call => String(call[0]));
    expect(logged.some(line => line.includes('Canvas request timing'))).toBe(true);
  });
});
