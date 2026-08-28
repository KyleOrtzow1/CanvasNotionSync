import { CredentialManager } from '../credentials/credential-manager.js';
import { NotionAPI } from '../api/notion-api.js';
import { AssignmentSyncer } from '../sync/assignment-syncer.js';
import { AssignmentCacheManager } from '../cache/assignment-cache-manager.js';
import '../utils/debug.js';
const { Debug } = globalThis;
import '../utils/error-messages.js';
const { getUserFriendlyNotionError } = globalThis;
import '../utils/sync-logger.js';
const { SyncLogger } = globalThis;
import { checkStorageQuota, cleanupOldCache } from '../utils/storage-monitor.js';

// Cache manager singleton instance
let assignmentCacheInstance = null;

// Guards against an auto-sync tick overlapping a sync already in progress
// (manual or periodic). Module-scope only — intentionally not persisted, so
// it self-corrects if the service worker is torn down mid-sync.
let syncInProgress = false;

/**
 * Get singleton assignment cache instance
 * @returns {AssignmentCacheManager}
 */
export function getAssignmentCache() {
  if (!assignmentCacheInstance) {
    assignmentCacheInstance = new AssignmentCacheManager();
  }
  return assignmentCacheInstance;
}

export async function handleBackgroundSync(canvasToken, options = {}) {
  if (syncInProgress) {
    throw new Error('Sync already in progress');
  }
  syncInProgress = true;

  try {
    const forceRefresh = options.forceRefresh || false;

    // Clear cache on force refresh
    if (forceRefresh) {
      const assignmentCache = getAssignmentCache();
      await assignmentCache.clearAll();
      Debug.log('Cache cleared due to force refresh');
    }

    const credentials = await CredentialManager.getCredentials();

    if (!credentials.notionToken || !credentials.notionDatabaseId) {
      throw new Error('Notion credentials not configured');
    }

    // Find active Canvas tabs
    const tabs = await chrome.tabs.query({
      url: "*://*.instructure.com/*"
    });

    if (tabs.length === 0) {
      throw new Error('No Canvas tabs found. Please open a Canvas page and try again.');
    }

    const activeTab = tabs[0];
    
    // Try to send Canvas token to content script
    let contentScriptReady = false;
    try {
      await chrome.tabs.sendMessage(activeTab.id, {
        type: 'SET_CANVAS_TOKEN',
        token: canvasToken
      });
      contentScriptReady = true;
    } catch (error) {
      // Content script not loaded, need to inject it
      contentScriptReady = false;
    }

    // If content script not ready, inject it
    if (!contentScriptReady) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['src/utils/debug.js', 'src/utils/error-messages.js', 'src/validators/canvas-validator.js', 'src/api/canvas-rate-limiter.js', 'content-script.js']
        });
        
        // Wait for script to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send Canvas token after injection
        await chrome.tabs.sendMessage(activeTab.id, {
          type: 'SET_CANVAS_TOKEN',
          token: canvasToken
        });
      } catch (injectionError) {
        throw new Error('Failed to load Canvas integration. Please refresh the Canvas page and try again.');
      }
    }

    // Wait a moment for content script to be ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Write initial progress state
    await chrome.storage.local.set({
      sync_progress: { active: true, phase: 'extracting', current: 0, total: 0, errorCount: 0, errors: [], startedAt: Date.now() }
    });

    // Extract assignments from Canvas
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'EXTRACT_ASSIGNMENTS',
      forceRefresh: forceRefresh
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to extract assignments from Canvas');
    }

    if (response.assignments.length === 0) {
      return { success: true, results: [], assignmentCount: 0, message: 'No assignments found to sync' };
    }

    // Sync the extracted assignments with active course IDs for deletion detection
    const activeCourseIds = response.activeCourseIds || [];
    const results = await handleAssignmentSync(response.assignments, activeCourseIds);

    // Update last sync time
    await chrome.storage.local.set({ lastSync: Date.now() });

    await checkStorageAfterSync();

    return { success: true, results, assignmentCount: response.assignments.length };


  } catch (error) {
    Debug.error('Background sync failed:', error.message);
    throw error;
  } finally {
    syncInProgress = false;
  }
}

