/**
 * Generic cache manager with TTL, LRU eviction, and optional persistence
 * @class CacheManager
 */
export class CacheManager {
  /**
   * @param {Object} config - Configuration options
   * @param {number} config.maxMemorySize - Maximum number of entries (default: 100)
   * @param {number} config.defaultTTL - Default TTL in milliseconds (default: 5 minutes)
   * @param {boolean} config.enablePersistence - Enable chrome.storage.local persistence (default: true)
   * @param {string} config.storageKey - Key for persistent storage (default: 'cache_data')
   */
  constructor(config = {}) {
    this.maxMemorySize = config.maxMemorySize || 100;
    this.defaultTTL = config.defaultTTL || 5 * 60 * 1000; // 5 minutes
    this.enablePersistence = config.enablePersistence !== false;
    this.storageKey = config.storageKey || 'cache_data';

    // In-memory cache: Map<key, {value, expiresAt, lastAccessed}>
    this.cache = new Map();

    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0
    };
  }

  /**
   * Retrieve cached value (updates access time)
   * @param {string} key - Cache key
   * @returns {any} Cached value or null if not found/expired
   */
  async get(key) {
    const entry = this.cache.get(key);

    // Check if entry exists and not expired
    if (entry && Date.now() < entry.expiresAt) {
      entry.lastAccessed = Date.now();
      this.stats.hits++;
      return entry.value;
    }

    // Entry expired or doesn't exist
    if (entry) {
      this.cache.delete(key);
    }
    this.stats.misses++;
    return null;
  }

  /**
   * Store value with optional TTL override
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - TTL in milliseconds (optional, uses defaultTTL if not provided)
   */
  async set(key, value, ttl = null) {
    const actualTTL = ttl || this.defaultTTL;
    const now = Date.now();

    const entry = {
      value,
      expiresAt: now + actualTTL,
      lastAccessed: now
    };

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxMemorySize && !this.cache.has(key)) {
      await this.evictLRU();
    }

    this.cache.set(key, entry);
    this.stats.sets++;

    // Persist to storage if enabled
    if (this.enablePersistence) {
      await this.persistToStorage();
    }
  }

  /**
   * Check if key exists and not expired
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and not expired
   */
  has(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
      return true;
    }
    if (entry) {
      this.cache.delete(key);
    }
    return false;
  }

  /**
   * Remove specific entry
   * @param {string} key - Cache key
   */
  async delete(key) {
    this.cache.delete(key);
    if (this.enablePersistence) {
      await this.persistToStorage();
    }
  }

  /**
   * Clear all entries
   */
  async clear() {
    this.cache.clear();
    if (this.enablePersistence) {
      await chrome.storage.local.remove(this.storageKey);
    }
    console.log('🗑️ Cache cleared');
  }

  /**
   * Delete entries matching pattern (supports * wildcard)
   * @param {string} pattern - Pattern to match (e.g., "canvas:course:*")
   */
  async invalidate(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let deletedCount = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`🗑️ Invalidated ${deletedCount} cache entries matching "${pattern}"`);
      if (this.enablePersistence) {
        await this.persistToStorage();
      }
    }
  }

  /**
   * Evict least recently used entry
   */
  async evictLRU() {
    let lruKey = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      console.log(`🗑️ Evicted LRU entry: ${lruKey}`);
    }
  }

  /**
   * Return cache performance metrics
   * @returns {Object} Statistics object
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxMemorySize,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Persist cache to chrome.storage.local
   */
  async persistToStorage() {
    if (!this.enablePersistence) return;

    try {
      const serialized = {};
      for (const [key, entry] of this.cache.entries()) {
        // Only persist non-expired entries
        if (Date.now() < entry.expiresAt) {
          serialized[key] = entry;
        }
      }

      await chrome.storage.local.set({ [this.storageKey]: serialized });
    } catch (error) {
      console.error('Failed to persist cache:', error.message);
    }
  }

  /**
   * Load cache from chrome.storage.local
   */
  async loadPersistentCache() {
    if (!this.enablePersistence) return;

    try {
      const result = await chrome.storage.local.get(this.storageKey);
      const serialized = result[this.storageKey];

      if (serialized) {
        const now = Date.now();
        let loadedCount = 0;

        for (const [key, entry] of Object.entries(serialized)) {
          // Only load non-expired entries
          if (now < entry.expiresAt) {
            this.cache.set(key, entry);
            loadedCount++;
          }
        }

        console.log(`✅ Loaded ${loadedCount} cache entries from storage`);
      }
    } catch (error) {
      console.error('Failed to load persistent cache:', error.message);
    }
  }

  /**
   * Cleanup expired entries
   */
  cleanupExpired() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired cache entries`);
    }
  }
}
