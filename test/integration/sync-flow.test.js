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
          },
          ...(p.status !== undefined
            ? { 'Status': { select: p.status === null ? null : { name: p.status } } }
            : {})
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
      const status = body.properties?.Status?.select?.name;
      if (canvasIdProp) {
        pages.set(canvasIdProp, { pageId, canvasId: canvasIdProp, archived: false, status });
      }
      return ok({ id: pageId });
    }

    // Page get (GET /pages/:id)
    if (url.match(/\/pages\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) {
      const pageId = url.split('/').pop();
      const entry = Array.from(pages.values()).find(p => p.pageId === pageId);
      const properties = entry?.status !== undefined
        ? { Status: entry.status === null ? null : { select: { name: entry.status } } }
        : {};
      return ok({ id: pageId, properties });
    }

    // Page update (PATCH /pages/:id)
    if (url.match(/\/pages\/[^/]+$/) && opts?.method === 'PATCH') {
      const pageId = url.split('/').pop();
      const body = JSON.parse(opts.body || '{}');
      // Track archive status and any Status property changes
      for (const [, v] of pages.entries()) {
        if (v.pageId === pageId) {
          if (body.archived === true) {
            v.archived = true;
          }
          if (body.properties?.Status?.select?.name !== undefined) {
            v.status = body.properties.Status.select.name;
          }
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

describe('Integration — onProgress callback', () => {
  test('calls onProgress with correct phases during sync', async () => {
    const { fetchMock } = makeStatefulFetch();
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);

    const progressCalls = [];
    const onProgress = (state) => progressCalls.push({ ...state });

    await syncer.syncAssignments(
      [makeAssignment(70, 'Progress Test')],
      [COURSE_A],
      { onProgress }
    );

    const phases = progressCalls.map(p => p.phase);
    expect(phases).toContain('reconciling');
    expect(phases).toContain('syncing');
    expect(phases).toContain('cleanup');
    expect(phases).toContain('complete');

    // Verify syncing phase has current/total
    const syncingCall = progressCalls.find(p => p.phase === 'syncing');
    expect(syncingCall.current).toBe(1);
    expect(syncingCall.total).toBe(1);
    expect(syncingCall.currentTitle).toBe('Progress Test');

    // Complete phase should have errorCount
    const completeCall = progressCalls.find(p => p.phase === 'complete');
    expect(completeCall.errorCount).toBe(0);
    expect(completeCall.errors).toEqual([]);
  });

  test('reports error count in progress when sync has errors', async () => {
    // Create a fetch mock that fails on page creation
    globalThis.fetch = jest.fn(async (url, opts) => {
      const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null },
        json: async () => body, text: async () => '' });

      if (url.match(/\/databases\//)) return ok({ id: DB_ID, data_sources: [{ id: DS_ID }] });
      if (url.match(/\/data_sources\//)) return ok({ results: [], has_more: false });

      if (url.endsWith('/pages') && opts?.method === 'POST') {
        return { ok: false, status: 500, headers: { get: () => null },
          json: async () => ({ message: 'server error' }),
          text: async () => '{"message":"server error"}' };
      }
      return ok({});
    });

    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);

    const progressCalls = [];
    const onProgress = (state) => progressCalls.push({ ...state });

    const results = await syncer.syncAssignments(
      [makeAssignment(71, 'Error Test')],
      [COURSE_A],
      { onProgress }
    );

    expect(results.errors.length).toBeGreaterThan(0);

    const completeCall = progressCalls.find(p => p.phase === 'complete');
    expect(completeCall.errorCount).toBeGreaterThan(0);
  });
});

describe('Integration — status correction via Notion truth map (issue #24)', () => {
  test('corrects a status manually regressed backward in Notion using Canvas truth', async () => {
    const { fetchMock, pages } = makeStatefulFetch();
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const assignment = makeAssignment(80, 'Graded Assignment', COURSE_A, { status: 'Graded' });

    // First sync: creates the page in Notion with status Graded, caches it.
    await syncer.syncAssignments([assignment], [COURSE_A]);
    expect(pages.get('80').status).toBe('Graded');

    // Simulate a manual out-of-band Notion edit: the user drags the status
    // back to "Not Started" directly in Notion (not through this program).
    pages.get('80').status = 'Not Started';

    // Second sync: Canvas data is unchanged (still Graded), so the
    // field-diff cache alone would report no changes and skip this
    // assignment — the Notion truth map must catch the regression instead.
    const results = await syncer.syncAssignments([assignment], [COURSE_A]);

    expect(pages.get('80').status).toBe('Graded');
    expect(results.updated.some(u => u.canvasId === '80')).toBe(true);
    expect(results.skipped.some(s => s.canvasId === '80')).toBe(false);
  });

  test('does not add getPage calls for assignments whose status has not regressed', async () => {
    const { fetchMock, pages } = makeStatefulFetch();
    globalThis.fetch = fetchMock;
    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);

    const stable1 = makeAssignment(81, 'Stable Assignment 1', COURSE_A, { status: 'Submitted' });
    const stable2 = makeAssignment(82, 'Stable Assignment 2', COURSE_A, { status: 'Not Started' });
    const regressed = makeAssignment(83, 'Regressed Assignment', COURSE_A, { status: 'Graded' });

    // First sync: create all three, cache them.
    await syncer.syncAssignments([stable1, stable2, regressed], [COURSE_A]);

    // Manually regress only one assignment's Notion status out of band.
    pages.get('83').status = 'Not Started';

    fetchMock.mockClear();
    const results = await syncer.syncAssignments([stable1, stable2, regressed], [COURSE_A]);

    // The truth map is built entirely from the data-source query already
    // made at Step 0 — this path must add zero getPage calls.
    const getPageCalls = fetchMock.mock.calls.filter(([url, opts]) =>
      /\/pages\/[^/]+$/.test(url) && (!opts?.method || opts.method === 'GET')
    );
    expect(getPageCalls.length).toBe(0);

    expect(results.updated.some(u => u.canvasId === '83')).toBe(true);
    expect(results.skipped.some(s => s.canvasId === '81')).toBe(true);
    expect(results.skipped.some(s => s.canvasId === '82')).toBe(true);
    expect(pages.get('83').status).toBe('Graded');
  });

  test('truth map null (reconciliation failed) — sync completes without throwing and attempts no status correction', async () => {
    const pages = new Map();
    let queryCallCount = 0;

    globalThis.fetch = jest.fn(async (url, opts) => {
      const ok = (body) => ({
        ok: true, status: 200, headers: { get: () => null },
        json: async () => body, text: async () => JSON.stringify(body)
      });

      if (url.match(/\/databases\//)) return ok({ id: DB_ID, data_sources: [{ id: DS_ID }] });

      if (url.match(/\/data_sources\//)) {
        queryCallCount++;
        if (queryCallCount === 1) {
          // First sync: reconciliation succeeds normally, nothing exists yet.
          return ok({ results: [], has_more: false });
        }
        // Second sync: reconciliation fails — simulate a network error.
        return { ok: false, status: 500, headers: { get: () => null },
          json: async () => ({ message: 'server error' }),
          text: async () => '{"message":"server error"}' };
      }

      if (url.endsWith('/pages') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        const pageId = 'page-truth-null';
        const canvasIdProp = body.properties?.['Canvas ID']?.rich_text?.[0]?.text?.content;
        pages.set(canvasIdProp, { pageId, status: body.properties?.Status?.select?.name });
        return ok({ id: pageId });
      }

      if (url.match(/\/pages\/[^/]+$/) && opts?.method === 'PATCH') {
        return ok({ id: url.split('/').pop() });
      }

      return ok({});
    });

    const api = new NotionAPI('test-token');
    const cache = new AssignmentCacheManager();
    const syncer = new AssignmentSyncer(api, DB_ID, cache);
    const assignment = makeAssignment(84, 'No-truth-map Assignment', COURSE_A, { status: 'Graded' });

    // First sync: creates and caches normally.
    await syncer.syncAssignments([assignment], [COURSE_A]);

    // Second sync: same Canvas data (no field diff), and Step 0's
    // reconciliation fails, so _notionTruthMap stays null. The sync must
    // complete without throwing, and — with no truth map to consult — must
    // not attempt a status correction; the assignment is simply skipped.
    let results;
    await expect((async () => { results = await syncer.syncAssignments([assignment], [COURSE_A]); })())
      .resolves.not.toThrow();

    expect(results).toBeDefined();
    expect(results.errors.length).toBe(0);
    expect(results.skipped.some(s => s.canvasId === '84')).toBe(true);
    expect(results.updated.some(u => u.canvasId === '84')).toBe(false);
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