export async function handleAssignmentSync(assignments, activeCourseIds = []) {
  const syncStart = Date.now();
  try {
    const credentials = await CredentialManager.getCredentials();

    if (!credentials.notionToken || !credentials.notionDatabaseId) {
      throw new Error('Notion credentials not configured');
    }

    const notionAPI = new NotionAPI(credentials.notionToken);

    // Pass unified cache to syncer
    const assignmentCache = getAssignmentCache();
    const syncer = new AssignmentSyncer(notionAPI, credentials.notionDatabaseId, assignmentCache);

    // Throttled progress writer (max once per 500ms, final write always fires)
    let lastProgressWrite = 0;
    let pendingProgress = null;
    let progressTimer = null;
    const writeProgress = (state) => {
      const now = Date.now();
      const doWrite = () => {
        chrome.storage.local.set({ sync_progress: { active: true, ...state, startedAt: syncStart } });
        lastProgressWrite = Date.now();
        pendingProgress = null;
      };

      if (state.phase === 'complete' || state.phase === 'error') {
        if (progressTimer) clearTimeout(progressTimer);
        doWrite();
        return;
      }

      if (now - lastProgressWrite >= 500) {
        if (progressTimer) clearTimeout(progressTimer);
        doWrite();
      } else {
        pendingProgress = state;
        if (!progressTimer) {
          progressTimer = setTimeout(() => {
            progressTimer = null;
            if (pendingProgress) doWrite();
          }, 500 - (now - lastProgressWrite));
        }
      }
    };

    const onProgress = (state) => writeProgress(state);

    const results = await syncer.syncAssignments(assignments, activeCourseIds, { onProgress });

    // Update last sync time
    await chrome.storage.local.set({ lastSync: Date.now() });

    await checkStorageAfterSync();

    const durationSec = ((Date.now() - syncStart) / 1000).toFixed(1);
    SyncLogger.info(`Sync completed in ${durationSec}s`, { durationMs: Date.now() - syncStart });
    await SyncLogger.flush();

    // Write final progress state
    await chrome.storage.local.set({
      sync_progress: { active: false, phase: 'complete', current: assignments.length, total: assignments.length, errorCount: results.errors.length, errors: results.errors.slice(0, 20), startedAt: syncStart }
    });

    // Write error stats
    const prevStats = (await chrome.storage.local.get('sync_error_stats')).sync_error_stats || {};
    await chrome.storage.local.set({
      sync_error_stats: {
        lastSyncErrorCount: results.errors.length,
        cumulativeErrorCount: results.errors.length > 0 ? (prevStats.cumulativeErrorCount || 0) + results.errors.length : 0,
        lastSuccessfulSync: results.errors.length === 0 ? Date.now() : (prevStats.lastSuccessfulSync || null),
        lastSyncErrors: results.errors.slice(0, 20)
      }
    });

    // Show notification with detailed stats
    const message = `Created: ${results.created.length}, Updated: ${results.updated.length}, Skipped: ${results.skipped.length}`;

    showNotification('Sync Complete', message);

    return results;
  } catch (error) {
    Debug.error('Sync failed:', error.message);

    // Write error progress state
    await chrome.storage.local.set({
      sync_progress: { active: false, phase: 'error', current: 0, total: 0, errorCount: 1, errors: [{ error: error.message }], startedAt: syncStart }
    });

    const prevStats = (await chrome.storage.local.get('sync_error_stats')).sync_error_stats || {};
    await chrome.storage.local.set({
      sync_error_stats: {
        lastSyncErrorCount: 1,
        cumulativeErrorCount: (prevStats.cumulativeErrorCount || 0) + 1,
        lastSuccessfulSync: prevStats.lastSuccessfulSync || null,
        lastSyncErrors: [{ error: error.message }]
      }
    });

    const friendly = getUserFriendlyNotionError(error);
    showNotification(friendly.title, `${friendly.message} ${friendly.action}`);
    throw error;
  }
}

