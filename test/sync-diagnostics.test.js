/**
 * Tests for the bounded end-of-sync diagnostics summary (issue #72): the
 * category/operation breakdown behind an `errors: 7` count, the three
 * completion outcomes a count alone cannot distinguish, and the guarantee
 * that none of it carries assignment content, identifiers, or raw error text.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  SyncDiagnostics,
  SYNC_OPERATIONS,
  SYNC_OUTCOMES,
  MAX_TRACKED_COMBINATIONS,
  describeDiagnostics
} from '../src/utils/sync-diagnostics.js';
import { Analytics, ERROR_CATEGORIES, sanitizeEvent, syncCounts } from '../src/utils/analytics.js';
import { AssignmentSyncer } from '../src/sync/assignment-syncer.js';

// A failure carrying everything that must never reach a summary: a token, an
// assignment title, a Notion page ID, and a URL.
const LEAKY_MESSAGE =
  'Notion 401 unauthorized for "Essay 2: Rhetoric" (page 8f0a-..., db 91ab) ' +
  'token ntn_secret123 at https://api.notion.com/v1/pages/8f0a';

function leakyError(status) {
  const error = new Error(LEAKY_MESSAGE);
  if (status !== undefined) error.status = status;
  return error;
}

function statusError(status, message = 'request failed') {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ---------------------------------------------------------------------------
// SyncDiagnostics
// ---------------------------------------------------------------------------

describe('SyncDiagnostics outcomes', () => {
  test('a run with no items at all is empty, not clean', () => {
    const summary = new SyncDiagnostics().summarize({ itemsProcessed: 0, itemsSucceeded: 0 });
    expect(summary.outcome).toBe('empty');
    expect(summary.itemErrors).toBe(0);
    expect(summary.dominantCategory).toBe('none');
  });

  test('every item succeeding is clean', () => {
    const summary = new SyncDiagnostics().summarize({ itemsProcessed: 12, itemsSucceeded: 12 });
    expect(summary.outcome).toBe('clean');
  });

  test('mixed successes and failures is partial', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(statusError(500), 'update');
    diagnostics.recordItemError(statusError(500), 'update');
    const summary = diagnostics.summarize({ itemsProcessed: 10, itemsSucceeded: 8 });

    expect(summary.outcome).toBe('partial');
    expect(summary.itemErrors).toBe(2);
    expect(summary.categories).toEqual({ server: 2 });
    expect(summary.operations).toEqual({ update: 2 });
    expect(summary.combinations).toEqual({ 'server:update': 2 });
    expect(summary.dominantCategory).toBe('server');
  });

  test('no item surviving is all_failed, distinct from partial', () => {
    const diagnostics = new SyncDiagnostics();
    for (let i = 0; i < 4; i++) diagnostics.recordItemError(statusError(401), 'update');
    const summary = diagnostics.summarize({ itemsProcessed: 4, itemsSucceeded: 0 });

    expect(summary.outcome).toBe('all_failed');
    expect(summary.dominantCategory).toBe('authentication');
    expect(SYNC_OUTCOMES).toContain(summary.outcome);
  });

  test('negative or non-finite tallies degrade to zero rather than an invalid outcome', () => {
    const summary = new SyncDiagnostics().summarize({ itemsProcessed: NaN, itemsSucceeded: -3 });
    expect(summary.outcome).toBe('empty');
    expect(summary).toMatchObject({ itemsProcessed: 0, itemsSucceeded: 0 });
  });

  test('summarize() defaults to an empty run when given nothing', () => {
    expect(new SyncDiagnostics().summarize().outcome).toBe('empty');
  });
});

describe('SyncDiagnostics categorization safety', () => {
  test('keeps only the allowlisted category and operation, never the error text', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(leakyError(401), 'update');
    const summary = diagnostics.summarize({ itemsProcessed: 1, itemsSucceeded: 0 });
    const serialized = JSON.stringify(summary);

    expect(summary.categories).toEqual({ authentication: 1 });
    for (const secret of ['ntn_secret123', 'Essay 2', 'Rhetoric', '8f0a', '91ab', 'api.notion.com', 'unauthorized']) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('every recorded category comes from the analytics contract allowlist', () => {
    const diagnostics = new SyncDiagnostics();
    for (const error of [statusError(401), statusError(403), statusError(404), statusError(429),
      statusError(500), statusError(400), new Error('failed to fetch'), 'network timeout',
      new Error('Notion credentials not configured'), new Error('something nobody predicted')]) {
      diagnostics.recordItemError(error, 'update');
    }
    const summary = diagnostics.summarize({ itemsProcessed: 10, itemsSucceeded: 0 });

    for (const category of Object.keys(summary.categories)) {
      expect(ERROR_CATEGORIES).toContain(category);
    }
    expect(Object.keys(summary.categories).length).toBeGreaterThan(1);
  });

  test.each([
    ['assignment title as an operation', 'Essay 2: Rhetoric'],
    ['an object', { stage: 'update' }],
    ['undefined', undefined]
  ])('replaces an operation that is not allowlisted (%s) with "unknown"', (_label, operation) => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(statusError(500), operation);
    const summary = diagnostics.summarize({ itemsProcessed: 1, itemsSucceeded: 0 });

    expect(summary.operations).toEqual({ unknown: 1 });
    for (const stage of Object.keys(summary.operations)) expect(SYNC_OPERATIONS).toContain(stage);
  });

  test('a dominant category tie resolves the same way every run', () => {
    const build = () => {
      const diagnostics = new SyncDiagnostics();
      diagnostics.recordItemError(statusError(401), 'update');
      diagnostics.recordItemError(statusError(500), 'create');
      return diagnostics.summarize({ itemsProcessed: 2, itemsSucceeded: 0 }).dominantCategory;
    };
    expect(build()).toBe(build());
    expect(ERROR_CATEGORIES).toContain(build());
  });
});

describe('SyncDiagnostics bounded volume', () => {
  test('thousands of failures stay a fixed-size summary', () => {
    const diagnostics = new SyncDiagnostics();
    for (let i = 0; i < 5000; i++) {
      diagnostics.recordItemError(statusError(i % 2 === 0 ? 500 : 429), i % 2 === 0 ? 'update' : 'create');
    }
    const summary = diagnostics.summarize({ itemsProcessed: 5000, itemsSucceeded: 0 });

    // Occurrences are all counted; the object holding them does not grow with them.
    expect(summary.itemErrors).toBe(5000);
    expect(Object.keys(summary.combinations)).toHaveLength(2);
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
  });

  test('distinct category/operation pairs are capped, with the overflow still counted', () => {
    const diagnostics = new SyncDiagnostics({ maxCombinations: 2 });
    diagnostics.recordItemError(statusError(500), 'update');
    diagnostics.recordItemError(statusError(429), 'create');
    diagnostics.recordItemError(statusError(401), 'delete');
    diagnostics.recordItemError(statusError(404), 'lookup');
    const summary = diagnostics.summarize({ itemsProcessed: 4, itemsSucceeded: 0 });

    expect(Object.keys(summary.combinations)).toHaveLength(2);
    expect(summary.untrackedCombinations).toBe(2);
    expect(summary.itemErrors).toBe(4);
  });

  test('the default cap covers the contract\'s own category/operation lists', () => {
    expect(MAX_TRACKED_COMBINATIONS).toBeGreaterThanOrEqual(ERROR_CATEGORIES.length);
    expect(MAX_TRACKED_COMBINATIONS).toBeGreaterThanOrEqual(SYNC_OPERATIONS.length);
  });
});

describe('SyncDiagnostics tolerated failures', () => {
  test('are counted apart from item errors, never added to them', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(statusError(500), 'update');
    diagnostics.recordSuppressedError(statusError(429), 'reconcile');
    diagnostics.recordSuppressedError(leakyError(401), 'status_preservation');
    const summary = diagnostics.summarize({ itemsProcessed: 5, itemsSucceeded: 4 });

    expect(summary.itemErrors).toBe(1);
    expect(summary.suppressedErrors).toBe(2);
    expect(summary.suppressed).toEqual({ 'rate_limit:reconcile': 1, 'authentication:status_preservation': 1 });
    // A run whose items all landed is still clean, however much it had to tolerate.
    expect(summary.outcome).toBe('partial');
    expect(JSON.stringify(summary)).not.toContain('ntn_secret123');
  });

  test('tolerated failures alone leave an otherwise error-free run clean', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordSuppressedError(statusError(500), 'reconcile');
    const summary = diagnostics.summarize({ itemsProcessed: 3, itemsSucceeded: 3 });

    expect(summary.outcome).toBe('clean');
    expect(summary.itemErrors).toBe(0);
    expect(summary.suppressedErrors).toBe(1);
  });
});

describe('SyncDiagnostics sections (shared with per-request timing, #61)', () => {
  test('an attached aggregate rides along in the same summary', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordSection('requests', { '/api/v1/courses/:id/assignments': { calls: 4, totalMs: 900 } });
    const summary = diagnostics.summarize({ itemsProcessed: 4, itemsSucceeded: 4 });

    expect(summary.sections.requests['/api/v1/courses/:id/assignments']).toEqual({ calls: 4, totalMs: 900 });
  });

  test('ignores a section without a usable name or payload', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordSection('', { calls: 1 });
    diagnostics.recordSection('requests', null);
    diagnostics.recordSection(null, { calls: 1 });
    expect(new SyncDiagnostics().summarize().sections).toBeUndefined();
    expect(diagnostics.summarize().sections).toBeUndefined();
  });
});

describe('describeDiagnostics', () => {
  test('describes the breakdown without any assignment content', () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(leakyError(401), 'update');
    diagnostics.recordSuppressedError(statusError(429), 'reconcile');
    const line = describeDiagnostics(diagnostics.summarize({ itemsProcessed: 2, itemsSucceeded: 1 }));

    expect(line).toContain('outcome partial');
    expect(line).toContain('1 item error(s)');
    expect(line).toContain('authentication:update x1');
    expect(line).toContain('1 tolerated');
    expect(line).not.toContain('Essay 2');
    expect(line).not.toContain('ntn_secret123');
  });

  test('says so rather than throwing when there is no summary', () => {
    expect(describeDiagnostics(null)).toBe('Sync diagnostics unavailable');
  });
});

// ---------------------------------------------------------------------------
// AssignmentSyncer integration
// ---------------------------------------------------------------------------

function storageMock() {
  const data = {};
  return {
    get: jest.fn(async keys => typeof keys === 'string' ? { [keys]: data[keys] } : { ...data }),
    set: jest.fn(async values => Object.assign(data, values)),
    remove: jest.fn(async keys => { for (const key of [keys].flat()) delete data[key]; })
  };
}

function fakeCache({ cached = new Map(), toDelete = [] } = {}) {
  return {
    getCachedAssignment: async id => cached.get(id) || null,
    cacheAssignment: jest.fn(async () => {}),
    getAllAssignments: async () => [],
    removeAssignment: jest.fn(async () => {}),
    setActiveCourses: jest.fn(),
    compareAndNeedsUpdate: async id => ({
      needsUpdate: true,
      changedFields: ['status'],
      cachedEntry: cached.get(id) || null
    }),
    cleanupInactiveCourses: async () => ({ toDelete, toRemove: [] })
  };
}

function fakeNotion(overrides = {}) {
  return {
    getDatabase: async () => ({ data_sources: [{ id: 'ds-1' }] }),
    getDataSource: async () => ({ properties: { Checkbox: { type: 'checkbox' } } }),
    queryDataSource: async () => ({ results: [], has_more: false }),
    getPage: async () => ({ properties: {} }),
    createPage: async () => ({ id: 'page-new' }),
    updatePage: async () => ({ id: 'page-updated' }),
    ...overrides
  };
}

function assignment(id, title = `Assignment ${id}`) {
  return {
    canvasId: String(id), title, course: 'ENG101', courseId: 'course-1',
    dueDate: '2026-09-01T23:59:00Z', points: 10, status: 'Not Started',
    link: `https://canvas.example.com/courses/1/assignments/${id}`
  };
}

describe('AssignmentSyncer end-of-sync diagnostics', () => {
  beforeEach(() => {
    globalThis.chrome = { storage: { local: storageMock() } };
    // Debug.error always writes; these tests deliberately fail items.
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('a clean run reports outcome clean with no breakdown', async () => {
    const syncer = new AssignmentSyncer(fakeNotion(), 'db-1', fakeCache());
    const results = await syncer.syncAssignments([assignment(1), assignment(2)], ['course-1']);

    expect(results.diagnostics.outcome).toBe('clean');
    expect(results.diagnostics.itemErrors).toBe(0);
    expect(results.diagnostics.itemsSucceeded).toBe(2);
    expect(results.diagnostics.dominantCategory).toBe('none');
  });

  test('a run with no assignments reports empty', async () => {
    const syncer = new AssignmentSyncer(fakeNotion(), 'db-1', fakeCache());
    const results = await syncer.syncAssignments([], []);

    expect(results.diagnostics.outcome).toBe('empty');
    expect(results.diagnostics.itemsProcessed).toBe(0);
  });

  test('mixed successes and failures label the failing operation and category', async () => {
    let calls = 0;
    const notion = fakeNotion({
      createPage: async () => {
        calls++;
        if (calls === 2) throw statusError(500, 'Notion server error');
        return { id: `page-${calls}` };
      }
    });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache());
    const results = await syncer.syncAssignments([assignment(1), assignment(2), assignment(3)], ['course-1']);

    expect(results.errors).toHaveLength(1);
    expect(results.diagnostics.outcome).toBe('partial');
    // Occurrences match the reported error count exactly, so a report can
    // never double-count one failure as both.
    expect(results.diagnostics.itemErrors).toBe(results.errors.length);
    expect(results.diagnostics.combinations).toEqual({ 'server:create': 1 });
  });

  test('every item failing reports all_failed rather than another partial run', async () => {
    const notion = fakeNotion({ createPage: async () => { throw statusError(401, 'API token is invalid'); } });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache());
    const results = await syncer.syncAssignments([assignment(1), assignment(2)], ['course-1']);

    expect(results.diagnostics.outcome).toBe('all_failed');
    expect(results.diagnostics.itemErrors).toBe(2);
    expect(results.diagnostics.dominantCategory).toBe('authentication');
    expect(results.diagnostics.operations).toEqual({ create: 2 });
  });

  test('an update failure is labelled update, not create', async () => {
    const cached = new Map([['1', { notionPageId: 'page-1' }]]);
    const notion = fakeNotion({ updatePage: async () => { throw statusError(429, 'rate limited'); } });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache({ cached }));
    const results = await syncer.syncAssignments([assignment(1)], ['course-1']);

    expect(results.diagnostics.combinations).toEqual({ 'rate_limit:update': 1 });
  });

  test('a deletion failure is counted as an item error under the delete operation', async () => {
    const toDelete = [{ canvasId: '9', notionPageId: 'page-9', courseId: 'course-1' }];
    const notion = fakeNotion({
      updatePage: async (pageId, properties, options) => {
        if (options?.archived) throw statusError(404, 'page not found');
        return { id: pageId };
      }
    });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache({ toDelete }));
    const results = await syncer.syncAssignments([assignment(1)], ['course-1']);

    expect(results.errors).toHaveLength(1);
    expect(results.diagnostics.outcome).toBe('partial');
    expect(results.diagnostics.combinations).toEqual({ 'not_found:delete': 1 });
    expect(results.diagnostics.itemErrors).toBe(results.errors.length);
  });

  test('failures the sync tolerates are recorded without failing the run', async () => {
    const cached = new Map([['1', { notionPageId: 'page-1' }]]);
    const notion = fakeNotion({
      queryDataSource: async () => { throw statusError(503, 'Notion unavailable'); },
      getPage: async () => { throw statusError(403, 'no access to page'); }
    });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache({ cached }));
    const results = await syncer.syncAssignments([assignment(1)], ['course-1']);

    expect(results.errors).toHaveLength(0);
    expect(results.diagnostics.outcome).toBe('clean');
    expect(results.diagnostics.suppressed).toMatchObject({
      'server:reconcile': 1,
      'permission:status_preservation': 1
    });
  });

  test('a schema read that fails before the loop belongs to the same run', async () => {
    const notion = fakeNotion({ getDataSource: async () => { throw statusError(500, 'schema read failed'); } });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache());
    const results = await syncer.syncAssignments([assignment(1)], ['course-1']);

    expect(results.diagnostics.suppressed).toMatchObject({ 'server:schema': 1 });
  });

  test('one run\'s failures never carry into the next', async () => {
    let failNext = true;
    const notion = fakeNotion({
      createPage: async () => {
        if (failNext) throw statusError(500, 'Notion server error');
        return { id: 'page-1' };
      }
    });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache());

    const first = await syncer.syncAssignments([assignment(1)], ['course-1']);
    expect(first.diagnostics.itemErrors).toBe(1);

    failNext = false;
    const second = await syncer.syncAssignments([assignment(1)], ['course-1']);
    expect(second.diagnostics.itemErrors).toBe(0);
    expect(second.diagnostics.outcome).toBe('clean');
  });

  test('the sync log gets the breakdown and none of the error text', async () => {
    const entries = [];
    const originalInfo = globalThis.SyncLogger.info;
    globalThis.SyncLogger.info = (message, details) => entries.push({ message, details });
    const notion = fakeNotion({ createPage: async () => { throw leakyError(401); } });
    const syncer = new AssignmentSyncer(notion, 'db-1', fakeCache());

    let results;
    try {
      results = await syncer.syncAssignments([assignment(1, 'Essay 2: Rhetoric')], ['course-1']);
    } finally {
      globalThis.SyncLogger.info = originalInfo;
    }
    const diagnosticEntry = entries.find(entry => entry.message.startsWith('Sync diagnostics:'));

    expect(diagnosticEntry).toBeDefined();
    expect(diagnosticEntry.details.diagnostics).toEqual(results.diagnostics);
    expect(JSON.stringify(diagnosticEntry)).not.toContain('ntn_secret123');
    expect(JSON.stringify(diagnosticEntry)).not.toContain('Essay 2');
  });

  test('a caller-supplied accumulator collects into the same summary', async () => {
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordSection('requests', { '/api/v1/courses': { calls: 2, totalMs: 120 } });
    const syncer = new AssignmentSyncer(fakeNotion(), 'db-1', fakeCache());

    const results = await syncer.syncAssignments([assignment(1)], ['course-1'], { diagnostics });

    expect(results.diagnostics.sections.requests['/api/v1/courses']).toEqual({ calls: 2, totalMs: 120 });
    expect(results.diagnostics.outcome).toBe('clean');
  });
});

// ---------------------------------------------------------------------------
// Analytics contract
// ---------------------------------------------------------------------------

describe('sync_completed item-error parameters', () => {
  const summaryOf = diagnostics => ({ created: [], updated: [], skipped: [], deleted: [], errors: [], diagnostics });

  test('carries the syncer\'s outcome and dominant category, and passes validation', () => {
    const results = {
      created: [{ title: 'private' }], updated: [], skipped: [], deleted: [],
      errors: [{ title: 'private', error: LEAKY_MESSAGE }],
      diagnostics: { outcome: 'partial', dominantCategory: 'network', itemErrors: 1 }
    };
    const counts = syncCounts(results, Date.now() - 10);

    expect(counts).toMatchObject({ errors: 1, item_outcome: 'partial', item_error_category: 'network' });
    const event = sanitizeEvent('sync_completed', { source: 'periodic', ...counts });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('ntn_secret123');
  });

  test('derives the outcome from the counts when a caller has no diagnostics', () => {
    const at = Date.now();
    expect(syncCounts(null, at).item_outcome).toBe('empty');
    expect(syncCounts({ created: [1], updated: [], skipped: [], deleted: [], errors: [] }, at).item_outcome).toBe('clean');
    expect(syncCounts({ created: [1], updated: [], skipped: [], deleted: [], errors: [1] }, at).item_outcome).toBe('partial');
    expect(syncCounts({ created: [], updated: [], skipped: [], deleted: [], errors: [1, 2] }, at).item_outcome).toBe('all_failed');
  });

  test('an error-free completion never reports a failure category', () => {
    const counts = syncCounts(summaryOf({ outcome: 'clean', dominantCategory: 'server' }), Date.now());
    expect(counts).toMatchObject({ item_outcome: 'clean', item_error_category: 'none' });
  });

  test.each([
    // A rejected outcome falls back to the counts, which here describe an
    // empty run — and an empty run never reports a failure category.
    ['a free-text outcome', { outcome: 'Essay 2 failed', dominantCategory: 'server' }, 'empty', 'none'],
    ['a free-text category', { outcome: 'partial', dominantCategory: LEAKY_MESSAGE }, 'partial', 'none'],
    ['no diagnostics at all', undefined, 'empty', 'none']
  ])('falls back to contract values for %s', (_label, diagnostics, outcome, category) => {
    const counts = syncCounts(summaryOf(diagnostics), Date.now());
    expect(counts.item_outcome).toBe(outcome);
    expect(counts.item_error_category).toBe(category);
    expect(sanitizeEvent('sync_completed', { source: 'popup', ...counts })).not.toBeNull();
  });

  test.each([
    ['unlisted outcome', { item_outcome: 'mostly_fine', item_error_category: 'none' }],
    ['unlisted category', { item_outcome: 'partial', item_error_category: 'notion_500' }],
    ['raw error text', { item_outcome: 'partial', item_error_category: LEAKY_MESSAGE }]
  ])('drops the whole event for %s', (_label, overrides) => {
    const counts = { ...syncCounts(null, Date.now()), ...overrides };
    expect(sanitizeEvent('sync_completed', { source: 'popup', ...counts })).toBeNull();
  });

  test('opting out sends nothing, while the local summary is still produced', async () => {
    const local = storageMock();
    globalThis.chrome = {
      storage: { local, session: storageMock() },
      runtime: { getManifest: () => ({ version: '1.1.0' }) }
    };
    globalThis.fetch = jest.fn(async () => ({ ok: true }));
    await local.set({ analyticsEnabled: false });

    const client = new Analytics({ measurementId: 'G-TEST123456', apiSecret: 'test-write-secret', debug: false });
    const diagnostics = new SyncDiagnostics();
    diagnostics.recordItemError(statusError(500), 'update');
    const summary = diagnostics.summarize({ itemsProcessed: 2, itemsSucceeded: 1 });

    const sent = await client.track('sync_completed', {
      source: 'periodic',
      ...syncCounts({ created: [], updated: [1], skipped: [], deleted: [], errors: [1], diagnostics: summary }, Date.now())
    });

    expect(sent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    // Opting out of Analytics does not switch off local diagnostics.
    expect(summary).toMatchObject({ outcome: 'partial', itemErrors: 1, dominantCategory: 'server' });
  });
});
