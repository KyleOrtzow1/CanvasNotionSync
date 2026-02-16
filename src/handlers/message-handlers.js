import { CredentialManager } from '../credentials/credential-manager.js';
import { handleAssignmentSync, handleBackgroundSync, testNotionConnection, getAssignmentCache } from './background-handlers.js';

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
        // Legacy support - now redirects to assignment cache
        (async () => {
          sendResponse({ success: true, data: null });
        })();
        return true;

      case 'SET_CANVAS_CACHE':
        // Legacy support - no-op, cache is now managed internally
        (async () => {
          sendResponse({ success: true });
        })();
        return true;

      case 'GET_CACHE_STATS':
        (async () => {
          const assignmentCache = getAssignmentCache();
          const stats = await assignmentCache.getStats();
          sendResponse({
            success: true,
            stats: {
              assignment: stats
            }
          });
        })();
        return true;

      case 'CLEAR_CACHE':
        (async () => {
          const assignmentCache = getAssignmentCache();
          await assignmentCache.clearAll();
          sendResponse({ success: true });
        })();
        return true;
    }
  });
}