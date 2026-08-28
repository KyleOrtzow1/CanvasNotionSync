import { describe, test, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';

// Covers issue #36: detectCanvasInstance() must recognize every host the
// manifest injects the content script into, not just instructure.com.
describe('CanvasAPIExtractor Canvas instance detection', () => {
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
      CanvasAPIExtractor: globalThis.CanvasAPIExtractor,
      CANVAS_HOST_RE: globalThis.CANVAS_HOST_RE,
      CANVAS_TAB_PATTERNS: globalThis.CANVAS_TAB_PATTERNS,
      CANVAS_DOMAINS: globalThis.CANVAS_DOMAINS
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

    // Initial window, present only so the "prevent multiple initialization"
    // top-level guard in content-script.js has something to read at import time.
    // Each test below replaces this with its own window before constructing
    // an extractor, since detectCanvasInstance() reads window.location.href
    // at construction time, not at import time.
    globalThis.window = {
      canvasNotionExtractorLoaded: false,
      location: { href: 'https://school.instructure.com/courses' },
      fetch: jest.fn()
    };

    // Real shared module (this is the fix under test), loaded the same way
    // manifest.json and background-handlers.js load it ahead of content-script.js.
    await import('../src/utils/canvas-hosts.js');

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
    globalThis.CANVAS_HOST_RE = originals.CANVAS_HOST_RE;
    globalThis.CANVAS_TAB_PATTERNS = originals.CANVAS_TAB_PATTERNS;
    globalThis.CANVAS_DOMAINS = originals.CANVAS_DOMAINS;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('detects an instructure.com page', () => {
    globalThis.window = {
      canvasNotionExtractorLoaded: false,
      location: { href: 'https://school.instructure.com/courses' },
      fetch: jest.fn()
    };

    const extractor = new CanvasAPIExtractor();
    expect(extractor.baseURL).toBe('https://school.instructure.com/api/v1');
  });

  test('detects a canvaslms.com page (regression test for #36)', () => {
    globalThis.window = {
      canvasNotionExtractorLoaded: false,
      location: { href: 'https://school.canvaslms.com/courses' },
      fetch: jest.fn()
    };

    const extractor = new CanvasAPIExtractor();
    expect(extractor.baseURL).toBe('https://school.canvaslms.com/api/v1');
  });

  test('does not detect an unrelated domain', () => {
    globalThis.window = {
      canvasNotionExtractorLoaded: false,
      location: { href: 'https://example.com/courses' },
      fetch: jest.fn()
    };

    const extractor = new CanvasAPIExtractor();
    expect(extractor.baseURL).toBeNull();
  });
});
