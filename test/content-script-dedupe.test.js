import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

// Issue #58: concurrent identical Canvas GETs must collapse into a single request so a
// duplicate does not spend leaky-bucket units on a response already on its way.
describe('CanvasAPIExtractor in-flight request deduplication', () => {
  let CanvasAPIExtractor;
  let originals;

  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const okResponse = (data, linkHeader = null) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: jest.fn((name) => (name === 'Link' ? linkHeader : null)) },
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
        return {
          body: {
            textContent: String(html).replace(/<[^>]*>/g, '')
          }
        };
      }
    };

    globalThis.CanvasRateLimiter = class MockCanvasRateLimiter {
      execute(requestFunction) {
        return requestFunction();
      }

      updateFromHeaders() {}
    };

    globalThis.CanvasValidator = {
      validateAssignment: jest.fn((assignment) => ({
        valid: true,
        validated: assignment,
        warnings: []
      }))
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
        style: {},
        addEventListener: jest.fn(),
        appendChild: jest.fn(),
        textContent: ''
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
        local: {
          set: jest.fn(async () => {}),
          get: jest.fn(async () => ({}))
        }
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
  let execute;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.window.fetch = jest.fn(async () => okResponse([{ id: 1 }]));

    extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';
    execute = jest.fn((requestFunction) => requestFunction());
    extractor.rateLimiter = { execute, updateFromHeaders: jest.fn() };
  });

  test('two concurrent identical calls issue one request and both resolve with it', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async () => {
      await gate.promise;
      return okResponse([{ id: 7 }]);
    });

    const first = extractor.makeSingleAPICall('/courses', { per_page: 100 });
    const second = extractor.makeSingleAPICall('/courses', { per_page: 100 });

    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
    expect(firstResult.data).toEqual([{ id: 7 }]);
    expect(secondResult).toBe(firstResult);
  });

  test('a collapsed duplicate never reaches the rate limiter, so it costs no bucket units', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async () => {
      await gate.promise;
      return okResponse([{ id: 7 }]);
    });

    const calls = [
      extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/1/assignments'),
      extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/1/assignments'),
      extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses/1/assignments')
    ];

    gate.resolve();
    await Promise.all(calls);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
  });

  test('a call made after the first settles issues a fresh request', async () => {
    const url = 'https://school.instructure.com/api/v1/courses';

    await extractor.makeSingleAPICallByURL(url);
    await extractor.makeSingleAPICallByURL(url);

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(2);
    expect(extractor.inFlightRequests.size).toBe(0);
  });

  test('a rejected request is not cached and does not poison the key', async () => {
    const url = 'https://school.instructure.com/api/v1/courses';
    globalThis.window.fetch = jest.fn(async () => {
      throw new Error('Network timeout');
    });

    await expect(extractor.makeSingleAPICallByURL(url)).rejects.toThrow('Network timeout');
    expect(extractor.inFlightRequests.size).toBe(0);

    globalThis.window.fetch = jest.fn(async () => okResponse([{ id: 9 }]));
    const retry = await extractor.makeSingleAPICallByURL(url);

    expect(retry.data).toEqual([{ id: 9 }]);
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
  });

  test('concurrent callers of a failing request all see the rejection', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async () => {
      await gate.promise;
      throw new Error('Canvas API error: 500 Internal Server Error');
    });

    const first = extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');
    const second = extractor.makeSingleAPICallByURL('https://school.instructure.com/api/v1/courses');

    gate.resolve();

    await expect(first).rejects.toThrow('Canvas API error: 500');
    await expect(second).rejects.toThrow('Canvas API error: 500');
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
    expect(extractor.inFlightRequests.size).toBe(0);
  });

  test('different endpoints are not collapsed together', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async (url) => {
      await gate.promise;
      return okResponse([{ url }]);
    });

    const calls = [
      extractor.makeSingleAPICall('/courses/1/assignments'),
      extractor.makeSingleAPICall('/courses/2/assignments'),
      extractor.makeSingleAPICall('/courses/1/assignments', { per_page: 100 })
    ];

    gate.resolve();
    await Promise.all(calls);

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(3);
  });

  test('query parameter order does not defeat deduplication', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async () => {
      await gate.promise;
      return okResponse([{ id: 7 }]);
    });

    const first = extractor.makeSingleAPICall('/courses', { per_page: 100, enrollment_state: 'active' });
    const second = extractor.makeSingleAPICall('/courses', { enrollment_state: 'active', per_page: 100 });

    gate.resolve();
    await Promise.all([first, second]);

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
  });

  test('a token change drops in-flight entries so the next call uses the new credentials', async () => {
    const gate = deferred();
    globalThis.window.fetch = jest.fn(async () => {
      await gate.promise;
      return okResponse([{ id: 7 }]);
    });

    const url = 'https://school.instructure.com/api/v1/courses';
    const first = extractor.makeSingleAPICallByURL(url);

    const calls = globalThis.chrome.runtime.onMessage.addListener.mock.calls;
    const listener = calls[calls.length - 1][0];
    listener({ type: 'SET_CANVAS_TOKEN', token: 'canvas-token-123' }, {}, () => {});

    const second = extractor.makeSingleAPICallByURL(url);

    gate.resolve();
    await Promise.all([first, second]);

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.window.fetch.mock.calls[1][1].headers['Authorization']).toBe('Bearer canvas-token-123');
  });

  test('paginated calls dedupe per page and still follow next links', async () => {
    const page2 = 'https://school.instructure.com/api/v1/courses?page=2';

    const gate = deferred();
    globalThis.window.fetch = jest.fn(async (url) => {
      await gate.promise;
      if (url === page2) {
        return okResponse([{ id: 2 }]);
      }
      return okResponse([{ id: 1 }], `<${page2}>; rel="next"`);
    });

    const first = extractor.makeAPICall('/courses');
    const second = extractor.makeAPICall('/courses');

    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual([{ id: 1 }, { id: 2 }]);
    expect(secondResult).toEqual([{ id: 1 }, { id: 2 }]);
    // One request per page, not per caller.
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(2);
    expect(extractor.inFlightRequests.size).toBe(0);
  });
});
