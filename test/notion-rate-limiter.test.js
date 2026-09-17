import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { NotionRateLimiter } from '../src/api/notion-rate-limiter.js';
import '../src/utils/request-timing.js';
import { NotionAPI, notionRateLimiter } from '../src/api/notion-api.js';
const { RequestTimings } = globalThis;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The retry budget is what is under test here, not the burst/average pacing.
// Widening the windows keeps the queue from inserting throttle waits, and
// replacing delay() keeps backoff out of real time.
function makeTestLimiter(timings = null) {
  const limiter = new NotionRateLimiter(timings);
  limiter.maxRequestsPerSecond = Number.MAX_SAFE_INTEGER;
  limiter.averageRequestsPerSecond = Number.MAX_SAFE_INTEGER;
  limiter.delay = jest.fn(async () => {});
  return limiter;
}

// A distinct Error object per call, the way NotionAPI builds one per HTTP
// response. Counting retries on the error itself never exhausts against these.
function rateLimitError(retryAfter) {
  const error = new Error('Notion API error: 429 - {"code":"rate_limited"}');
  error.status = 429;
  if (retryAfter !== undefined) {
    error.retryAfter = retryAfter;
  }
  return error;
}

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
// NotionRateLimiter retry budget
// ---------------------------------------------------------------------------

