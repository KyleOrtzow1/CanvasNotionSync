import { CredentialManager } from '../credentials/credential-manager.js';
import { NotionAPI } from '../api/notion-api.js';
import { AssignmentSyncer } from '../sync/assignment-syncer.js';
import { AssignmentCacheManager } from '../cache/assignment-cache-manager.js';
import '../utils/error-messages.js';
const { getUserFriendlyNotionError } = globalThis;

// Cache manager singleton instance
let assignmentCacheInstance = null;

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
  try {
    const forceRefresh = options.forceRefresh || false;

    // Clear cache on force refresh
    if (forceRefresh) {
      const assignmentCache = getAssignmentCache();
      await assignmentCache.clearAll();
      console.log('🔄 Cache cleared due to force refresh');
    }

    const credentials = await CredentialManager.getCredentials();

    if (!credentials.notionToken || !credentials.notionDatabaseId) {
      throw new Error('Notion credentials not configured');
    }

    if (!canvasToken) {
      throw new Error('Canvas token not provided');
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
          files: ['src/utils/error-messages.js', 'src/validators/canvas-validator.js', 'src/api/canvas-rate-limiter.js', 'content-script.js']
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

    return { success: true, results, assignmentCount: response.assignments.length };


  } catch (error) {
    console.error('Background sync failed:', error.message);
    throw error;
  }
}

export async function handleAssignmentSync(assignments, activeCourseIds = []) {
  try {
    const credentials = await CredentialManager.getCredentials();

    if (!credentials.notionToken || !credentials.notionDatabaseId) {
      throw new Error('Notion credentials not configured');
    }

    const notionAPI = new NotionAPI(credentials.notionToken);

    // Pass unified cache to syncer
    const assignmentCache = getAssignmentCache();
    const syncer = new AssignmentSyncer(notionAPI, credentials.notionDatabaseId, assignmentCache);

    const results = await syncer.syncAssignments(assignments, activeCourseIds);

    // Update last sync time
    await chrome.storage.local.set({ lastSync: Date.now() });

    // Show notification with detailed stats
    const message = `Created: ${results.created.length}, Updated: ${results.updated.length}, Skipped: ${results.skipped.length}`;

    showNotification('Sync Complete', message);

    return results;
  } catch (error) {
    console.error('Sync failed:', error.message);
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
    console.error('Connection test failed:', error.message);
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

// Navigation monitoring
export function setupNavigationHandlers() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && 
        tab.url && 
        /https:\/\/.*\.instructure\.com/.test(tab.url)) {
      
      // Inject content script if needed and trigger extraction
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'CHECK_FOR_ASSIGNMENTS',
          url: tab.url
        }).catch(() => {
          // Content script might not be loaded yet, ignore
        });
      }, 2000);
    }
  });
}

// Periodic sync alarm
export function setupPeriodicSync() {
  chrome.alarms.create('periodicSync', {
    delayInMinutes: 30,
    periodInMinutes: 30
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'periodicSync') {
      // Check if we have active Canvas tabs
      chrome.tabs.query({url: "*://*.instructure.com/*"}, (tabs) => {
        if (tabs.length > 0) {
          // Trigger sync on active Canvas tab
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'AUTO_SYNC_REQUEST'
          }).catch(() => {
            // Content script not loaded, ignore
          });
        }
      });
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