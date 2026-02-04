import { CacheManager } from './cache-manager.js';

/**
 * Notion-specific cache manager for Canvas ID → Notion Page lookups
 * @class NotionCacheManager
 * @extends CacheManager
 */
export class NotionCacheManager extends CacheManager {
  constructor() {
    super({
      maxMemorySize: 200,
      defaultTTL: 15 * 60 * 1000, // 15 minutes (Canvas ID mappings are very stable)
      enablePersistence: true,    // Persist to survive extension reloads
      storageKey: 'notion_lookup_cache'
    });
  }

  /**
   * Cache a Canvas ID → Notion Page lookup result
   * @param {string} canvasId - Canvas assignment ID
   * @param {Object} notionPage - Notion page object
   */
  async cacheLookup(canvasId, notionPage) {
    const key = `notion:lookup:${canvasId}`;
    await this.set(key, notionPage);
  }

  /**
   * Get cached Notion page for a Canvas ID
   * @param {string} canvasId - Canvas assignment ID
   * @returns {Object|null} Cached Notion page or null
   */
  async getCachedLookup(canvasId) {
    const key = `notion:lookup:${canvasId}`;
    return await this.get(key);
  }

  /**
   * Cache multiple Canvas ID → Notion Page lookups at once
   * @param {Map<string, Object>} lookupMap - Map of canvasId → notionPage
   */
  async batchCacheLookups(lookupMap) {
    const promises = [];
    for (const [canvasId, notionPage] of lookupMap.entries()) {
      promises.push(this.cacheLookup(canvasId, notionPage));
    }
    await Promise.all(promises);
  }

  /**
   * Get cached Notion pages for multiple Canvas IDs
   * @param {Array<string>} canvasIds - Array of Canvas assignment IDs
   * @returns {Map<string, Object>} Map of canvasId → notionPage for cached entries
   */
  async getCachedLookupBatch(canvasIds) {
    const cachedLookups = new Map();
    const promises = canvasIds.map(async (canvasId) => {
      const page = await this.getCachedLookup(canvasId);
      if (page) {
        cachedLookups.set(canvasId, page);
      }
    });
    await Promise.all(promises);
    return cachedLookups;
  }

  /**
   * Invalidate all Notion lookups
   */
  async invalidateAllLookups() {
    await this.invalidate('notion:lookup:*');
    console.log('🗑️ All Notion lookup cache invalidated');
  }

  /**
   * Get cache statistics specific to Notion lookups
   * @returns {Object} Statistics object
   */
  getStats() {
    const baseStats = super.getStats();

    // Count lookup entries
    let lookupCount = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith('notion:lookup:')) {
        lookupCount++;
      }
    }

    return {
      ...baseStats,
      lookupCount
    };
  }
}
