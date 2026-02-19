import { describe, test, expect, beforeEach } from '@jest/globals';
import '../src/api/canvas-rate-limiter.js';
import '../src/validators/canvas-validator.js';

const { CanvasRateLimiter, CanvasValidator } = globalThis;

// ---------------------------------------------------------------------------
// CanvasRateLimiter — queue ordering and retry behaviour
// ---------------------------------------------------------------------------

describe('CanvasRateLimiter.execute() — queue ordering', () => {
  let limiter;

  beforeEach(() => {
    limiter = new CanvasRateLimiter();
    // Stub internal delay so tests don't actually sleep
    limiter._delay = () => Promise.resolve();
  });

  test('returns results in FIFO order for sequential calls', async () => {
    const results = [];
    await Promise.all([
      limiter.execute(async () => { results.push('a'); return 'a'; }),
      limiter.execute(async () => { results.push('b'); return 'b'; }),
      limiter.execute(async () => { results.push('c'); return 'c'; })
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  test('resolves each request with its own return value', async () => {
    const [r1, r2] = await Promise.all([
      limiter.execute(async () => 42),
      limiter.execute(async () => 'hello')
    ]);
    expect(r1).toBe(42);
    expect(r2).toBe('hello');
  });

  test('retries rate-limit (403 + rate keyword) up to maxRetries then rejects', async () => {
    let calls = 0;
    const err = new Error('Rate limit exceeded');
    err.status = 403;
    await expect(
      limiter.execute(async () => {
        calls++;
        throw err;
      })
    ).rejects.toThrow('Rate limit exceeded');
    // 1 initial + 5 retries
    expect(calls).toBe(6);
  });

  test('retries succeed when rate-limit clears before maxRetries', async () => {
    let calls = 0;
    const result = await limiter.execute(async () => {
      calls++;
      if (calls < 3) {
        const e = new Error('throttled');
        e.status = 403;
        throw e;
      }
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('does not retry non-rate-limit 403 (permission denied)', async () => {
    let calls = 0;
    const err = new Error('Forbidden – you do not have permission');
    err.status = 403;
    await expect(
      limiter.execute(async () => {
        calls++;
        throw err;
      })
    ).rejects.toThrow('Forbidden');
    expect(calls).toBe(1);
  });

  test('does not retry 401 errors', async () => {
    let calls = 0;
    const err = new Error('Unauthorized');
    err.status = 401;
    await expect(
      limiter.execute(async () => {
        calls++;
        throw err;
      })
    ).rejects.toThrow('Unauthorized');
    expect(calls).toBe(1);
  });

  test('does not retry 500 errors', async () => {
    let calls = 0;
    const err = new Error('Internal Server Error');
    err.status = 500;
    await expect(
      limiter.execute(async () => {
        calls++;
        throw err;
      })
    ).rejects.toThrow('Internal Server Error');
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CanvasRateLimiter — bucket / adaptive throttling helpers
// ---------------------------------------------------------------------------

describe('CanvasRateLimiter — bucket helpers', () => {
  let limiter;

  beforeEach(() => {
    limiter = new CanvasRateLimiter();
  });

  test('_refillBucket caps at bucketCapacity', () => {
    limiter.bucket = 699;
    limiter.lastCheck = Date.now() - 10000; // lots of time → would overshoot
    limiter._refillBucket();
    expect(limiter.bucket).toBe(700);
  });

  test('_calculateDelay returns 0 when bucket is full', () => {
    limiter.bucket = 700;
    expect(limiter._calculateDelay(2)).toBe(0);
  });

  test('_calculateDelay returns positive wait when bucket < estimatedCost', () => {
    limiter.bucket = 0;
    const delay = limiter._calculateDelay(10);
    expect(delay).toBeGreaterThan(0);
  });

  test('updateFromHeaders accepts plain-object header mock', () => {
    const mockHeaders = {
      get: (k) => ({ 'X-Rate-Limit-Remaining': '300', 'X-Request-Cost': '4' }[k] ?? null)
    };
    limiter.updateFromHeaders(mockHeaders);
    expect(limiter.bucket).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// CanvasValidator — comprehensive field validation
// ---------------------------------------------------------------------------

describe('CanvasValidator.validateAssignment', () => {
  test('rejects null input', () => {
    const { valid } = CanvasValidator.validateAssignment(null);
    expect(valid).toBe(false);
  });

  test('rejects missing id', () => {
    const { valid, warnings } = CanvasValidator.validateAssignment({ name: 'Test' });
    expect(valid).toBe(false);
    expect(warnings[0]).toMatch(/id/i);
  });

  test('accepts minimal valid assignment', () => {
    const { valid, validated } = CanvasValidator.validateAssignment({
      id: 1, name: 'Homework 1', course_id: 101
    });
    expect(valid).toBe(true);
    expect(validated.name).toBe('Homework 1');
  });

  test('falls back when name is empty string', () => {
    const { valid, validated, warnings } = CanvasValidator.validateAssignment({
      id: 2, name: '   ', course_id: 101
    });
    expect(valid).toBe(true);
    expect(validated.name).toBe('Assignment 2');
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('nullifies invalid due_at', () => {
    const { valid, validated, warnings } = CanvasValidator.validateAssignment({
      id: 3, name: 'Quiz', course_id: 101, due_at: 'not-a-date'
    });
    expect(valid).toBe(true);
    expect(validated.due_at).toBeNull();
    expect(warnings.some(w => w.includes('due_at'))).toBe(true);
  });

  test('accepts valid ISO 8601 due_at', () => {
    const { valid, validated } = CanvasValidator.validateAssignment({
      id: 4, name: 'Exam', course_id: 101, due_at: '2025-06-15T23:59:00Z'
    });
    expect(valid).toBe(true);
    expect(validated.due_at).toBe('2025-06-15T23:59:00Z');
  });

  test('accepts null due_at without warnings', () => {
    const { valid, warnings } = CanvasValidator.validateAssignment({
      id: 5, name: 'Project', course_id: 101, due_at: null
    });
    expect(valid).toBe(true);
    expect(warnings.filter(w => w.includes('due_at'))).toHaveLength(0);
  });

  test('nullifies negative points_possible', () => {
    const { validated, warnings } = CanvasValidator.validateAssignment({
      id: 6, name: 'Lab', course_id: 101, points_possible: -5
    });
    expect(validated.points_possible).toBeNull();
    expect(warnings.some(w => w.includes('points_possible'))).toBe(true);
  });

  test('coerces string points_possible to number', () => {
    const { validated } = CanvasValidator.validateAssignment({
      id: 7, name: 'Lab', course_id: 101, points_possible: '100'
    });
    expect(validated.points_possible).toBe(100);
  });

  test('warns on missing course_id', () => {
    const { valid, warnings } = CanvasValidator.validateAssignment({
      id: 8, name: 'Reading', points_possible: 10
    });
    expect(valid).toBe(true);
    expect(warnings.some(w => w.includes('course_id'))).toBe(true);
  });
});

describe('CanvasValidator.validateCourse', () => {
  test('rejects null input', () => {
    const { valid } = CanvasValidator.validateCourse(null);
    expect(valid).toBe(false);
  });

  test('rejects missing id', () => {
    const { valid } = CanvasValidator.validateCourse({ course_code: 'CS101' });
    expect(valid).toBe(false);
  });

  test('falls back when course_code is missing', () => {
    const { valid, validated, warnings } = CanvasValidator.validateCourse({ id: 99 });
    expect(valid).toBe(true);
    expect(validated.course_code).toBe('Course 99');
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('accepts fully valid course', () => {
    const { valid, validated } = CanvasValidator.validateCourse({
      id: 10, course_code: 'MATH200'
    });
    expect(valid).toBe(true);
    expect(validated.course_code).toBe('MATH200');
  });
});
