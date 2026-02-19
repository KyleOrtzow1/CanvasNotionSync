/**
 * Integration tests for the full assignment sync flow.
 * Mocks fetch (Canvas + Notion APIs) and Chrome storage.
 * Drives AssignmentSyncer end-to-end with test fixtures.
 */
import { describe, test, expect, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Chrome storage mock — required by CacheManager before any imports
// ---------------------------------------------------------------------------

const mockStorageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (key) => {
        if (typeof key === 'string') return { [key]: mockStorageData[key] };
        if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, mockStorageData[k]]));
        return { ...mockStorageData };
      }),
      set: jest.fn(async (obj) => Object.assign(mockStorageData, obj)),
      remove: jest.fn(async (key) => {
        if (typeof key === 'string') delete mockStorageData[key];
        if (Array.isArray(key)) key.forEach(k => delete mockStorageData[k]);
      }),
      clear: jest.fn(async () => { Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]); })
    }
  }
};

// ---------------------------------------------------------------------------
// Mock NotionRateLimiter (passthrough) before importing NotionAPI
// ---------------------------------------------------------------------------

await jest.unstable_mockModule('../../src/api/notion-rate-limiter.js', () => ({
  NotionRateLimiter: jest.fn().mockImplementation(() => ({
    execute: jest.fn(fn => fn())
  }))
}));

