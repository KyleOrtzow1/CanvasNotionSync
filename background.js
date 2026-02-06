// Canvas-Notion Sync Background Service Worker

// Import all modules
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupNavigationHandlers, setupPeriodicSync, setupSecurityHandlers, getAssignmentCache } from './src/handlers/background-handlers.js';

// Initialize all handlers
setupMessageHandlers();
setupNavigationHandlers();
setupPeriodicSync();
setupSecurityHandlers();

// Initialize and load assignment cache
(async () => {
  const assignmentCache = getAssignmentCache();
  await assignmentCache.loadPersistentCache();
  assignmentCache.cleanupExpired();
})();

