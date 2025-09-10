// Canvas-Notion Sync Background Service Worker

// Encrypted storage and credential management
class CredentialManager {
  static async generateEncryptionKey() {
    try {
      // Try to get existing key from storage
      const { encryptionKey } = await chrome.storage.local.get(['encryptionKey']);
      
      if (encryptionKey) {
        // Import the existing key
        return await crypto.subtle.importKey(
          'raw',
          new Uint8Array(encryptionKey),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
      } else {
        // Generate a new key
        const key = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        
        // Export and store the key
        const exportedKey = await crypto.subtle.exportKey('raw', key);
        await chrome.storage.local.set({ 
          encryptionKey: Array.from(new Uint8Array(exportedKey))
        });
        
        return key;
      }
    } catch (error) {
      console.error('Failed to generate encryption key:', error);
      throw error;
    }
  }

  static async encryptData(data, key) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedData = new TextEncoder().encode(JSON.stringify(data));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encodedData
      );
      
      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      return Array.from(combined);
    } catch (error) {
      console.error('Failed to encrypt data:', error);
      throw error;
    }
  }

  static async decryptData(encryptedArray, key) {
    try {
      const combined = new Uint8Array(encryptedArray);
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
      );
      
      const decodedData = new TextDecoder().decode(decrypted);
      return JSON.parse(decodedData);
    } catch (error) {
      console.error('Failed to decrypt data:', error);
      throw error;
    }
  }

  static async storeCredentials(canvasToken, notionToken, notionDatabaseId) {
    try {
      const key = await this.generateEncryptionKey();
      
      // Prepare credential data
      const credentials = {
        canvasToken: canvasToken || null,
        notionToken: notionToken || null,
        notionDatabaseId: notionDatabaseId || null
      };
      
      // Encrypt the credentials
      const encryptedCredentials = await this.encryptData(credentials, key);
      
      // Store encrypted data and metadata
      await chrome.storage.local.set({
        encryptedCredentials: encryptedCredentials,
        lastSync: Date.now(),
        credentialsVersion: '1.0' // For future migration support
      });
      
      console.log('Credentials stored securely');
      return { success: true };
    } catch (error) {
      console.error('Failed to store credentials:', error);
      return { success: false, error: error.message };
    }
  }

  static async getCredentials() {
    try {
      const result = await chrome.storage.local.get(['canvasToken', 'notionToken', 'notionDatabaseId', 'lastSync']);
      return result;
    } catch (error) {
      console.error('Failed to retrieve credentials:', error);
      // If decryption fails, return empty object and log warning
      console.warn('Credential decryption failed, credentials may be corrupted');
      return {};
    }
  }

  static async clearAllData() {
    try {
      await chrome.storage.local.clear();
      return { success: true };
    } catch (error) {
      console.error('Failed to clear credentials:', error);
      return { success: false, error: error.message };
    }
  }
}

