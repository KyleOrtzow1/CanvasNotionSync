import { CredentialManager } from '../credentials/credential-manager.js';
import { handleAssignmentSync, handleBackgroundSync, testNotionConnection, getCanvasCache, getNotionCache } from './background-handlers.js';

// Message handling
export function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch(request.action) {
      case 'STORE_CREDENTIALS':
        CredentialManager.storeCredentials(
          request.canvasToken, 
          request.notionToken, 
          request.notionDatabaseId
        ).then(result => sendResponse(result));
        return true;

      case 'GET_CREDENTIALS':
        CredentialManager.getCredentials()
          .then(credentials => sendResponse(credentials));
        return true;

      case 'SYNC_ASSIGNMENTS':
        handleAssignmentSync(request.assignments)
          .then(results => sendResponse({ success: true, results }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'START_BACKGROUND_SYNC':
        handleBackgroundSync(request.canvasToken, { forceRefresh: request.forceRefresh || false })
          .then(response => sendResponse(response))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'TEST_NOTION_CONNECTION':
        testNotionConnection(request.token, request.databaseId)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'CLEAR_ALL_DATA':
        CredentialManager.clearAllData()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'GET_CANVAS_CACHE':
        (async () => {
          const canvasCache = getCanvasCache();
          const data = await canvasCache.get(request.key);
          sendResponse({ success: true, data });
        })();
        return true;

      case 'SET_CANVAS_CACHE':
        (async () => {
          const canvasCache = getCanvasCache();
          await canvasCache.set(request.key, request.data, request.ttl);
          sendResponse({ success: true });
        })();
        return true;

      case 'UPDATE_RATE_LIMIT':
        (async () => {
          const canvasCache = getCanvasCache();
          await canvasCache.updateRateLimitInfo(request.info);
          sendResponse({ success: true });
        })();
        return true;

      case 'GET_CACHE_STATS':
        (async () => {
          const canvasCache = getCanvasCache();
          const notionCache = getNotionCache();
          sendResponse({
            success: true,
            stats: {
              canvas: canvasCache.getStats(),
              notion: notionCache.getStats()
            }
          });
        })();
        return true;

      case 'CLEAR_CACHE':
        (async () => {
          const canvasCache = getCanvasCache();
          const notionCache = getNotionCache();
          await canvasCache.clear();
          await notionCache.clear();
          sendResponse({ success: true });
        })();
        return true;
    }
  });
}