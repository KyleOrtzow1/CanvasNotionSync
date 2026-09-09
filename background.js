// Canvas-Notion Sync Background Service Worker

// Import all modules
import './src/utils/debug.js';
const { Debug } = globalThis;
import './src/utils/sync-logger.js';
const { SyncLogger } = globalThis;
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupPeriodicSync, setupSecurityHandlers, getAssignmentCache } from './src/handlers/background-handlers.js';
import { setupAnalytics } from './src/utils/analytics.js';

// Initialize all handlers
setupMessageHandlers();
setupPeriodicSync();
setupSecurityHandlers();
setupAnalytics();

// Initialize debug mode and load assignment cache
(async () => {
  await Debug.init();
  await SyncLogger.init();
  const assignmentCache = getAssignmentCache();
  await assignmentCache.loadPersistentCache();
  assignmentCache.cleanupExpired();
})();

