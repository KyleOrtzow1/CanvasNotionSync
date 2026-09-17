import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

// Issue #60: once Canvas has failed the same way repeatedly, the extractor stops
// asking instead of paying the retry ladder once per assignment.
describe('CanvasAPIExtractor circuit breaker', () => {
  let CanvasAPIExtractor;
  let originals;

  const okResponse = (data) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: jest.fn(() => null) },
    json: async () => data,
    text: async () => ''
  });

  const errorResponse = (status, statusText, body = '') => ({
    ok: false,
    status,
    statusText,
    headers: { get: jest.fn(() => null) },
    json: async () => ({}),
    text: async () => body
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
      CanvasAPIExtractor: globalThis.CanvasAPIExtractor
    };

    // Prevent UI timers from executing during import side effects.
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

    // Passthrough limiter: the breaker's behaviour, not the bucket's, is under test.
    globalThis.CanvasRateLimiter = class MockCanvasRateLimiter {
      execute(requestFunction) {
        return requestFunction();
      }

      updateFromHeaders() {}
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

    await import('../src/utils/canvas-hosts.js');
    // Loaded as a plain script ahead of the content script in the manifest (#60).
    await import('../src/utils/circuit-breaker.js');
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
  });

  let extractor;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.window.fetch = jest.fn(async () => okResponse([{ id: 1 }]));
    extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';
  });

  describe('_endpointKey', () => {
    test('drops the host, the /api/v1 prefix, the query and the IDs', () => {
      expect(extractor._endpointKey('https://school.instructure.com/api/v1/courses?per_page=100'))
        .toBe('/courses');
      expect(extractor._endpointKey('https://school.instructure.com/api/v1/courses/12345/assignments'))
        .toBe('/courses/:id/assignments');
      expect(extractor._endpointKey('https://school.instructure.com/api/v1/courses/1/assignments/2/submissions/self'))
        .toBe('/courses/:id/assignments/:id/submissions/self');
    });

    test('falls back to the raw string for something that is not a URL', () => {
      expect(extractor._endpointKey('not a url')).toBe('not a url');
    });
  });

  test('five failures on one endpoint shape stop the sixth request being sent', async () => {
    globalThis.window.fetch = jest.fn(async () => errorResponse(503, 'Service Unavailable'));

    // Different courses, same endpoint shape — one outage, not five unrelated ones.
    for (let course = 1; course <= 5; course++) {
      await expect(
        extractor.makeSingleAPICallByURL(`https://school.instructure.com/api/v1/courses/${course}/assignments`)
      ).rejects.toMatchObject({ status: 503 });
    }
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(5);

    const error = await extractor
      .makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/6/assignments')
      .catch(e => e);

    expect(error.circuitOpen).toBe(true);
    expect(error.message).toContain('Canvas is not responding');
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(5);
  });

  test('an unrelated endpoint keeps working while one is open', async () => {
    globalThis.window.fetch = jest.fn(async (url) => (
      String(url).includes('/assignments')
        ? errorResponse(503, 'Service Unavailable')
        : okResponse([{ id: 1 }])
    ));

    for (let course = 1; course <= 5; course++) {
      await extractor
        .makeSingleAPICallByURL(`https://school.instructure.com/api/v1/courses/${course}/assignments`)
        .catch(() => {});
    }

    await expect(extractor.makeSingleAPICall('/courses', { per_page: 100 }))
      .resolves.toMatchObject({ data: [{ id: 1 }] });
  });

  test('an expired Canvas session stops every endpoint at once', async () => {
    globalThis.window.fetch = jest.fn(async () => errorResponse(401, 'Unauthorized', 'user authorization required'));

    await expect(extractor.makeSingleAPICall('/courses', { per_page: 100 }))
      .rejects.toMatchObject({ status: 401 });
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);

    const error = await extractor
      .makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/1/assignments')
      .catch(e => e);

    expect(error.circuitOpen).toBe(true);
    expect(error.reason).toBe('authentication');
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
  });

  test('a throttling 403 is left to the rate limiter and never opens the circuit', async () => {
    globalThis.window.fetch = jest.fn(async () => errorResponse(403, 'Forbidden', '403 Forbidden (Rate Limit Exceeded)'));

    for (let course = 1; course <= 6; course++) {
      await expect(
        extractor.makeSingleAPICallByURL(`https://school.instructure.com/api/v1/courses/${course}/assignments`)
      ).rejects.toMatchObject({ status: 403 });
    }

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(6);
    expect(extractor.circuitBreaker.isOpen('/courses/:id/assignments')).toBe(false);
  });

  test('testConnection reports an open circuit through the friendly error path', async () => {
    globalThis.window.fetch = jest.fn(async () => errorResponse(500, 'Internal Server Error'));

    for (let i = 0; i < 5; i++) {
      await extractor.testConnection().catch(() => {});
    }
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(5);

    await expect(extractor.testConnection()).rejects.toThrow('Canvas Error');
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(5);
  });
});
