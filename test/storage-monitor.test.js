import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock chrome APIs and Debug before importing
globalThis.chrome = {
  storage: {
    local: {
      getBytesInUse: jest.fn(async () => 1048576),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
      get: jest.fn(async () => ({})),
      QUOTA_BYTES: 10485760
    },
    onChanged: { addListener: jest.fn() }
  }
};

globalThis.Debug = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

const { checkStorageQuota, cleanupOldCache, THRESHOLDS } = await import('../src/utils/storage-monitor.js');

describe('THRESHOLDS', () => {
  test('has expected values', () => {
    expect(THRESHOLDS.WARNING).toBe(80);
    expect(THRESHOLDS.CRITICAL).toBe(90);
    expect(THRESHOLDS.CLEANUP_TARGET).toBe(70);
  });
});

describe('checkStorageQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.storage.local.QUOTA_BYTES = 10485760;
  });

  test('returns ok status for low usage (10%)', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(1048576); // 1MB = ~10%
    const result = await checkStorageQuota();
    expect(result.status).toBe('ok');
    expect(result.bytesInUse).toBe(1048576);
    expect(result.quota).toBe(10485760);
    expect(result.percentUsed).toBeCloseTo(10, 0);
  });

  test('returns warning status at 80%+', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(8388608); // 8MB = 80%
    const result = await checkStorageQuota();
    expect(result.status).toBe('warning');
  });

  test('returns critical status at 90%+', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(9437184); // 9MB = 90%
    const result = await checkStorageQuota();
    expect(result.status).toBe('critical');
  });

  test('formats bytes correctly', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(1048576);
    const result = await checkStorageQuota();
    expect(result.formattedUsed).toBe('1.00 MB');
    expect(result.formattedQuota).toBe('10.00 MB');
  });

  test('falls back to 10MB when QUOTA_BYTES is undefined', async () => {
    chrome.storage.local.QUOTA_BYTES = undefined;
    chrome.storage.local.getBytesInUse.mockResolvedValue(500);
    const result = await checkStorageQuota();
    expect(result.quota).toBe(10485760);
  });
});

describe('cleanupOldCache', () => {
  let mockCache;

  beforeEach(() => {
    jest.clearAllMocks();
    chrome.storage.local.QUOTA_BYTES = 10485760;
    mockCache = {
      cleanupExpired: jest.fn(),
      evictLRU: jest.fn(async () => {}),
      persistToStorage: jest.fn(async () => {}),
      enablePersistence: true,
      cache: new Map()
    };
  });

  test('no evictions when below target', async () => {
    // 50% usage — below 70% target
    chrome.storage.local.getBytesInUse.mockResolvedValue(5242880);
    mockCache.cache.set('a', { value: 1 });

    const result = await cleanupOldCache(mockCache);
    expect(mockCache.cleanupExpired).toHaveBeenCalled();
    expect(mockCache.evictLRU).not.toHaveBeenCalled();
    expect(result.entriesRemoved).toBe(0);
  });

  test('calls cleanupExpired first', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(5242880);
    await cleanupOldCache(mockCache);
    expect(mockCache.cleanupExpired).toHaveBeenCalledTimes(1);
  });

  test('evicts LRU entries until below target', async () => {
    // Start at 80%, drop to 65% after evictions
    let callCount = 0;
    chrome.storage.local.getBytesInUse.mockImplementation(async () => {
      callCount++;
      // After initial calls + persist, start dropping
      if (callCount <= 3) return 8388608; // 80%
      return 6815744; // 65%
    });

    mockCache.cache.set('a', { value: 1 });
    mockCache.cache.set('b', { value: 2 });
    mockCache.cache.set('c', { value: 3 });
    mockCache.cache.set('d', { value: 4 });
    mockCache.cache.set('e', { value: 5 });
    mockCache.cache.set('f', { value: 6 });

    // Simulate evictLRU removing from cache
    mockCache.evictLRU.mockImplementation(async () => {
      const firstKey = mockCache.cache.keys().next().value;
      mockCache.cache.delete(firstKey);
    });

    const result = await cleanupOldCache(mockCache);
    expect(result.entriesRemoved).toBeGreaterThan(0);
    expect(mockCache.evictLRU).toHaveBeenCalled();
  });

  test('handles empty cache gracefully', async () => {
    chrome.storage.local.getBytesInUse.mockResolvedValue(9437184); // 90%
    // cache is empty, so while loop won't execute
    const result = await cleanupOldCache(mockCache);
    expect(result.entriesRemoved).toBe(0);
  });

  test('force mode evicts entries even when below target', async () => {
    // 5% usage — well below 70% target
    chrome.storage.local.getBytesInUse.mockResolvedValue(524288);
    mockCache.cache.set('a', { value: 1 });
    mockCache.cache.set('b', { value: 2 });
    mockCache.cache.set('c', { value: 3 });

    mockCache.evictLRU.mockImplementation(async () => {
      const firstKey = mockCache.cache.keys().next().value;
      mockCache.cache.delete(firstKey);
    });

    const result = await cleanupOldCache(mockCache, { force: true });
    expect(result.entriesRemoved).toBe(3);
    expect(mockCache.cache.size).toBe(0);
  });

  test('respects max eviction cap of 50', async () => {
    // Always above target
    chrome.storage.local.getBytesInUse.mockResolvedValue(9437184);

    // Add 60 entries
    for (let i = 0; i < 60; i++) {
      mockCache.cache.set(`key${i}`, { value: i });
    }

    mockCache.evictLRU.mockImplementation(async () => {
      const firstKey = mockCache.cache.keys().next().value;
      mockCache.cache.delete(firstKey);
    });

    const result = await cleanupOldCache(mockCache);
    expect(result.entriesRemoved).toBe(50);
  });
});
