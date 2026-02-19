import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock NotionRateLimiter before importing NotionAPI (ES module mock)
// ---------------------------------------------------------------------------
await jest.unstable_mockModule('../src/api/notion-rate-limiter.js', () => ({
  NotionRateLimiter: jest.fn().mockImplementation(() => ({
    execute: jest.fn(fn => fn()) // passthrough: just call the function directly
  }))
}));

const { NotionAPI } = await import('../src/api/notion-api.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body, status = 200, extraHeaders = {}) {
  const headers = new Map(Object.entries({
    'Content-Type': 'application/json',
    ...extraHeaders
  }));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers.get(k) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// ---------------------------------------------------------------------------
// getDatabase
// ---------------------------------------------------------------------------

describe('NotionAPI.getDatabase', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    global.fetch = jest.fn();
  });

  test('returns parsed JSON on 200', async () => {
    const payload = { id: 'db1', data_sources: [{ id: 'ds1', type: 'database' }] };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    const result = await api.getDatabase('db1');
    expect(result.id).toBe('db1');
    expect(result.data_sources[0].id).toBe('ds1');
  });

  test('throws with status on non-200', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ message: 'not found' }, 404));
    await expect(api.getDatabase('bad')).rejects.toMatchObject({ status: 404 });
  });

  test('attaches retryAfter on 429', async () => {
    // Override executeWithRetry to skip retries so we see the error immediately
    api.executeWithRetry = (fn) => fn();
    global.fetch.mockResolvedValueOnce(
      makeResponse({ message: 'rate_limited' }, 429, { 'Retry-After': '2' })
    );
    const err = await api.getDatabase('db1').catch(e => e);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(2000); // Retry-After: 2 → 2000ms
  });

  test('includes Authorization header with Bearer token', async () => {
    const payload = { id: 'db1', data_sources: [{ id: 'ds1' }] };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    await api.getDatabase('db1');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });
});

// ---------------------------------------------------------------------------
// queryDataSource
// ---------------------------------------------------------------------------

describe('NotionAPI.queryDataSource', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    global.fetch = jest.fn();
  });

  test('returns results on success', async () => {
    const payload = { results: [{ id: 'page1' }], has_more: false };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    const result = await api.queryDataSource('ds1', {});
    expect(result.results).toHaveLength(1);
  });

  test('sends filter in request body when provided', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ results: [], has_more: false }));
    const filter = { property: 'Name', rich_text: { equals: 'test' } };
    await api.queryDataSource('ds1', filter);
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.filter).toEqual(filter);
  });

  test('omits filter key when filter is empty object', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ results: [], has_more: false }));
    await api.queryDataSource('ds1', {});
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.filter).toBeUndefined();
  });

  test('passes start_cursor when provided in options', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ results: [], has_more: false }));
    await api.queryDataSource('ds1', {}, { start_cursor: 'cursor123' });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.start_cursor).toBe('cursor123');
  });

  test('throws on 401', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ message: 'unauthorized' }, 401));
    await expect(api.queryDataSource('ds1', {})).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// createPage
// ---------------------------------------------------------------------------

describe('NotionAPI.createPage', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    global.fetch = jest.fn();
  });

  test('returns created page on 200', async () => {
    const payload = { id: 'new-page-id', properties: {} };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    const result = await api.createPage('ds1', { title: 'Test' });
    expect(result.id).toBe('new-page-id');
  });

  test('sends data_source_id as parent type', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ id: 'p1' }));
    await api.createPage('ds42', {});
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.parent.type).toBe('data_source_id');
    expect(body.parent.data_source_id).toBe('ds42');
  });

  test('throws 409 conflict error', async () => {
    // After retries, 409 should propagate
    global.fetch.mockResolvedValue(makeResponse({ message: 'conflict' }, 409));
    await expect(api.createPage('ds1', {})).rejects.toMatchObject({ status: 409 });
  });

  test('throws on 500 after limited retries', async () => {
    global.fetch.mockResolvedValue(makeResponse({ message: 'server error' }, 500));
    await expect(api.createPage('ds1', {})).rejects.toMatchObject({ status: 500 });
  });
});

// ---------------------------------------------------------------------------
// updatePage
// ---------------------------------------------------------------------------

describe('NotionAPI.updatePage', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    global.fetch = jest.fn();
  });

  test('returns updated page on success', async () => {
    const payload = { id: 'page1', archived: false };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    const result = await api.updatePage('page1', { Status: { select: { name: 'Done' } } });
    expect(result.id).toBe('page1');
  });

  test('sends archived flag when provided in options', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ id: 'page1' }));
    await api.updatePage('page1', {}, { archived: true });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.archived).toBe(true);
  });

  test('throws 404 when page not found', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ message: 'not found' }, 404));
    await expect(api.updatePage('missing', {})).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// getPage
// ---------------------------------------------------------------------------

describe('NotionAPI.getPage', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    global.fetch = jest.fn();
  });

  test('returns page data on 200', async () => {
    const payload = { id: 'page1', properties: { Status: { select: { name: 'To Do' } } } };
    global.fetch.mockResolvedValueOnce(makeResponse(payload));
    const result = await api.getPage('page1');
    expect(result.properties.Status.select.name).toBe('To Do');
  });

  test('throws on 404', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ message: 'not found' }, 404));
    await expect(api.getPage('bad-id')).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// executeWithRetry — internal retry logic
// ---------------------------------------------------------------------------

describe('NotionAPI.executeWithRetry', () => {
  let api;

  beforeEach(() => {
    api = new NotionAPI('test-token');
  });

  test('returns result on first success', async () => {
    const result = await api.executeWithRetry(async () => 'ok', 'testOp');
    expect(result).toBe('ok');
  });

  test('retries 409 conflict with backoff and eventually throws', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('conflict');
      err.status = 409;
      throw err;
    };
    await expect(api.executeWithRetry(fn, 'testOp', 3)).rejects.toMatchObject({ status: 409 });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('retries 429 rate limit and eventually throws', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('rate_limited');
      err.status = 429;
      err.retryAfter = 0; // no real wait in tests
      throw err;
    };
    await expect(api.executeWithRetry(fn, 'testOp', 3)).rejects.toMatchObject({ status: 429 });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('does not retry 401 (throws immediately)', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    };
    await expect(api.executeWithRetry(fn, 'testOp', 5)).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
  });

  test('retries 500 up to 2 additional times then throws', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      const err = new Error('Server Error');
      err.status = 500;
      throw err;
    };
    await expect(api.executeWithRetry(fn, 'testOp', 5)).rejects.toMatchObject({ status: 500 });
    // Retries for 500: attempt 1, attempt 2, attempt 3 (attempt < 3), then breaks
    expect(calls).toBe(3);
  });

  test('succeeds after 409 conflict clears', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) {
        const err = new Error('conflict');
        err.status = 409;
        throw err;
      }
      return 'success';
    };
    const result = await api.executeWithRetry(fn, 'testOp', 5);
    expect(result).toBe('success');
    expect(calls).toBe(2);
  });
});
