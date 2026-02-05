/**
 * Migrates cache data from old separate Canvas/Notion caches to unified assignment cache.
 */

export class CacheMigrator {
  static CURRENT_VERSION = 1;

  /**
   * Main migration entry point - called on extension startup
   */
  static async migrate() {
    const { cache_version } = await chrome.storage.local.get(['cache_version']);

    if (cache_version >= this.CURRENT_VERSION) {
      console.log('[CacheMigrator] Already at current version, skipping migration');
      return;
    }

    console.log(`[CacheMigrator] Migrating from version ${cache_version || 0} to ${this.CURRENT_VERSION}`);

    if (!cache_version || cache_version < 1) {
      await this.migrateToV1();
    }

    await chrome.storage.local.set({ cache_version: this.CURRENT_VERSION });
    console.log('[CacheMigrator] Migration complete');
  }

  /**
   * Migrate to version 1: Transform old Notion lookup cache to unified format
   */
  static async migrateToV1() {
    console.log('[CacheMigrator] Starting V1 migration...');

    try {
      // Load old Notion lookup cache
      const { notion_lookup_cache } = await chrome.storage.local.get(['notion_lookup_cache']);

      if (!notion_lookup_cache) {
        console.log('[CacheMigrator] No old Notion cache found, starting fresh');
        await chrome.storage.local.set({ assignment_cache: {} });
        return;
      }

      console.log(`[CacheMigrator] Found ${Object.keys(notion_lookup_cache).length} old Notion cache entries`);

      // Transform to new unified format
      const assignmentCache = {};
      let migratedCount = 0;

      for (const [oldKey, oldEntry] of Object.entries(notion_lookup_cache)) {
        // Old key format: "notion:lookup:12345"
        if (!oldKey.startsWith('notion:lookup:')) continue;

        const canvasId = oldKey.replace('notion:lookup:', '');
        const newKey = `assignment:${canvasId}`;

        // Transform to new format (canvasData will be populated on next sync)
        assignmentCache[newKey] = {
          canvasData: null, // Will be populated on next sync
          notionPageId: oldEntry.notionPageId,
          lastSynced: oldEntry.timestamp || Date.now(),
          expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
          version: 1,
          migrated: true // Flag to indicate this was migrated
        };

        migratedCount++;
      }

      // Save new unified cache
      await chrome.storage.local.set({ assignment_cache: assignmentCache });
      console.log(`[CacheMigrator] Migrated ${migratedCount} entries to unified cache`);

      // Clean up old cache keys
      await this.cleanupOldCaches();

    } catch (error) {
      console.error('[CacheMigrator] Migration failed:', error);
      // On migration failure, start fresh
      await chrome.storage.local.set({ assignment_cache: {} });
      throw error;
    }
  }

  /**
   * Remove old cache storage keys after successful migration
   */
  static async cleanupOldCaches() {
    console.log('[CacheMigrator] Cleaning up old cache keys...');

    const keysToRemove = [
      'notion_lookup_cache',
      'canvas_cache',
      'notion_cache'
    ];

    await chrome.storage.local.remove(keysToRemove);
    console.log('[CacheMigrator] Old cache keys removed');
  }

  /**
   * Get current cache version
   */
  static async getCurrentVersion() {
    const { cache_version } = await chrome.storage.local.get(['cache_version']);
    return cache_version || 0;
  }

  /**
   * Force re-migration (for testing/debugging)
   */
  static async forceMigration() {
    await chrome.storage.local.remove(['cache_version']);
    await this.migrate();
  }
}
