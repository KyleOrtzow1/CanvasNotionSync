// Canvas-Notion Sync Background Service Worker

// Import all modules
import './src/utils/debug.js';
const { Debug } = globalThis;
import './src/utils/sync-logger.js';
const { SyncLogger } = globalThis;
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupNavigationHandlers, setupPeriodicSync, setupSecurityHandlers, getAssignmentCache } from './src/handlers/background-handlers.js';

// Initialize all handlers
setupMessageHandlers();
setupNavigationHandlers();
setupPeriodicSync();
setupSecurityHandlers();

// Initialize debug mode and load assignment cache
(async () => {
  await Debug.init();
  await SyncLogger.init();
  const assignmentCache = getAssignmentCache();
  await assignmentCache.loadPersistentCache();
  assignmentCache.cleanupExpired();
})();