describe('NotionRateLimiter retry budget', () => {
  test('exhausts after maxRetries attempts when every 429 is a fresh error', async () => {
    const limiter = makeTestLimiter();
    let calls = 0;

    const rejected = await limiter.execute(async () => {
      calls++;
      throw rateLimitError();
    }).catch(error => error);

    expect(calls).toBe(limiter.maxRetries);
    expect(rejected.status).toBe(429);
    expect(rejected.rateLimitExhausted).toBe(true);
    expect(rejected.rateLimitAttempts).toBe(limiter.maxRetries);
  });

  test('resolves once the rate limit clears', async () => {
    const limiter = makeTestLimiter();
    let calls = 0;

    const result = await limiter.execute(async () => {
      calls++;
      if (calls < 3) throw rateLimitError();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('backs off exponentially and never below Retry-After', async () => {
    const limiter = makeTestLimiter();

    await limiter.execute(async () => {
      throw rateLimitError(30000);
    }).catch(() => {});

    const waits = limiter.delay.mock.calls.map(([ms]) => ms);
    expect(waits).toEqual([30000, 30000, 30000, 30000]);

    const plain = makeTestLimiter();
    await plain.execute(async () => {
      throw rateLimitError();
    }).catch(() => {});
    expect(plain.delay.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000]);
  });

  test('caps the exponential component at maxRetryDelay', () => {
    const limiter = new NotionRateLimiter();
    expect(limiter._calculateBackoff(10)).toBe(limiter.maxRetryDelay);
  });

  test('does not retry non-rate-limit errors', async () => {
    const limiter = makeTestLimiter();
    let calls = 0;

    const rejected = await limiter.execute(async () => {
      calls++;
      const error = new Error('Notion API error: 400 - bad request');
      error.status = 400;
      throw error;
    }).catch(error => error);

    expect(calls).toBe(1);
    expect(rejected.status).toBe(400);
    expect(rejected.rateLimitExhausted).toBeUndefined();
  });

  test('treats a rate_limited message without a status as rate limited', async () => {
    const limiter = makeTestLimiter();
    let calls = 0;

    await limiter.execute(async () => {
      calls++;
      throw new Error('Notion API error: {"code":"rate_limited"}');
    }).catch(() => {});

    expect(calls).toBe(limiter.maxRetries);
  });

  test('tolerates errors without a message', async () => {
    const limiter = makeTestLimiter();
    const messageless = { status: 500 };
    const rejected = await limiter.execute(async () => {
      throw messageless;
    }).catch(error => error);

    expect(rejected.status).toBe(500);
  });

  test('later queued operations still run after one exhausts its budget', async () => {
    const limiter = makeTestLimiter();
    const order = [];

    const first = limiter.execute(async () => {
      order.push('first');
      throw rateLimitError();
    }).catch(() => 'rejected');

    const second = limiter.execute(async () => {
      order.push('second');
      return 'second-ok';
    });

    await expect(first).resolves.toBe('rejected');
    await expect(second).resolves.toBe('second-ok');
    expect(order.filter(name => name === 'first')).toHaveLength(limiter.maxRetries);
    expect(order[order.length - 1]).toBe('second');
  });

  test('counts every attempt, including rate-limited ones, against the windows', async () => {
    const limiter = new NotionRateLimiter();
    limiter.delay = jest.fn(async () => {});
    let calls = 0;

    await limiter.execute(async () => {
      calls++;
      if (calls < 3) throw rateLimitError();
      return 'ok';
    });

    expect(calls).toBe(3);
    expect(limiter.requestTimes).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Regression: the real NotionAPI -> rate limiter -> executeWithRetry path
// ---------------------------------------------------------------------------

describe('NotionAPI 429 handling through the shared rate limiter', () => {
  let api;
  let originalDelay;

  beforeEach(() => {
    api = new NotionAPI('test-token');
    globalThis.fetch = jest.fn();
    originalDelay = Object.getOwnPropertyDescriptor(notionRateLimiter, 'delay');
    notionRateLimiter.delay = jest.fn(async () => {});
    notionRateLimiter.requestTimes = [];
    notionRateLimiter.maxRequestsPerSecond = Number.MAX_SAFE_INTEGER;
    notionRateLimiter.averageRequestsPerSecond = Number.MAX_SAFE_INTEGER;
  });

  afterEach(() => {
    if (originalDelay) {
      Object.defineProperty(notionRateLimiter, 'delay', originalDelay);
    } else {
      delete notionRateLimiter.delay;
    }
    notionRateLimiter.maxRequestsPerSecond = 5;
    notionRateLimiter.averageRequestsPerSecond = 3;
    notionRateLimiter.requestTimes = [];
  });

  test('stops after the limiter budget instead of retrying indefinitely', async () => {
    // A fresh Response (and therefore a fresh Error) on every attempt — the
    // shape that previously reset the retry counter forever.
    globalThis.fetch.mockResolvedValue(
      makeResponse({ code: 'rate_limited' }, 429, { 'Retry-After': '1' })
    );

    const rejected = await api.getDatabase('db1').catch(error => error);

    expect(rejected.status).toBe(429);
    expect(globalThis.fetch).toHaveBeenCalledTimes(notionRateLimiter.maxRetries);
  });

  test('succeeds when the rate limit clears mid-retry', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse({ code: 'rate_limited' }, 429))
      .mockResolvedValueOnce(makeResponse({ code: 'rate_limited' }, 429))
      .mockResolvedValueOnce(makeResponse({ id: 'db1', data_sources: [{ id: 'ds1' }] }));

    const result = await api.getDatabase('db1');

    expect(result.id).toBe('db1');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('honors Retry-After from the response headers', async () => {
    globalThis.fetch.mockResolvedValue(
      makeResponse({ code: 'rate_limited' }, 429, { 'Retry-After': '20' })
    );

    await api.getDatabase('db1').catch(() => {});

    expect(notionRateLimiter.delay.mock.calls.map(([ms]) => ms)).toEqual([20000, 20000, 20000, 20000]);
  });

  test('a queued operation after an exhausted one still completes', async () => {
    globalThis.fetch.mockImplementation(async (url) => {
      if (url.endsWith('/databases/blocked')) {
        return makeResponse({ code: 'rate_limited' }, 429);
      }
      return makeResponse({ id: 'ok-db', data_sources: [{ id: 'ds1' }] });
    });

    const blocked = api.getDatabase('blocked').catch(error => error);
    const next = api.getDatabase('ok-db');

    expect((await blocked).status).toBe(429);
    await expect(next).resolves.toMatchObject({ id: 'ok-db' });
  });

  test('a non-rate-limit failure is not absorbed by the retry budget', async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ code: 'validation_error' }, 400));

    const rejected = await api.getDatabase('db1').catch(error => error);

    expect(rejected.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// Issue #61: time the limiter spends deliberately not sending a request is not
// time Notion spent responding, so it is recorded separately.
describe('NotionRateLimiter throttle accounting', () => {
  test('records 429 backoff as waiting, not requesting', async () => {
    const timings = new RequestTimings({ label: 'Notion' });
    const limiter = makeTestLimiter(timings);

    let attempt = 0;
    const result = await limiter.execute(async () => {
      attempt++;
      if (attempt === 1) {
        const error = new Error('rate_limited');
        error.status = 429;
        error.retryAfter = 1000;
        throw error;
      }
      return 'ok';
    });

    expect(result).toBe('ok');
    const summary = timings.summary();
    expect(summary.requests).toBe(0);
    expect(summary.waits.find(row => row.reason === 'notion_rate_limit_backoff').totalMs)
      .toBeGreaterThanOrEqual(1000);
  });

  test('works without a timings sink attached', async () => {
    const limiter = makeTestLimiter();
    await expect(limiter.execute(async () => 'ok')).resolves.toBe('ok');
  });
});
