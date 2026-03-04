import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

describe('CanvasAPIExtractor parallel batch processing', () => {
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
  });

  test('processes courses in bounded parallel batches with delays between batches', async () => {
    const extractor = new CanvasAPIExtractor();
    const courses = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      course_code: `CSC-${index + 1}`
    }));

    let active = 0;
    let maxActive = 0;
    extractor.processSingleCourse = async (course) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return {
        ok: true,
        courseId: course.id.toString(),
        courseCode: course.course_code,
        assignments: [{ canvasId: course.id.toString() }]
      };
    };

    const delayCalls = [];
    extractor.delay = async (ms) => {
      delayCalls.push(ms);
    };

    const progress = [];
    const result = await extractor.processCoursesBatch(courses, {
      batchSize: 3,
      batchDelayMs: 500,
      onProgress: async (state) => {
        progress.push(state);
      }
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(delayCalls).toEqual([500, 500]);
    expect(result.assignments).toHaveLength(7);
    expect(result.extractionErrors).toHaveLength(0);
    expect(progress[0]).toMatchObject({ current: 0, total: 7, errorCount: 0 });
    expect(progress[progress.length - 1]).toMatchObject({ current: 7, total: 7, errorCount: 0 });
  });

  test('continues batch processing when individual courses fail', async () => {
    const extractor = new CanvasAPIExtractor();
    const courses = [
      { id: 1, course_code: 'CSC-1' },
      { id: 2, course_code: 'CSC-2' },
      { id: 3, course_code: 'CSC-3' },
      { id: 4, course_code: 'CSC-4' }
    ];

    extractor.processSingleCourse = async (course) => {
      if (course.id === 2) {
        return {
          ok: false,
          courseId: '2',
          courseCode: course.course_code,
          error: 'Access denied'
        };
      }
      if (course.id === 4) {
        throw new Error('Network timeout');
      }
      return {
        ok: true,
        courseId: course.id.toString(),
        courseCode: course.course_code,
        assignments: [{ canvasId: course.id.toString() }]
      };
    };

    extractor.delay = async () => {};

    const progress = [];
    const result = await extractor.processCoursesBatch(courses, {
      batchSize: 3,
      batchDelayMs: 500,
      onProgress: async (state) => {
        progress.push(state);
      }
    });

    expect(result.assignments.map(a => a.canvasId)).toEqual(['1', '3']);
    expect(result.extractionErrors).toHaveLength(2);
    expect(result.extractionErrors[0]).toMatchObject({
      courseId: '2',
      courseCode: 'CSC-2',
      error: 'Access denied'
    });
    expect(result.extractionErrors[1]).toMatchObject({
      courseId: '4',
      courseCode: 'CSC-4',
      error: 'Network timeout'
    });
    expect(progress[progress.length - 1]).toMatchObject({ current: 4, total: 4, errorCount: 2 });
  });
});