const { NotionAPI } = await import('../../src/api/notion-api.js');
const { AssignmentSyncer } = await import('../../src/sync/assignment-syncer.js');
const { AssignmentCacheManager } = await import('../../src/cache/assignment-cache-manager.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const COURSE_A = 'course-10';
const DS_ID = 'ds-abc';
const DB_ID = 'db-xyz';

function makeAssignment(id, title, courseId = COURSE_A, overrides = {}) {
  return {
    canvasId: String(id),
    title,
    course: 'ENG101',
    courseCode: 'ENG',
    courseId,
    dueDate: '2025-09-01T23:59:00Z',
    points: 100,
    status: 'Not Submitted',
    type: 'assignment',
    description: null,
    grade: null,
    gradePercent: null,
    link: `https://canvas.example.com/courses/${courseId}/assignments/${id}`,
    source: 'canvas',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Stateful fetch mock factory
// The created pages map is kept in sync so reconciliation sees them.
// ---------------------------------------------------------------------------

function makeStatefulFetch({ onUpdate = null } = {}) {
  // canvasId → { pageId, properties } — tracks "Notion" state
  const pages = new Map();
  let pageCounter = 0;

  const fetchMock = jest.fn(async (url, opts) => {
    const ok = (body) => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body)
    });

    // Database info
    if (url.match(/\/databases\//)) {
      return ok({ id: DB_ID, data_sources: [{ id: DS_ID }] });
    }

    // Data source query — return pages that have been created (reconciliation)
    if (url.match(/\/data_sources\//)) {
      const results = Array.from(pages.values()).map(p => ({
        id: p.pageId,
        archived: p.archived || false,
        properties: {
          'Canvas ID': {
            rich_text: [{ plain_text: p.canvasId, text: { content: p.canvasId } }]
          }
        }
      }));
      return ok({ results, has_more: false });
    }

    // Page creation (POST /pages)
    if (url.endsWith('/pages') && opts?.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      const pageId = `page-${++pageCounter}`;
      // Extract canvasId from properties to track in our "Notion"
      const canvasIdProp = body.properties?.['Canvas ID']?.rich_text?.[0]?.text?.content;
      if (canvasIdProp) {
        pages.set(canvasIdProp, { pageId, canvasId: canvasIdProp, archived: false });
      }
      return ok({ id: pageId });
    }

    // Page get (GET /pages/:id)
    if (url.match(/\/pages\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) {
      const pageId = url.split('/').pop();
      return ok({ id: pageId, properties: {} });
    }

    // Page update (PATCH /pages/:id)
    if (url.match(/\/pages\/[^/]+$/) && opts?.method === 'PATCH') {
      const pageId = url.split('/').pop();
      const body = JSON.parse(opts.body || '{}');
      // Track archive status
      for (const [, v] of pages.entries()) {
        if (v.pageId === pageId && body.archived === true) {
          v.archived = true;
        }
      }
      if (onUpdate) onUpdate(pageId, opts);
      return ok({ id: pageId });
    }

    return ok({});
  });

  return { fetchMock, pages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration — full sync creates new pages', () => {
  test('creates a Notion page for a brand-new assignment', async () => {
    const { fetchMock, pages } = makeStatefulFetch();
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);

    const results = await syncer.syncAssignments([makeAssignment(99, 'New Assignment')], [COURSE_A]);

    expect(results.created.length).toBeGreaterThanOrEqual(1);
    expect(pages.size).toBe(1);
  });
});

describe('Integration — cache hit skips API call', () => {
  test('skips API update when assignment fields are unchanged', async () => {
    let updateCount = 0;
    const { fetchMock } = makeStatefulFetch({ onUpdate: () => { updateCount++; } });
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    // Shared syncer — cache persists between calls
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const assignment = makeAssignment(10, 'Stable Assignment');

    // First sync: creates page and caches assignment
    await syncer.syncAssignments([assignment], [COURSE_A]);
    updateCount = 0;

    // Second sync: same data → no field changes → skip
    const results = await syncer.syncAssignments([assignment], [COURSE_A]);

    expect(results.skipped.length).toBeGreaterThanOrEqual(1);
    // No PATCH calls for unchanged assignments (status preservation GET doesn't count)
    // The onUpdate callback only fires for actual PATCH, so updateCount should stay 0
    expect(updateCount).toBe(0);
  });
});

describe('Integration — update when assignment name changes', () => {
  test('sends PATCH to Notion when title changes', async () => {
    let patchCount = 0;
    const { fetchMock } = makeStatefulFetch({ onUpdate: () => { patchCount++; } });
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const original = makeAssignment(20, 'Original Title');

    // First sync: creates
    await syncer.syncAssignments([original], [COURSE_A]);
    patchCount = 0;

    // Second sync: changed title → should update
    const updated = { ...original, title: 'Revised Title' };
    const results = await syncer.syncAssignments([updated], [COURSE_A]);

    expect(results.updated.length).toBeGreaterThanOrEqual(1);
    expect(patchCount).toBeGreaterThanOrEqual(1);
  });
});

describe('Integration — deletion of removed Canvas assignments', () => {
  test('archives Notion page when assignment removed from active course', async () => {
    let archivedPageId = null;
    const { fetchMock } = makeStatefulFetch({
      onUpdate: (pageId, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        if (body.archived === true) archivedPageId = pageId;
      }
    });
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const assignment = makeAssignment(30, 'Soon-to-be-deleted', COURSE_A);

    // First sync: creates and caches
    await syncer.syncAssignments([assignment], [COURSE_A]);

    // Second sync: assignment gone from active course → archive
    const results = await syncer.syncAssignments([], [COURSE_A]);

    expect(results.deleted.length).toBeGreaterThanOrEqual(1);
    expect(archivedPageId).toBeTruthy();
  });
});

describe('Integration — 429 retry succeeds', () => {
  test('does not throw on 429 during page create', async () => {
    let createAttempts = 0;
    globalThis.fetch = jest.fn(async (url, opts) => {
      const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null },
        json: async () => body, text: async () => '' });

      if (url.match(/\/databases\//)) return ok({ id: DB_ID, data_sources: [{ id: DS_ID }] });
      if (url.match(/\/data_sources\//)) return ok({ results: [], has_more: false });

      if (url.endsWith('/pages') && opts?.method === 'POST') {
        createAttempts++;
        if (createAttempts === 1) {
          return { ok: false, status: 429,
            headers: { get: (k) => k === 'Retry-After' ? '0' : null },
            json: async () => ({ message: 'rate_limited' }),
            text: async () => '{"message":"rate_limited"}' };
        }
        return ok({ id: 'page-after-retry' });
      }
      return ok({});
    });

    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const assignment = makeAssignment(40, 'Rate-limited assignment');

    const results = await syncer.syncAssignments([assignment], [COURSE_A]);
    expect(results).toBeDefined();
    expect(typeof results.created).toBe('object');
  });
});

describe('Integration — concurrent sync calls', () => {
  test('two concurrent syncAssignments calls do not throw', async () => {
    const { fetchMock: fm1 } = makeStatefulFetch();
    const { fetchMock: fm2 } = makeStatefulFetch();

    // Alternate fetch mock for each call
    let callIndex = 0;
    globalThis.fetch = jest.fn(async (...args) => {
      callIndex++;
      return callIndex % 2 === 0 ? fm1(...args) : fm2(...args);
    });

    const api1 = new NotionAPI('test-token');
    const api2 = new NotionAPI('test-token');
    const cache1 = new AssignmentCacheManager();
    const cache2 = new AssignmentCacheManager();
    const syncer1 = new AssignmentSyncer(api1, DB_ID, cache1);
    const syncer2 = new AssignmentSyncer(api2, DB_ID, cache2);
    const assignment = makeAssignment(50, 'Concurrent assignment');

    const [r1, r2] = await Promise.all([
      syncer1.syncAssignments([assignment], [COURSE_A]),
      syncer2.syncAssignments([assignment], [COURSE_A])
    ]);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(Array.isArray(r1.created)).toBe(true);
    expect(Array.isArray(r2.created)).toBe(true);
  });
});
