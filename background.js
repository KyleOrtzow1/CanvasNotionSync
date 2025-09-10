// Canvas-Notion Sync Background Service Worker
console.log('Canvas-Notion Sync service worker starting...');

// Storage and credential management
class CredentialManager {
  static async storeCredentials(canvasToken, notionToken, notionDatabaseId) {
    try {
      await chrome.storage.local.set({
        canvasToken: canvasToken,
        notionToken: notionToken,
        notionDatabaseId: notionDatabaseId,
        lastSync: Date.now()
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to store credentials:', error);
      return { success: false, error: error.message };
    }
  }

  static async getCredentials() {
    try {
      const result = await chrome.storage.local.get(['canvasToken', 'notionToken', 'notionDatabaseId']);
      return result;
    } catch (error) {
      console.error('Failed to retrieve credentials:', error);
      return {};
    }
  }
}

// Rate limiter for Notion API (3 requests per second)
class NotionRateLimiter {
  constructor() {
    this.requestQueue = [];
    this.processing = false;
    this.minInterval = 334; // ~3 req/sec
  }

  async execute(requestFunction) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFunction, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;
    
    this.processing = true;
    
    while (this.requestQueue.length > 0) {
      const { requestFunction, resolve, reject } = this.requestQueue.shift();
      
      try {
        const result = await requestFunction();
        resolve(result);
      } catch (error) {
        if (error.message.includes('rate_limited')) {
          // Retry after delay
          await this.delay(1000);
          this.requestQueue.unshift({ requestFunction, resolve, reject });
        } else {
          reject(error);
        }
      }
      
      await this.delay(this.minInterval);
    }
    
    this.processing = false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const rateLimiter = new NotionRateLimiter();

// Notion API Integration - Updated for new API structure
class NotionAPI {
  constructor(token) {
    this.token = token;
    this.baseURL = 'https://api.notion.com/v1';
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2025-09-03'
    };
  }

  // Get database info and data sources
  async getDatabase(databaseId) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/databases/${databaseId}`, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    };

    return await rateLimiter.execute(requestFunction);
  }

  // Query data source (not database directly)
  async queryDataSource(dataSourceId, filters = {}) {
    const requestFunction = async () => {
      const body = {};
      if (Object.keys(filters).length > 0) {
        body.filter = filters;
      }

      const response = await fetch(`${this.baseURL}/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    };

    return await rateLimiter.execute(requestFunction);
  }

