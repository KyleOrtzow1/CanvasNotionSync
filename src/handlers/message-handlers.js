import { CredentialManager } from '../credentials/credential-manager.js';
import { handleAssignmentSync, handleBackgroundSync, testNotionConnection, prepareNotionDatabase, getAssignmentCache, recordVerifiedSetup } from './background-handlers.js';
import { checkStorageQuota, cleanupOldCache } from '../utils/storage-monitor.js';
import { analytics } from '../utils/analytics.js';

function isPopup(sender) {
  return Boolean(chrome.runtime.id) && sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
}

function isCanvasPage(sender) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && ['instructure.com', 'canvaslms.com']
      .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

// Message handling
export function setupMessageHandlers() {
  // A successful test/setup can precede the popup's final credential save.
  // This single local checkpoint is never sent to analytics or persisted.
  let verifiedSetup = null;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return false;
    switch(request.action) {
      case 'GET_ANALYTICS_PREFERENCE':
      case 'SET_ANALYTICS_PREFERENCE':
      case 'TRACK_ANALYTICS': {
        if (!isPopup(sender)) {
          sendResponse({ success: false });
          return false;
        }
        if (request.action === 'GET_ANALYTICS_PREFERENCE') {
          analytics.getEnabled().then(enabled => sendResponse({ success: true, enabled }))
            .catch(() => sendResponse({ success: false }));
          return true;
        }
        if (request.action === 'SET_ANALYTICS_PREFERENCE') {
          analytics.setEnabled(request.enabled, { recordOptOut: true }).then(result => {
            sendResponse(result);
            if (request.enabled) void analytics.track('analytics_enabled');
          }).catch(() => sendResponse({ success: false }));
          return true;
        }
        // Popup callers can report UI actions, never fabricated sync/setup outcomes.
        if (['popup_opened', 'settings_changed'].includes(request.eventName)) {
          void analytics.track(request.eventName, request.params);
        }
        sendResponse({ success: true });
        return false;
      }
      case 'STORE_CREDENTIALS':
        CredentialManager.storeCredentials(
          request.canvasToken, 
          request.notionToken, 
          request.notionDatabaseId
        ).then(result => {
          sendResponse(result);
          if (result.success && request.notionToken) void analytics.track('notion_token_saved');
          if (result.success && verifiedSetup && verifiedSetup.token === request.notionToken &&
              verifiedSetup.databaseId === request.notionDatabaseId) {
            void recordVerifiedSetup(request.notionToken, request.notionDatabaseId);
          }
        });
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

      case 'START_BACKGROUND_SYNC': {
        const fromCanvas = isCanvasPage(sender);
        if (!fromCanvas && !isPopup(sender)) {
          sendResponse({ success: false, error: 'Unrecognized sync request' });
          return false;
        }
        const source = fromCanvas ? 'canvas_page' : request.source === 'setup' ? 'setup' : 'popup';
        if (source !== 'setup') void analytics.track('manual_sync_clicked', { source });
        handleBackgroundSync(request.canvasToken, {
          forceRefresh: request.forceRefresh === true, source,
          ...(fromCanvas ? { tabId: sender.tab.id, useStoredCanvasToken: true } : {})
        })
          .then(response => sendResponse(response))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }

      case 'TEST_NOTION_CONNECTION':
        testNotionConnection(request.token, request.databaseId)
          .then(result => {
            if (result.success) verifiedSetup = { token: request.token, databaseId: request.databaseId };
            sendResponse(result);
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'PREPARE_NOTION_DATABASE':
        prepareNotionDatabase(request.token, request.databaseId)
          .then(result => {
            if (result.success) verifiedSetup = { token: request.token, databaseId: request.databaseId };
            sendResponse(result);
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'CLEAR_ALL_DATA':
        verifiedSetup = null;
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

      case 'SET_DEBUG_MODE':
        globalThis.Debug.setEnabled(request.enabled);
        sendResponse({ success: true });
        return false;

      case 'GET_STORAGE_QUOTA':
        (async () => {
          const quota = await checkStorageQuota();
          sendResponse({ success: true, quota });
        })();
        return true;

      case 'CLEANUP_STORAGE':
        (async () => {
          const assignmentCache = getAssignmentCache();
          const result = await cleanupOldCache(assignmentCache, { force: true });
          sendResponse({ success: true, result });
        })();
        return true;

      case 'GET_SYNC_LOGS':
        (async () => {
          const limit = request.limit || 20;
          const logs = globalThis.SyncLogger ? globalThis.SyncLogger.getLogs(limit) : [];
          sendResponse({ success: true, logs });
        })();
        return true;

      case 'CLEAR_SYNC_LOGS':
        (async () => {
          if (globalThis.SyncLogger) {
            await globalThis.SyncLogger.clear();
          }
          sendResponse({ success: true });
        })();
        return true;
    }
  });
}
