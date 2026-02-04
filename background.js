// Canvas-Notion Sync Background Service Worker

// Import all modules
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupNavigationHandlers, setupPeriodicSync, setupSecurityHandlers, getCanvasCache, getNotionCache } from './src/handlers/background-handlers.js';

// Initialize all handlers
setupMessageHandlers();
setupNavigationHandlers();
setupPeriodicSync();
setupSecurityHandlers();

// Initialize caches and cleanup expired entries
(async () => {
  const canvasCache = getCanvasCache();
  const notionCache = getNotionCache();

  // Load persistent cache from storage
  await notionCache.loadPersistentCache();

  // Cleanup expired entries on startup
  canvasCache.cleanupExpired();
  notionCache.cleanupExpired();
})();

// Canvas rate limit monitoring - Monitor X-Rate-Limit-Remaining and X-Request-Cost
function checkCanvasRateLimit() {
  const canvasCache = getCanvasCache();
  const rateLimitInfo = canvasCache.getRateLimitInfo();

  // Check Canvas API rate limits using X-Rate-Limit-Remaining and X-Request-Cost headers
  // Rate limit info is returned for monitoring purposes
  return rateLimitInfo;
}

export { checkCanvasRateLimit };

