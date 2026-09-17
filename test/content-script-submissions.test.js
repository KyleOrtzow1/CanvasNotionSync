import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';

// Issue #57: submissions ride along on the course assignment list via `include=submission`,
// so a sync costs one Canvas request per course rather than one per assignment. These tests
// lock that property in — dropping the include would silently reintroduce the per-assignment
// fetching the issue set out to remove. See docs/canvas-submissions.md.
describe('Canvas submission fetching', () => {
  let CanvasAPIExtractor;
  let originals;

  const okResponse = (data, linkHeader = null) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: jest.fn((name) => (name === 'Link' ? linkHeader : null)) },
    json: async () => data,
    text: async () => ''
  });

  const assignmentFixture = (id, submission) => ({
    id,
    name: `Assignment ${id}`,
    course_id: 1,
    due_at: '2026-06-15T23:59:00Z',
    points_possible: 100,
    html_url: `https://school.instructure.com/courses/1/assignments/${id}`,
    submission_types: ['online_upload'],
    description: '<p>Do the reading</p>',
    ...(submission ? { submission } : {})
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
    extractor = new CanvasAPIExtractor();
    extractor.baseURL = 'https://school.instructure.com/api/v1';
    extractor.delay = async () => {};
    extractor.rateLimiter = {
      execute: jest.fn((requestFunction) => requestFunction()),
      updateFromHeaders: jest.fn()
    };
  });

  const fetchedURLs = () => globalThis.window.fetch.mock.calls.map(call => call[0]);

  test('asks for submissions inline on the course assignment list', async () => {
    globalThis.window.fetch = jest.fn(async () => okResponse([
      assignmentFixture(1),
      assignmentFixture(2),
      assignmentFixture(3)
    ]));

    await extractor.processSingleCourse({ id: 1, course_code: 'CSC-413' });

    expect(globalThis.window.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetchedURLs()[0]);
    expect(url.pathname).toBe('/api/v1/courses/1/assignments');
    expect(url.searchParams.get('include')).toBe('submission');
    expect(url.searchParams.get('per_page')).toBe('100');
  });

  test('costs one Canvas request per course page, not one per assignment', async () => {
    const courses = [
      { id: 1, course_code: 'CSC-413' },
      { id: 2, course_code: 'MATH-200' }
    ];
    const assignments = Array.from({ length: 60 }, (_, index) => assignmentFixture(index + 1));

    globalThis.window.fetch = jest.fn(async (url) => {
      if (url.includes('/courses?')) {
        return okResponse(courses);
      }
      return okResponse(assignments);
    });

    const result = await extractor.extractWithAPIToken();

    expect(result.assignments).toHaveLength(120);
    // One course list + one assignment list per course. 120 assignments add nothing.
    expect(globalThis.window.fetch).toHaveBeenCalledTimes(3);
  });

  test('never issues a separate submissions request', async () => {
    globalThis.window.fetch = jest.fn(async (url) => {
      if (url.includes('/courses?')) {
        return okResponse([{ id: 1, course_code: 'CSC-413' }]);
      }
      return okResponse([assignmentFixture(1), assignmentFixture(2)]);
    });

    await extractor.extractWithAPIToken();

    for (const url of fetchedURLs()) {
      expect(url).not.toContain('/students/submissions');
      expect(new URL(url).pathname).not.toMatch(/\/submissions$/);
    }
  });

  test('maps the included submission onto status, grade and percentage', () => {
    const [assignment] = extractor.transformAssignmentsForCourse(
      { id: 1, course_code: 'CSC-413' },
      [assignmentFixture(1, { workflow_state: 'graded', grade: '88', score: 88, late: false })]
    );

    expect(assignment.status).toBe('Graded');
    expect(assignment.grade).toBe('88');
    expect(assignment.gradePercent).toBe(88);
  });

  test('falls back to Not Started when Canvas omits the submission key', () => {
    const [assignment] = extractor.transformAssignmentsForCourse(
      { id: 1, course_code: 'CSC-413' },
      [assignmentFixture(1)]
    );

    expect(assignment.status).toBe('Not Started');
    expect(assignment.grade).toBeNull();
    expect(assignment.gradePercent).toBeNull();
  });
});
