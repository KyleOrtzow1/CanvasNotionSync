import { describe, test, expect, jest } from '@jest/globals';
import { NotionRateLimiter } from '../../src/api/notion-rate-limiter.js';

jest.setTimeout(120000);

async function runQueuedRequests(limiter, requestCount) {
  const startTimes = [];

  const requests = Array.from({ length: requestCount }, (_, index) =>
    limiter.execute(async () => {
      startTimes.push(Date.now());
      return index;
    })
  );

  await Promise.all(requests);
  startTimes.sort((a, b) => a - b);
  return startTimes;
}

function maxRequestsInWindow(timestamps, windowMs) {
  let maxCount = 0;
  let left = 0;

  for (let right = 0; right < timestamps.length; right++) {
    while (timestamps[right] - timestamps[left] >= windowMs) {
      left++;
    }
    const windowCount = right - left + 1;
    if (windowCount > maxCount) {
      maxCount = windowCount;
    }
  }

  return maxCount;
}

describe('NotionRateLimiter integration (timing-based)', () => {
  test('uses the adjusted Notion rate-limit settings', () => {
    const limiter = new NotionRateLimiter();
    expect(limiter.maxRequestsPerSecond).toBe(5);
    expect(limiter.averageRequestsPerSecond).toBe(3);
    expect(limiter.averageWindow).toBe(10000);
  });

  test('enforces burst handling (max 5 request starts per second)', async () => {
    const limiter = new NotionRateLimiter();
    const starts = await runQueuedRequests(limiter, 10);

    expect(starts).toHaveLength(10);
    const firstSecondCount = starts.filter((time) => time - starts[0] < 1000).length;
    expect(firstSecondCount).toBe(5);
    expect(starts[5] - starts[0]).toBeGreaterThanOrEqual(900);
  });

  test('enforces sustained average limit (max 30 request starts per 10 seconds)', async () => {
    const limiter = new NotionRateLimiter();
    const starts = await runQueuedRequests(limiter, 40);

    expect(starts).toHaveLength(40);
    expect(maxRequestsInWindow(starts, 10000)).toBeLessThanOrEqual(30);
    expect(starts[39] - starts[0]).toBeGreaterThanOrEqual(10000);
  });

  test('holds rate limits during a large sync-sized workload (100 operations)', async () => {
    const limiter = new NotionRateLimiter();
    const starts = await runQueuedRequests(limiter, 100);

    expect(starts).toHaveLength(100);
    expect(maxRequestsInWindow(starts, 1000)).toBeLessThanOrEqual(5);
    expect(maxRequestsInWindow(starts, 10000)).toBeLessThanOrEqual(30);
  });
});
