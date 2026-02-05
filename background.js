// Canvas-Notion Sync Background Service Worker

// Import all modules
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupNavigationHandlers, setupPeriodicSync, setupSecurityHandlers, getAssignmentCache } from './src/handlers/background-handlers.js';
import { CacheMigrator } from './src/cache/cache-migrator.js';

// Initialize all handlers
setupMessageHandlers();
setupNavigationHandlers();
setupPeriodicSync();
setupSecurityHandlers();

// Initialize cache and run migration
(async () => {
  // Run cache migration first
  await CacheMigrator.migrate();
  console.log('✅ Cache migration complete');

  // Initialize and load assignment cache
  const assignmentCache = getAssignmentCache();
  await assignmentCache.loadPersistentCache();
  assignmentCache.cleanupExpired();
  console.log('✅ Assignment cache loaded');
})();

