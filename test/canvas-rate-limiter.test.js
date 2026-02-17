import { describe, test, expect, beforeEach } from '@jest/globals';
import '../src/api/canvas-rate-limiter.js';
const { CanvasRateLimiter } = globalThis;

describe('CanvasRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new CanvasRateLimiter();
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(limiter.bucketCapacity).toBe(700);
      expect(limiter.bucket).toBe(700);
      expect(limiter.leakRate).toBe(10);
      expect(limiter.defaultEstimatedCost).toBe(2);
      expect(limiter.maxRetries).toBe(5);
      expect(limiter.requestQueue).toEqual([]);
      expect(limiter.processing).toBe(false);
    });
  });

  describe('_refillBucket', () => {
    test('adds correct units based on elapsed time', () => {
      limiter.bucket = 500;
      limiter.lastCheck = Date.now() - 2000; // 2 seconds ago
      limiter._refillBucket();
      // Should add 2s * 10 units/s = 20 units
      expect(limiter.bucket).toBeCloseTo(520, 0);
    });

    test('caps bucket at capacity', () => {
      limiter.bucket = 695;
      limiter.lastCheck = Date.now() - 2000; // 2 seconds ago
      limiter._refillBucket();
      expect(limiter.bucket).toBe(700);
    });

    test('handles zero elapsed time', () => {
      limiter.bucket = 500;
      limiter.lastCheck = Date.now();
      limiter._refillBucket();
      expect(limiter.bucket).toBeCloseTo(500, 0);
    });
  });

  describe('_calculateDelay', () => {
    test('returns 0 in green zone (bucket > 100)', () => {
      limiter.bucket = 500;
      expect(limiter._calculateDelay(2)).toBe(0);
    });

    test('returns 0 at exactly the low threshold', () => {
      limiter.bucket = 100;
      expect(limiter._calculateDelay(2)).toBe(0);
    });

    test('returns proportional delay in yellow zone (30-100)', () => {
      limiter.bucket = 65; // Midpoint of 30-100
      const delay = limiter._calculateDelay(2);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(200);
    });

    test('returns 500ms in red zone (bucket < 30)', () => {
      limiter.bucket = 20;
      expect(limiter._calculateDelay(2)).toBe(500);
    });

    test('returns refill wait time when bucket < estimated cost', () => {
      limiter.bucket = 0;
      const delay = limiter._calculateDelay(5);
      // Should wait (5 - 0) / 10 * 1000 = 500ms
      expect(delay).toBe(500);
    });

    test('returns refill wait time for partially empty bucket', () => {
      limiter.bucket = 1;
      const delay = limiter._calculateDelay(3);
      // Should wait (3 - 1) / 10 * 1000 = 200ms
      expect(delay).toBe(200);
    });
  });

  describe('_isRateLimitError', () => {
    test('detects rate limit 403 with "rate" in message', () => {
      const error = new Error('Canvas API error: 403 Forbidden - Rate Limit Exceeded');
      error.status = 403;
      expect(limiter._isRateLimitError(error)).toBe(true);
    });

    test('detects rate limit 403 with "throttl" in message', () => {
      const error = new Error('Request throttled by Canvas');
      error.status = 403;
      expect(limiter._isRateLimitError(error)).toBe(true);
    });

    test('detects rate limit 403 with "limit" in message', () => {
      const error = new Error('API limit exceeded');
      error.status = 403;
      expect(limiter._isRateLimitError(error)).toBe(true);
    });

    test('does not treat permission 403 as rate limit', () => {
      const error = new Error('You do not have permission to access this resource');
      error.status = 403;
      expect(limiter._isRateLimitError(error)).toBe(false);
    });

    test('does not treat non-403 errors as rate limit', () => {
      const error = new Error('Rate limit exceeded');
      error.status = 500;
      expect(limiter._isRateLimitError(error)).toBe(false);
    });

    test('handles missing message', () => {
      const error = new Error();
      error.status = 403;
      expect(limiter._isRateLimitError(error)).toBe(false);
    });
  });

  describe('_calculateBackoff', () => {
    test('produces increasing delays across attempts', () => {
      // Use fixed seed-like approach: check that base values increase
      const delays = [];
      for (let i = 0; i < 5; i++) {
        delays.push(limiter._calculateBackoff(i));
      }

      // Each delay should be roughly double the previous (with jitter)
      // attempt 0: ~1000ms, attempt 1: ~2000ms, attempt 2: ~4000ms, etc.
      expect(delays[0]).toBeGreaterThanOrEqual(800);  // 1000 - 20%
      expect(delays[0]).toBeLessThanOrEqual(1200);     // 1000 + 20%
      expect(delays[1]).toBeGreaterThanOrEqual(1600);  // 2000 - 20%
      expect(delays[1]).toBeLessThanOrEqual(2400);     // 2000 + 20%
      expect(delays[2]).toBeGreaterThanOrEqual(3200);  // 4000 - 20%
      expect(delays[2]).toBeLessThanOrEqual(4800);     // 4000 + 20%
    });

    test('caps at 16000ms', () => {
      const delay = limiter._calculateBackoff(10); // 2^10 * 1000 = 1024000
      expect(delay).toBeLessThanOrEqual(16000);
    });
  });

  describe('updateFromHeaders', () => {
    test('updates bucket from X-Rate-Limit-Remaining', () => {
      const headers = new Map([
        ['X-Rate-Limit-Remaining', '450'],
        ['X-Request-Cost', '3.5']
      ]);
      headers.get = (key) => headers.has(key) ? headers.get(key) : null;
      // Fix: Map.get conflicts with our usage, use a plain object with get method
      const mockHeaders = {
        get: (key) => {
          const map = { 'X-Rate-Limit-Remaining': '450', 'X-Request-Cost': '3.5' };
          return map[key] || null;
        }
      };

      limiter.updateFromHeaders(mockHeaders);
      expect(limiter.bucket).toBe(450);
    });

    test('updates estimated cost via moving average', () => {
      const mockHeaders = {
        get: (key) => {
          const map = { 'X-Rate-Limit-Remaining': '600', 'X-Request-Cost': '5.0' };
          return map[key] || null;
        }
      };

      limiter.updateFromHeaders(mockHeaders);
      // Moving average: 2 * 0.7 + 5 * 0.3 = 1.4 + 1.5 = 2.9
      expect(limiter.defaultEstimatedCost).toBeCloseTo(2.9, 1);
    });

    test('handles missing headers gracefully', () => {
      const mockHeaders = {
        get: () => null
      };

      limiter.bucket = 500;
      limiter.updateFromHeaders(mockHeaders);
      expect(limiter.bucket).toBe(500); // Unchanged
    });

    test('returns parsed cost and remaining', () => {
      const mockHeaders = {
        get: (key) => {
          const map = { 'X-Rate-Limit-Remaining': '350', 'X-Request-Cost': '2.5' };
          return map[key] || null;
        }
      };

      const result = limiter.updateFromHeaders(mockHeaders);
      expect(result.cost).toBe(2.5);
      expect(result.remaining).toBe(350);
    });

    test('converges estimated cost over multiple updates', () => {
      const mockHeaders = {
        get: (key) => {
          const map = { 'X-Rate-Limit-Remaining': '600', 'X-Request-Cost': '4.0' };
          return map[key] || null;
        }
      };

      // Apply several updates with cost=4.0
      for (let i = 0; i < 20; i++) {
        limiter.updateFromHeaders(mockHeaders);
      }
      // Should converge toward 4.0
      expect(limiter.defaultEstimatedCost).toBeCloseTo(4.0, 0);
    });
  });

  describe('execute', () => {
    test('resolves with request result', async () => {
      const result = await limiter.execute(async () => 'test-data');
      expect(result).toBe('test-data');
    });

    test('rejects with non-rate-limit errors', async () => {
      const error = new Error('Network failure');
      await expect(
        limiter.execute(async () => { throw error; })
      ).rejects.toThrow('Network failure');
    });

    test('processes requests in FIFO order', async () => {
      const order = [];

      const p1 = limiter.execute(async () => { order.push(1); return 1; });
      const p2 = limiter.execute(async () => { order.push(2); return 2; });
      const p3 = limiter.execute(async () => { order.push(3); return 3; });

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual([1, 2, 3]);
    });

    test('retries rate-limit 403 errors', async () => {
      // Stub delay to avoid real waits
      limiter._delay = () => Promise.resolve();

      let attempts = 0;
      const result = await limiter.execute(async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Rate limit exceeded');
          error.status = 403;
          throw error;
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('rejects after max retries on rate-limit 403', async () => {
      // Stub delay to avoid real waits
      limiter._delay = () => Promise.resolve();

      let attempts = 0;
      await expect(
        limiter.execute(async () => {
          attempts++;
          const error = new Error('Rate limit exceeded');
          error.status = 403;
          throw error;
        })
      ).rejects.toThrow('Rate limit exceeded');

      // 1 initial + 5 retries = 6 total attempts
      expect(attempts).toBe(6);
    });

    test('does not retry permission 403 errors', async () => {
      let attempts = 0;
      await expect(
        limiter.execute(async () => {
          attempts++;
          const error = new Error('You do not have permission');
          error.status = 403;
          throw error;
        })
      ).rejects.toThrow('You do not have permission');

      expect(attempts).toBe(1);
    });

    test('does not retry 401 errors', async () => {
      let attempts = 0;
      await expect(
        limiter.execute(async () => {
          attempts++;
          const error = new Error('Unauthorized');
          error.status = 401;
          throw error;
        })
      ).rejects.toThrow('Unauthorized');

      expect(attempts).toBe(1);
    });
  });
});