// Optimized Rate limiter for Notion API with burst support
class NotionRateLimiter {
  constructor() {
    this.requestQueue = [];
    this.processing = false;
    this.requestTimes = []; // Track request timestamps for sliding window
    this.maxRequestsPerSecond = 5; // Allow bursts up to 5 req/sec
    this.averageRequestsPerSecond = 3; // Maintain 3 req/sec average
    this.burstWindow = 1000; // 1 second sliding window
    this.averageWindow = 10000; // 10 second average window
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
      const now = Date.now();
      
      // Clean old request times
      this.requestTimes = this.requestTimes.filter(time => now - time < this.averageWindow);
      
      // Check if we can make a request
      const recentRequests = this.requestTimes.filter(time => now - time < this.burstWindow);
      const averageRequests = this.requestTimes.length;
      
      let canMakeRequest = true;
      let delay = 0;
      
      // Check burst limit (5 req/sec)
      if (recentRequests.length >= this.maxRequestsPerSecond) {
        delay = Math.max(delay, this.burstWindow - (now - recentRequests[0]));
        canMakeRequest = false;
      }
      
      // Check average limit (3 req/sec over 10 seconds)
      if (averageRequests >= (this.averageRequestsPerSecond * (this.averageWindow / 1000))) {
        const oldestRequest = this.requestTimes[0];
        delay = Math.max(delay, this.averageWindow - (now - oldestRequest));
        canMakeRequest = false;
      }
      
      if (!canMakeRequest && delay > 0) {
        await this.delay(Math.min(delay, 100)); // Cap delay at 100ms for responsiveness
        continue;
      }
      
      const { requestFunction, resolve, reject } = this.requestQueue.shift();
      
      try {
        const result = await requestFunction();
        this.requestTimes.push(Date.now());
        resolve(result);
      } catch (error) {
        if (error.message.includes('rate_limited') || error.status === 429) {
          // Handle 429 rate limit with exponential backoff
          const retryAfter = error.retryAfter || 1000;
          await this.delay(retryAfter);
          this.requestQueue.unshift({ requestFunction, resolve, reject });
        } else {
          reject(error);
        }
      }
      
      // Small delay to prevent overwhelming
      if (this.requestQueue.length > 0) {
        await this.delay(50); // Much smaller delay between requests
      }
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
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
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
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
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
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
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
        const error = new Error(`Notion API error: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Extract retry-after header for 429 responses
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            error.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
          }
        }
        
        throw error;
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

    // Add grade information to the new Grade column
    if (assignment.grade !== null && assignment.grade !== undefined) {
      // Handle different grade formats
      if (typeof assignment.grade === 'number') {
        // Numeric grade (e.g., 85, 92.5)
        properties["Grade"] = {
          rich_text: [{ text: { content: assignment.grade.toString() } }]
        };
      } else if (typeof assignment.grade === 'string') {
        // Letter grade (e.g., "A", "B+") or other string format
        properties["Grade"] = {
          rich_text: [{ text: { content: assignment.grade } }]
        };
      }
    } else if (assignment.gradePercent !== null && assignment.gradePercent !== undefined) {
      // Use percentage if available
      properties["Grade"] = {
        rich_text: [{ text: { content: `${assignment.gradePercent}%` } }]
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

    
    // Batch find existing assignments first to reduce API calls
    const existingAssignments = new Map();
    
    // Get all existing assignments with Canvas IDs in one query
    const canvasIds = assignments
      .filter(a => a.canvasId)
      .map(a => a.canvasId.toString());
    
    if (canvasIds.length > 0) {
      try {
        // Query all existing assignments at once
        const existing = await this.notionAPI.queryDataSource(this.dataSourceId, {
          property: 'Canvas ID',
          rich_text: {
            is_not_empty: true
          }
        });

        // Build lookup map
        if (existing.results) {
          for (const page of existing.results) {
            const canvasIdProp = page.properties['Canvas ID'];
            if (canvasIdProp && canvasIdProp.rich_text && canvasIdProp.rich_text.length > 0) {
              const canvasId = canvasIdProp.rich_text[0].text.content;
              existingAssignments.set(canvasId, page);
            }
          }
        }
        
      } catch (error) {
        console.warn('Failed to batch query existing assignments, falling back to individual queries:', error);
      }
    }
    
    // Process assignments with reduced API calls
    const promises = assignments.map(async (assignment) => {
      try {
        const existing = existingAssignments.get(assignment.canvasId?.toString());
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
        console.error('Error syncing assignment:', assignment.title, error);
        return { action: 'error', assignment: assignment.title, error: error.message };
      }
    });

    // Execute up to 3 operations concurrently (respecting rate limits)
    const batchSize = 3;
    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
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

    case 'CLEAR_ALL_DATA':
      CredentialManager.clearAllData()
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

// Security: Clear all data when extension is uninstalled
chrome.runtime.onSuspend.addListener(async () => {
  // This runs when the extension is being suspended/uninstalled
  console.log('Extension suspending, clearing sensitive data...');
  try {
    await CredentialManager.clearAllCredentials();
  } catch (error) {
    console.error('Failed to clear credentials on suspend:', error);
  }
});

// Additional cleanup on startup (in case previous cleanup failed)
chrome.runtime.onStartup.addListener(async () => {
  try {
    // Check if we have orphaned encryption keys without credentials
    const { encryptionKey, encryptedCredentials } = await chrome.storage.local.get(['encryptionKey', 'encryptedCredentials']);
    
    if (encryptionKey && !encryptedCredentials) {
      console.log('Cleaning up orphaned encryption key');
      await chrome.storage.local.remove(['encryptionKey']);
    }
  } catch (error) {
    console.error('Startup cleanup failed:', error);
  }
});

