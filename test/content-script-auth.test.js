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
});
