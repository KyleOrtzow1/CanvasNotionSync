import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { CacheManager } from '../src/cache/cache-manager.js';
import { AssignmentCacheManager } from '../src/cache/assignment-cache-manager.js';

// ---------------------------------------------------------------------------
// Chrome storage mock — set up once before all tests
// ---------------------------------------------------------------------------

const mockStorage = {
  data: {},
  get: jest.fn(async (key) => {
    const result = {};
    if (key && typeof key === 'string') {
      result[key] = mockStorage.data[key];
    }
    return result;
  }),
  set: jest.fn(async (obj) => {
    Object.assign(mockStorage.data, obj);
  }),
  remove: jest.fn(async (key) => {
    if (typeof key === 'string') delete mockStorage.data[key];
    if (Array.isArray(key)) key.forEach(k => delete mockStorage.data[k]);
  })
};

globalThis.chrome = {
  storage: { local: mockStorage }
};

// ---------------------------------------------------------------------------
// CacheManager
// ---------------------------------------------------------------------------

describe('CacheManager', () => {
  let cache;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.data = {};
    cache = new CacheManager({ maxMemorySize: 5, defaultTTL: 60000, enablePersistence: true });
  });

  test('returns null for missing key (cache miss)', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
    expect(cache.stats.misses).toBe(1);
  });

  test('returns cached value (cache hit)', async () => {
    await cache.set('foo', 'bar');
    const result = await cache.get('foo');
    expect(result).toBe('bar');
    expect(cache.stats.hits).toBe(1);
  });

  test('expires entry after TTL', async () => {
    await cache.set('temp', 'value', 1); // 1ms TTL
    await new Promise(r => setTimeout(r, 10)); // wait >1ms
    const result = await cache.get('temp');
    expect(result).toBeNull();
  });

  test('has() returns true for live entry', async () => {
    await cache.set('x', 1);
    expect(cache.has('x')).toBe(true);
  });

  test('has() returns false for expired entry', async () => {
    await cache.set('y', 2, 1);
    await new Promise(r => setTimeout(r, 10));
    expect(cache.has('y')).toBe(false);
  });

  test('delete() removes entry', async () => {
    await cache.set('key', 'value');
    await cache.delete('key');
    expect(await cache.get('key')).toBeNull();
  });

  test('evicts LRU entry when at capacity', async () => {
    // Fill to max (5)
    for (let i = 0; i < 5; i++) {
      await cache.set(`k${i}`, `v${i}`);
    }
    // Access k1 to make k0 the least recently used
    await cache.get('k1');
    // Add one more — k0 should be evicted
    await cache.set('k5', 'v5');
    // k0 was the LRU; after access to k1, the LRU is k0 (never accessed again)
    expect(cache.stats.evictions).toBe(1);
    // Cache should be at max size
    expect(cache.cache.size).toBeLessThanOrEqual(5);
  });

  test('invalidate() removes entries matching wildcard pattern', async () => {
    await cache.set('canvas:course:1', 'a');
    await cache.set('canvas:course:2', 'b');
    await cache.set('notion:page:1', 'c');
    await cache.invalidate('canvas:course:*');
    expect(await cache.get('canvas:course:1')).toBeNull();
    expect(await cache.get('canvas:course:2')).toBeNull();
    expect(await cache.get('notion:page:1')).toBe('c');
  });

  test('persistToStorage() calls chrome.storage.local.set', async () => {
    await cache.set('persist-key', 'persist-value');
    expect(mockStorage.set).toHaveBeenCalled();
  });

  test('loadPersistentCache() loads entries from chrome.storage.local', async () => {
    // Pre-populate mock storage with a valid entry
    const futureExpiry = Date.now() + 60000;
    mockStorage.data = {
      cache_data: {
        'stored-key': { value: 'stored-value', expiresAt: futureExpiry, lastAccessed: Date.now() }
      }
    };

    const freshCache = new CacheManager({ enablePersistence: true, storageKey: 'cache_data' });
    await freshCache.loadPersistentCache();
    const result = await freshCache.get('stored-key');
    expect(result).toBe('stored-value');
  });

  test('loadPersistentCache() skips expired entries', async () => {
    const pastExpiry = Date.now() - 1000;
    mockStorage.data = {
      cache_data: {
        'expired-key': { value: 'old', expiresAt: pastExpiry, lastAccessed: Date.now() - 2000 }
      }
    };

    const freshCache = new CacheManager({ enablePersistence: true, storageKey: 'cache_data' });
    await freshCache.loadPersistentCache();
    const result = await freshCache.get('expired-key');
    expect(result).toBeNull();
  });

  test('getStats() reports hit rate', async () => {
    await cache.set('s', 1);
    await cache.get('s'); // hit
    await cache.get('missing'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('50.00%');
  });

  test('cleanupExpired() removes stale entries', async () => {
    await cache.set('stale', 'value', 1);
    await new Promise(r => setTimeout(r, 10));
    cache.cleanupExpired();
    expect(cache.cache.has('stale')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AssignmentCacheManager
// ---------------------------------------------------------------------------

describe('AssignmentCacheManager', () => {
  let cache;

  const sampleAssignment = {
    title: 'Essay 1',
    course: 'ENG101',
    courseCode: 'ENG',
    courseId: '55',
    dueDate: '2025-06-01T23:59:00Z',
    points: 50,
    status: 'Not Submitted',
    type: 'assignment',
    description: 'Write an essay',
    grade: null,
    gradePercent: null,
    link: 'https://canvas.example.com/courses/55/assignments/1',
    source: 'canvas'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.data = {};
    cache = new AssignmentCacheManager();
  });

  test('cacheAssignment() stores data and notionPageId', async () => {
    await cache.cacheAssignment('123', sampleAssignment, 'notion-page-abc');
    const entry = await cache.getCachedAssignment('123');
    expect(entry).not.toBeNull();
    expect(entry.notionPageId).toBe('notion-page-abc');
    expect(entry.canvasData.title).toBe('Essay 1');
  });

  test('getCachedAssignment() returns null for unknown ID', async () => {
    const result = await cache.getCachedAssignment('999');
    expect(result).toBeNull();
  });

  test('compareAndNeedsUpdate() returns needsUpdate=true for new assignment', async () => {
    const { needsUpdate, cachedEntry } = await cache.compareAndNeedsUpdate('new-id', sampleAssignment);
    expect(needsUpdate).toBe(true);
    expect(cachedEntry).toBeNull();
  });

  test('compareAndNeedsUpdate() returns needsUpdate=false when no fields changed', async () => {
    await cache.cacheAssignment('456', sampleAssignment, 'page-1');
    const { needsUpdate, changedFields } = await cache.compareAndNeedsUpdate('456', sampleAssignment);
    expect(needsUpdate).toBe(false);
    expect(changedFields).toHaveLength(0);
  });

  test('compareAndNeedsUpdate() detects title change', async () => {
    await cache.cacheAssignment('789', sampleAssignment, 'page-2');
    const updated = { ...sampleAssignment, title: 'Essay 1 – Revised' };
    const { needsUpdate, changedFields } = await cache.compareAndNeedsUpdate('789', updated);
    expect(needsUpdate).toBe(true);
    expect(changedFields).toContain('title');
  });

  test('compareAndNeedsUpdate() detects dueDate change', async () => {
    await cache.cacheAssignment('101', sampleAssignment, 'page-3');
    const updated = { ...sampleAssignment, dueDate: '2025-07-01T23:59:00Z' };
    const { needsUpdate, changedFields } = await cache.compareAndNeedsUpdate('101', updated);
    expect(needsUpdate).toBe(true);
    expect(changedFields).toContain('dueDate');
  });

  test('compareAndNeedsUpdate() treats null and empty string as equal', async () => {
    const assignmentWithNull = { ...sampleAssignment, grade: null };
    await cache.cacheAssignment('102', assignmentWithNull, 'page-4');
    const withEmpty = { ...sampleAssignment, grade: '' };
    const { needsUpdate } = await cache.compareAndNeedsUpdate('102', withEmpty);
    expect(needsUpdate).toBe(false);
  });

  test('updateNotionMapping() updates notionPageId without losing canvasData', async () => {
    await cache.cacheAssignment('200', sampleAssignment, 'old-page-id');
    await cache.updateNotionMapping('200', 'new-page-id');
    const entry = await cache.getCachedAssignment('200');
    expect(entry.notionPageId).toBe('new-page-id');
    expect(entry.canvasData.title).toBe('Essay 1');
  });

  test('removeAssignment() deletes the entry', async () => {
    await cache.cacheAssignment('300', sampleAssignment, 'page-5');
    await cache.removeAssignment('300');
    expect(await cache.getCachedAssignment('300')).toBeNull();
  });

  test('setActiveCourses() records active course IDs', () => {
    cache.setActiveCourses(['55', '66']);
    expect(cache.activeCourseIds.has('55')).toBe(true);
    expect(cache.activeCourseIds.has('66')).toBe(true);
  });

  test('cleanupInactiveCourses() identifies assignments from active courses as toDelete', async () => {
    await cache.cacheAssignment('400', sampleAssignment, 'page-6'); // courseId: '55'
    cache.setActiveCourses(['55']); // course 55 is active
    // Pass empty currentCanvasIds — assignment 400 is "deleted"
    const { toDelete } = await cache.cleanupInactiveCourses([]);
    const deleted = toDelete.find(e => e.canvasId === '400');
    expect(deleted).toBeDefined();
    expect(deleted.notionPageId).toBe('page-6');
  });

  test('cleanupInactiveCourses() marks assignments from inactive courses as toRemove', async () => {
    const inactiveAssignment = { ...sampleAssignment, courseId: '99' };
    await cache.cacheAssignment('500', inactiveAssignment, 'page-7');
    cache.setActiveCourses(['55']); // course 99 is NOT active
    const { toDelete, toRemove } = await cache.cleanupInactiveCourses([]);
    expect(toRemove.find(e => e.canvasId === '500')).toBeDefined();
    expect(toDelete.find(e => e.canvasId === '500')).toBeUndefined();
  });

  test('getStats() includes assignmentCount and mapping stats', async () => {
    await cache.cacheAssignment('600', sampleAssignment, 'page-8');
    await cache.cacheAssignment('601', sampleAssignment, null);
    const stats = await cache.getStats();
    expect(stats.assignmentCount).toBe(2);
    expect(stats.withNotionMapping).toBe(1);
    expect(stats.withoutNotionMapping).toBe(1);
    expect(stats.version).toBe(1);
  });

  test('getBatch() returns only found entries', async () => {
    await cache.cacheAssignment('700', sampleAssignment, 'page-9');
    const results = await cache.getBatch(['700', '701-missing']);
    expect(results.size).toBe(1);
    expect(results.has('700')).toBe(true);
  });

  test('getAllAssignments() returns all cached assignments', async () => {
    await cache.cacheAssignment('800', sampleAssignment, 'page-10');
    await cache.cacheAssignment('801', sampleAssignment, 'page-11');
    const all = await cache.getAllAssignments();
    expect(all.length).toBe(2);
  });

  test('clearAll() removes all entries and resets active courses', async () => {
    await cache.cacheAssignment('900', sampleAssignment, 'page-12');
    cache.setActiveCourses(['55']);
    await cache.clearAll();
    expect(await cache.getCachedAssignment('900')).toBeNull();
    expect(cache.activeCourseIds.size).toBe(0);
  });
});