// Updated test function for new API structure
export async function testNotionConnection(token, databaseId) {
  try {
    
    const notionAPI = new NotionAPI(token);
    
    // First, try to get the database
    const database = await notionAPI.getDatabase(databaseId);
    
    if (!database.data_sources || database.data_sources.length === 0) {
      return { 
        success: false, 
        error: 'Database has no data sources. Please ensure this is a valid database with at least one data source.' 
      };
    }
    
    const dataSourceId = database.data_sources[0].id;
    
    // Test querying the data source
    const queryResult = await notionAPI.queryDataSource(dataSourceId, {});
    
    return { 
      success: true, 
      message: `Connection successful! Database: "${database.title?.[0]?.text?.content || 'Untitled'}" with ${database.data_sources.length} data source(s). Found ${queryResult.results?.length || 0} existing pages.`
    };


  } catch (error) {
    Debug.error('Connection test failed:', error.message);
    const friendly = getUserFriendlyNotionError(error);
    return { success: false, error: `${friendly.title}: ${friendly.message} ${friendly.action}` };
  }
}

export function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message
  });
}

// Periodic sync alarm
export function setupPeriodicSync() {
  chrome.alarms.create('periodicSync', {
    delayInMinutes: 30,
    periodInMinutes: 30
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'periodicSync') return;

    try {
      const credentials = await CredentialManager.getCredentials();
      if (!credentials.notionToken || !credentials.notionDatabaseId) {
        // Not configured yet — nothing to sync.
        return;
      }
      // canvasToken may be null/undefined; handleBackgroundSync's session-cookie
      // path (see #33) handles that fine.
      await handleBackgroundSync(credentials.canvasToken);
    } catch (error) {
      if (error.message === 'Sync already in progress') {
        // A manual sync (or an overlapping auto-sync tick) is already running.
        // Skip silently — missing one tick costs nothing, the next one will run.
        return;
      }
      if (error.message && error.message.startsWith('No Canvas tabs found')) {
        // Expected most of the time — the user simply isn't on Canvas right
        // now. Not worth a loud error entry every 30 minutes.
        return;
      }

      // A genuine failure (auth rejection, Notion error, etc.) — surface it
      // where a user would actually look, instead of swallowing it.
      SyncLogger.error(`Periodic auto-sync failed: ${error.message}`, { error: error.message });
      await SyncLogger.flush();
      Debug.error('Periodic auto-sync failed:', error.message);
    }
  });
}

// Security: Clear all data when extension is uninstalled
export function setupSecurityHandlers() {
  chrome.runtime.onSuspend.addListener(async () => {
    // This runs when the extension is being suspended/uninstalled
    try {
      await CredentialManager.clearAllData();
    } catch (error) {
      // Silent fail - extension is shutting down
    }
  });

  // Additional cleanup on startup (in case previous cleanup failed)

  chrome.runtime.onStartup.addListener(async () => {
    try {
      // Check if we have orphaned encryption keys without credentials
      const { encryptionKey, encryptedCredentials } = await chrome.storage.local.get(['encryptionKey', 'encryptedCredentials']);

      if (encryptionKey && !encryptedCredentials) {
        await chrome.storage.local.remove(['encryptionKey']);
      }
    } catch (error) {
      // Silent fail - cleanup will retry on next startup
    }
  });
}

/**
 * Check storage quota after sync and auto-cleanup if critical
 */
export async function checkStorageAfterSync() {
  try {
    const quotaInfo = await checkStorageQuota();

    if (quotaInfo.status === 'critical') {
      Debug.warn(`Storage critical: ${quotaInfo.formattedUsed} / ${quotaInfo.formattedQuota} (${quotaInfo.percentUsed.toFixed(1)}%)`);
      await cleanupOldCache(getAssignmentCache());
      const afterQuota = await checkStorageQuota();
      if (afterQuota.status === 'critical') {
        showNotification('Storage Warning', `Storage is nearly full (${afterQuota.percentUsed.toFixed(0)}%). Consider clearing old data.`);
      }
    } else if (quotaInfo.status === 'warning') {
      Debug.warn(`Storage warning: ${quotaInfo.formattedUsed} / ${quotaInfo.formattedQuota} (${quotaInfo.percentUsed.toFixed(1)}%)`);
    }
  } catch (error) {
    Debug.error('Storage quota check failed:', error.message);
  }
}