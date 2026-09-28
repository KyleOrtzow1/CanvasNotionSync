import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Issue #61: the Notion half of a sync's timings. Collected in the service
// worker, where the Notion requests are actually made, and logged once at the
// end of the sync rather than per request.
await jest.unstable_mockModule('../src/api/notion-rate-limiter.js', () => ({
  NotionRateLimiter: jest.fn().mockImplementation(() => ({
    execute: jest.fn(fn => fn()) // passthrough: the limiter has its own suite
  }))
}));

await import('../src/utils/request-timing.js');
const { NotionAPI, notionTimings } = await import('../src/api/notion-api.js');
const { AssignmentSyncer } = await import('../src/sync/assignment-syncer.js');
const { RequestTimings } = globalThis;

// A cache that answers everything the sync loop asks, so the run reaches the
// end-of-sync summary without the cache being what is under test.
function makeCacheStub() {
  return {
    getCachedAssignment: jest.fn(async () => null),
    cacheAssignment: jest.fn(async () => {}),
    getAllAssignments: jest.fn(async () => []),
    removeAssignment: jest.fn(async () => {}),
    compareAndNeedsUpdate: jest.fn(async () => ({ needsUpdate: true, changedFields: [], cachedEntry: null })),
    setActiveCourses: jest.fn(),
    cleanupInactiveCourses: jest.fn(async () => ({ toDelete: [], toRemove: [] }))
  };
}

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

describe('NotionAPI request timing', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    api.timings.reset();
    globalThis.fetch = jest.fn();
  });

  test('records each call under its endpoint shape, not its page ID', async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ id: 'page' }));

    await api.updatePage('1f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f', {});
    await api.updatePage('2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', {});
    await api.createPage('3c5e7a19-2b4d-4f61-9a8c-0d2e4f6a8b1c', {});

    const summary = api.timings.summary();
    expect(summary.requests).toBe(3);
    expect(summary.endpoints.find(row => row.endpoint === '/v1/pages/:id').calls).toBe(2);
    expect(summary.endpoints.find(row => row.endpoint === '/v1/pages').calls).toBe(1);
  });

  test('records a query against a data source separately from a page write', async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ results: [] }));

    await api.queryDataSource('3c5e7a19-2b4d-4f61-9a8c-0d2e4f6a8b1c', {});

    const summary = api.timings.summary();
    expect(summary.endpoints[0].endpoint).toBe('/v1/data_sources/:id/query');
  });

  test('an error response is timed and counted as an error', async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ message: 'not found' }, 404));

    await expect(api.getDatabase('7b1d9e33-4a6f-4c28-b5e0-91a3c7d5f204')).rejects.toMatchObject({ status: 404 });

    const summary = api.timings.summary();
    expect(summary.requests).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.endpoints[0].endpoint).toBe('/v1/databases/:id');
  });

  test('a retried request records one entry per attempt', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse({ message: 'conflict' }, 409))
      .mockResolvedValueOnce(makeResponse({ id: 'page' }));

    await api.updatePage('1f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f', {});

    // Two attempts really were served by Notion; folding them into one would
    // hide the cost of the retry.
    const summary = api.timings.summary();
    expect(summary.requests).toBe(2);
    expect(summary.errors).toBe(1);
  });

  test('a request that never reached Notion is recorded as failed', async () => {
    globalThis.fetch.mockRejectedValue(new Error('Failed to fetch'));

    await expect(api.getPage('1f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f')).rejects.toThrow('Failed to fetch');

    const summary = api.timings.summary();
    expect(summary.requests).toBe(1);
    expect(summary.errors).toBe(1);
  });

  test('all NotionAPI clients share one window, since they share one sync', () => {
    expect(new NotionAPI('a').timings).toBe(notionTimings);
  });
});

describe('AssignmentSyncer end-of-sync timing summary', () => {
  let timings;
  let notionAPI;

  beforeEach(() => {
    timings = new RequestTimings({ label: 'Notion' });
    notionAPI = {
      timings,
      getDatabase: jest.fn(async () => ({ data_sources: [{ id: 'ds1' }] })),
      getDataSource: jest.fn(async () => ({ properties: {} })),
      queryDataSource: jest.fn(async () => ({ results: [], has_more: false })),
      createPage: jest.fn(async () => ({ id: 'page1' })),
      updatePage: jest.fn(async () => ({ id: 'page1' })),
      getPage: jest.fn(async () => ({ properties: {} }))
    };
    globalThis.Debug.log = jest.fn();
  });

  test('starts a fresh window, so the summary describes this sync alone', async () => {
    timings.record({ url: '/v1/pages/abc', durationMs: 1234, status: 200 });

    const syncer = new AssignmentSyncer(notionAPI, 'db1');
    await syncer.syncAssignments([]);

    const logged = globalThis.Debug.log.mock.calls.map(call => String(call[0]));
    expect(logged.some(line => line.includes('1234ms'))).toBe(false);
  });

  test('logs a per-endpoint summary once the sync finishes', async () => {
    const syncer = new AssignmentSyncer(notionAPI, 'db1', makeCacheStub());
    syncer.dataSourceId = 'ds1';
    // Stand in for the requests a real run would have made.
    syncer.fetchAllNotionPages = jest.fn(async () => {
      timings.record({ url: 'https://api.notion.com/v1/data_sources/3c5e7a19-2b4d-4f61-9a8c-0d2e4f6a8b1c/query', durationMs: 120, status: 200 });
      timings.recordWait('notion_throttle', 40);
      return new Map();
    });

    await syncer.syncAssignments([
      { canvasId: '1', title: 'Essay', status: 'Not Started' }
    ]);

    const logged = globalThis.Debug.log.mock.calls.map(call => String(call[0]));
    expect(logged.some(line => line.includes('Notion request timing'))).toBe(true);
    expect(logged.some(line => line.includes('/v1/data_sources/:id/query'))).toBe(true);
    expect(logged.some(line => line.includes('40ms throttled'))).toBe(true);
  });

  test('a sync whose API client has no timings still completes', async () => {
    const syncer = new AssignmentSyncer({ ...notionAPI, timings: undefined }, 'db1');
    await expect(syncer.syncAssignments([])).resolves.toBeDefined();
  });
});
