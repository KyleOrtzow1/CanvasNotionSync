import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

describe('CanvasAPIExtractor request authentication', () => {
  let CanvasAPIExtractor;
  let originals;

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

    globalThis.getUserFriendlyCanvasError = (error) => {
      if (error.status === 401) {
        return {
          title: 'Canvas Session Expired',
          message: 'Canvas did not accept the request because your Canvas session is no longer signed in.',
          action: 'Log back in to Canvas in this browser and refresh the page, then try again.'
        };
      }
      return {
        title: 'Canvas Error',
        message: error.message,
        action: ''
      };
    };

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

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.window.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: jest.fn(() => null) },
      json: async () => [{ id: 1 }],
      text: async () => ''
    }));
  });

  const fetchOptions = () => globalThis.window.fetch.mock.calls[0][1];

  test('omits Authorization when no Canvas token is configured', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.canvasToken = null;

    await extractor._fetchWithHeaders('https://school.instructure.com/api/v1/courses');

    const { headers } = fetchOptions();
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Accept']).toBe('application/json');
  });

  test('omits Authorization when the Canvas token is an empty string', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.canvasToken = '';

    await extractor._fetchWithHeaders('https://school.instructure.com/api/v1/courses');

    expect(fetchOptions().headers).not.toHaveProperty('Authorization');
  });

  test('includes Authorization when a Canvas token is configured', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.canvasToken = 'canvas-token-123';

    await extractor._fetchWithHeaders('https://school.instructure.com/api/v1/courses');

    expect(fetchOptions().headers['Authorization']).toBe('Bearer canvas-token-123');
  });

  test('sends session credentials with and without a token', async () => {
    const withoutToken = new CanvasAPIExtractor();
    withoutToken.canvasToken = null;
    await withoutToken._fetchWithHeaders('https://school.instructure.com/api/v1/courses');
    expect(fetchOptions().credentials).toBe('include');

    globalThis.window.fetch.mockClear();

    const withToken = new CanvasAPIExtractor();
    withToken.canvasToken = 'canvas-token-123';
    await withToken._fetchWithHeaders('https://school.instructure.com/api/v1/courses');
    expect(fetchOptions().credentials).toBe('include');
  });

  test('extractAssignments no longer requires a token, only a detected Canvas instance', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.canvasToken = null;
    extractor.extractWithAPIToken = jest.fn(async () => ({ assignments: [] }));

    await expect(extractor.extractAssignments()).resolves.toEqual({ assignments: [] });
    expect(extractor.extractWithAPIToken).toHaveBeenCalled();

    extractor.baseURL = null;
    await expect(extractor.extractAssignments()).rejects.toThrow('Canvas instance not detected');
  });

  // --- issue #27: lightweight connection test -----------------------------

  test('testConnection issues exactly one fetch, to /users/self, and returns the caller identity', async () => {
    globalThis.window.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: jest.fn(() => null) },
      json: async () => ({ id: 42, name: 'Jane Doe' }),
      text: async () => ''
    }));

    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';

    const result = await extractor.testConnection();

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.window.fetch.mock.calls[0][0]).toBe('https://school.instructure.com/api/v1/users/self');
    expect(result).toEqual({ name: 'Jane Doe', id: 42 });
  });

  test('testConnection sends the bearer header when a token is set, omits it when not', async () => {
    const withoutToken = new CanvasAPIExtractor();
    withoutToken.baseURL = 'https://school.instructure.com/api/v1';
    withoutToken.canvasToken = null;
    await withoutToken.testConnection();
    expect(fetchOptions().headers).not.toHaveProperty('Authorization');

    globalThis.window.fetch.mockClear();

    const withToken = new CanvasAPIExtractor();
    withToken.baseURL = 'https://school.instructure.com/api/v1';
    withToken.canvasToken = 'canvas-token-123';
    await withToken.testConnection();
    expect(fetchOptions().headers['Authorization']).toBe('Bearer canvas-token-123');
  });

  test('testConnection writes no sync_progress key (regression guard for the stuck indicator)', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';

    await extractor.testConnection();

    const progressWrites = globalThis.chrome.storage.local.set.mock.calls.filter(
      ([arg]) => arg && Object.prototype.hasOwnProperty.call(arg, 'sync_progress')
    );
    expect(progressWrites).toHaveLength(0);
  });

  test('testConnection surfaces a 401 as success:false with the session-expired copy', async () => {
    globalThis.window.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: jest.fn(() => null) },
      json: async () => ({}),
      text: async () => 'Unauthorized'
    }));

    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';

    await expect(extractor.testConnection()).rejects.toThrow(/Canvas Session Expired/);
  });

  test('testConnection bails with "Canvas instance not detected" when baseURL is null, with no fetch attempted', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = null;

    await expect(extractor.testConnection()).rejects.toThrow('Canvas instance not detected');
    expect(globalThis.window.fetch).not.toHaveBeenCalled();
  });

  test('the runtime message listener answers TEST_CANVAS_CONNECTION with a single /users/self fetch', async () => {
    globalThis.window.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: jest.fn(() => null) },
      json: async () => ({ id: 42, name: 'Jane Doe' }),
      text: async () => ''
    }));

    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';

    const calls = globalThis.chrome.runtime.onMessage.addListener.mock.calls;
    const listener = calls[calls.length - 1][0];

    let capturedResponse;
    let resolveReceived;
    const responseReceived = new Promise(resolve => { resolveReceived = resolve; });
    const sendResponse = (response) => {
      capturedResponse = response;
      resolveReceived();
    };

    const keepChannelOpen = listener({ type: 'TEST_CANVAS_CONNECTION' }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);

    await responseReceived;

    expect(capturedResponse).toEqual(
      expect.objectContaining({ success: true, name: 'Jane Doe', id: 42 })
    );
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.window.fetch.mock.calls[0][0]).toBe('https://school.instructure.com/api/v1/users/self');
  });

  // --- issue #27 step 3: extractAssignments must not strand sync_progress --

  test('a throwing extractAssignments leaves sync_progress.active === false', async () => {
    const extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';
    extractor.extractWithAPIToken = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(extractor.extractAssignments()).rejects.toThrow('boom');

    const progressWrites = globalThis.chrome.storage.local.set.mock.calls
      .map(([arg]) => arg && arg.sync_progress)
      .filter(Boolean);
    expect(progressWrites.length).toBeGreaterThan(0);

    const lastWrite = progressWrites[progressWrites.length - 1];
    expect(lastWrite.active).toBe(false);
    expect(lastWrite.phase).toBe('error');
  });
});