  // Create page in data source
  async createPage(dataSourceId, properties) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/pages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          properties: properties
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    };

    return await rateLimiter.execute(requestFunction);
  }

  async updatePage(pageId, properties) {
    const requestFunction = async () => {
      const response = await fetch(`${this.baseURL}/pages/${pageId}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ properties: properties })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    };

    return await rateLimiter.execute(requestFunction);
  }
}

// Assignment synchronization logic
class AssignmentSyncer {
  constructor(notionAPI, databaseId) {
    this.notionAPI = notionAPI;
    this.databaseId = databaseId;
    this.dataSourceId = null;
  }

  async initialize() {
    try {
      // Get database info to find the data source ID
      const database = await this.notionAPI.getDatabase(this.databaseId);
      
      if (!database.data_sources || database.data_sources.length === 0) {
        throw new Error('No data sources found in database');
      }
      
      // Use the first data source
      this.dataSourceId = database.data_sources[0].id;
      console.log('Using data source ID:', this.dataSourceId);
      
      return { success: true, dataSourceId: this.dataSourceId };
    } catch (error) {
      console.error('Failed to initialize syncer:', error);
      throw error;
    }
  }

  async findExistingAssignment(assignment) {
    try {
      if (!this.dataSourceId) {
        await this.initialize();
      }

      // Try to find by Canvas ID first
      if (assignment.canvasId) {
        const result = await this.notionAPI.queryDataSource(this.dataSourceId, {
          property: 'Canvas ID',
          rich_text: {
            equals: assignment.canvasId.toString()
          }
        });

        if (result.results && result.results.length > 0) {
          return result.results[0];
        }
      }

      // Fallback to title matching
      const titleResult = await this.notionAPI.queryDataSource(this.dataSourceId, {
        property: 'Assignment Name',
        title: {
          equals: assignment.title
        }
      });

      return titleResult.results && titleResult.results.length > 0 ? titleResult.results[0] : null;
    } catch (error) {
      console.error('Error finding existing assignment:', error);
      return null;
    }
  }

  formatAssignmentProperties(assignment) {
    const properties = {
      "Assignment Name": {
        title: [{ text: { content: assignment.title || 'Untitled Assignment' } }]
      }
    };

    if (assignment.course) {
      properties["Course"] = {
        rich_text: [{ text: { content: assignment.course } }]
      };
    }

    if (assignment.dueDate) {
      properties["Due Date"] = {
        date: { start: assignment.dueDate }
      };
    }

    if (assignment.status) {
      properties["Status"] = {
        rich_text: [{ text: { content: assignment.status } }]
      };
    }

    if (assignment.points) {
      properties["Points"] = {
        number: assignment.points
      };
    }

    if (assignment.link) {
      properties["Link to Resources"] = {
        url: assignment.link
      };
    }

    if (assignment.canvasId) {
      properties["Canvas ID"] = {
        rich_text: [{ text: { content: assignment.canvasId.toString() } }]
      };
    }

    return properties;
  }

  async syncAssignment(assignment) {
    try {
      if (!this.dataSourceId) {
        await this.initialize();
      }

      const existing = await this.findExistingAssignment(assignment);
      const properties = this.formatAssignmentProperties(assignment);

      if (existing) {
        // Update existing assignment
        const result = await this.notionAPI.updatePage(existing.id, properties);
        return { action: 'updated', assignment: assignment.title, result };
      } else {
        // Create new assignment
        const result = await this.notionAPI.createPage(this.dataSourceId, properties);
        return { action: 'created', assignment: assignment.title, result };
      }
    } catch (error) {
      console.error('Error syncing assignment:', error);
      return { action: 'error', assignment: assignment.title, error: error.message };
    }
  }

  async syncAssignments(assignments) {
    const results = [];
    
    // Initialize once before syncing
    if (!this.dataSourceId) {
      await this.initialize();
    }
    
    for (const assignment of assignments) {
      const result = await this.syncAssignment(assignment);
      results.push(result);
    }

    return results;
  }
}

// Message handling
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

    case 'TEST_NOTION_CONNECTION':
      testNotionConnection(request.token, request.databaseId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
  }
});

async function handleAssignmentSync(assignments) {
  try {
    const credentials = await CredentialManager.getCredentials();
    
    if (!credentials.notionToken || !credentials.notionDatabaseId) {
      throw new Error('Notion credentials not configured');
    }

    const notionAPI = new NotionAPI(credentials.notionToken);
    const syncer = new AssignmentSyncer(notionAPI, credentials.notionDatabaseId);
    
    const results = await syncer.syncAssignments(assignments);
    
    // Update last sync time
    await chrome.storage.local.set({ lastSync: Date.now() });
    
    // Show notification
    const successCount = results.filter(r => r.action !== 'error').length;
    showNotification(
      'Sync Complete', 
      `Synced ${successCount} assignments to Notion`
    );

    return results;
  } catch (error) {
    console.error('Sync failed:', error);
    showNotification('Sync Failed', error.message);
    throw error;
  }
}

// Updated test function for new API structure
async function testNotionConnection(token, databaseId) {
  try {
    console.log('Testing connection with token:', token.substring(0, 20) + '...');
    console.log('Database ID:', databaseId);
    
    const notionAPI = new NotionAPI(token);
    
    // First, try to get the database
    const database = await notionAPI.getDatabase(databaseId);
    console.log('Database retrieved successfully:', database.title?.[0]?.text?.content || 'No title');
    
    if (!database.data_sources || database.data_sources.length === 0) {
      return { 
        success: false, 
        error: 'Database has no data sources. Please ensure this is a valid database with at least one data source.' 
      };
    }
    
    const dataSourceId = database.data_sources[0].id;
    console.log('Found data source:', dataSourceId);
    
    // Test querying the data source
    const queryResult = await notionAPI.queryDataSource(dataSourceId, {});
    console.log('Data source query successful. Results:', queryResult.results?.length || 0);
    
    return { 
      success: true, 
      message: `Connection successful! Database: "${database.title?.[0]?.text?.content || 'Untitled'}" with ${database.data_sources.length} data source(s). Found ${queryResult.results?.length || 0} existing pages.`
    };
    
  } catch (error) {
    console.error('Connection test failed:', error);
    return { success: false, error: error.message };
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message
  });
}

// Navigation monitoring
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

// Periodic sync alarm
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

console.log('Canvas-Notion Sync service worker loaded successfully');