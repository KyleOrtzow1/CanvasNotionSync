// Canvas-Notion Sync Popup Script - Enhanced for Canvas API
document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  const canvasTokenInput = document.getElementById('canvasToken');
  const notionTokenInput = document.getElementById('notionToken');
  const notionDatabaseInput = document.getElementById('notionDatabase');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const testCanvasBtn = document.getElementById('testCanvasBtn');
  const manualSyncBtn = document.getElementById('manualSyncBtn');
  const statusMessage = document.getElementById('status-message');
  const lastSyncElement = document.getElementById('lastSync');
  const syncStatusElement = document.getElementById('syncStatus');
  const expandBtn = document.getElementById('expandBtn');
  const settingsSection = document.getElementById('settingsSection');
  const clearDataBtn = document.getElementById('clearDataBtn');

  // Load existing configuration
  loadConfiguration();
  
  // Event listeners
  saveBtn.addEventListener('click', handleSaveConfiguration);
  testBtn.addEventListener('click', handleTestConnection);
  if (testCanvasBtn) testCanvasBtn.addEventListener('click', handleTestCanvasAPI);
  manualSyncBtn.addEventListener('click', handleManualSync);
  expandBtn.addEventListener('click', toggleSettings);
  clearDataBtn.addEventListener('click', handleClearAllData);

  async function loadConfiguration() {
    try {
      const credentials = await chrome.runtime.sendMessage({
        action: 'GET_CREDENTIALS'
      });

      if (credentials.canvasToken) {
        canvasTokenInput.value = credentials.canvasToken;
      }
      
      if (credentials.notionToken) {
        notionTokenInput.value = credentials.notionToken;
      }
      
      if (credentials.notionDatabaseId) {
        notionDatabaseInput.value = credentials.notionDatabaseId;
      }

      // Update last sync time
      if (credentials.lastSync) {
        const lastSyncDate = new Date(credentials.lastSync);
        lastSyncElement.textContent = formatDate(lastSyncDate);
      }

      // Update sync status based on configuration completeness
      updateSyncStatus();
      
    } catch (error) {
      console.error('Failed to load configuration:', error);
      showStatus('Failed to load configuration', 'error');
    }
  }

  async function handleSaveConfiguration() {
    const canvasToken = canvasTokenInput.value.trim();
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = notionDatabaseInput.value.trim();

    // Validate required fields
    if (!notionToken) {
      showStatus('Notion token is required', 'error');
      notionTokenInput.focus();
      return;
    }

    if (!notionDatabaseId) {
      showStatus('Notion database ID is required', 'error');
      notionDatabaseInput.focus();
      return;
    }

    // Validate token format
    if (!notionToken.startsWith('secret_') && !notionToken.startsWith('ntn_')) {
      showStatus('Invalid Notion token format. Should start with "secret_" or "ntn_"', 'error');
      return;
    }

    // Validate database ID format (32 characters, alphanumeric)
    if (!/^[a-f0-9]{32}$/i.test(notionDatabaseId.replace(/-/g, ''))) {
      showStatus('Invalid database ID format. Should be 32 hexadecimal characters', 'error');
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="loading"></span>Saving...';

      const result = await chrome.runtime.sendMessage({
        action: 'STORE_CREDENTIALS',
        canvasToken: canvasToken || null,
        notionToken: notionToken,
        notionDatabaseId: notionDatabaseId.replace(/-/g, '')
      });

      if (result.success) {
        // Send Canvas token to content script
        if (canvasToken) {
          try {
            const tabs = await chrome.tabs.query({
              url: "*://*.instructure.com/*"
            });
            
            for (const tab of tabs) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'SET_CANVAS_TOKEN',
                token: canvasToken
              }).catch(() => {
                // Content script might not be loaded, ignore
              });
            }
          } catch (error) {
          }
        }
        
        showStatus('Configuration saved successfully!', 'success');
        updateSyncStatus();
      } else {
        showStatus('Failed to save configuration: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('Failed to save configuration: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Configuration';
    }
  }

  async function handleTestConnection() {
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = notionDatabaseInput.value.trim();

    if (!notionToken || !notionDatabaseId) {
      showStatus('Please enter Notion token and database ID first', 'error');
      return;
    }

    try {
      testBtn.disabled = true;
      testBtn.innerHTML = '<span class="loading"></span>Testing...';

      const result = await chrome.runtime.sendMessage({
        action: 'TEST_NOTION_CONNECTION',
        token: notionToken,
        databaseId: notionDatabaseId.replace(/-/g, '')
      });

      if (result.success) {
        showStatus('✅ Notion connection successful! ' + result.message, 'success');
      } else {
        showStatus('❌ Notion connection failed: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('❌ Connection test failed: ' + error.message, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Notion';
    }
  }

  async function handleTestCanvasAPI() {
    const canvasToken = canvasTokenInput.value.trim();

    if (!canvasToken) {
      showStatus('Canvas API token is required for the extension to work', 'error');
      return;
    }

    try {
      testCanvasBtn.disabled = true;
      testCanvasBtn.innerHTML = '<span class="loading"></span>Testing...';

      // Send token to content script and test
      const tabs = await chrome.tabs.query({
        url: "*://*.instructure.com/*",
        active: true
      });

      if (tabs.length === 0) {
        showStatus('Please open a Canvas page first', 'error');
        return;
      }

      const activeTab = tabs[0];
      
      // Send token to content script
      await chrome.tabs.sendMessage(activeTab.id, {
        type: 'SET_CANVAS_TOKEN',
        token: canvasToken
      });

      // Test extraction
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'EXTRACT_ASSIGNMENTS'
      });

      if (response.success) {
        const assignmentCount = response.assignments.length;
        showStatus(`✅ Canvas API working! Found ${assignmentCount} assignments`, 'success');
      } else {
        showStatus('❌ Canvas API test failed: ' + response.error, 'error');
      }

    } catch (error) {
      if (error.message.includes('Could not establish connection')) {
        showStatus('Canvas page not ready. Please refresh Canvas and try again.', 'error');
      } else {
        showStatus('❌ Canvas API test failed: ' + error.message, 'error');
      }
    } finally {
      testCanvasBtn.disabled = false;
      testCanvasBtn.textContent = 'Test Canvas API';
    }
  }

  async function handleManualSync() {
    try {
      manualSyncBtn.disabled = true;
      manualSyncBtn.innerHTML = '<span class="loading"></span>Syncing...';
      syncStatusElement.textContent = 'Syncing...';

      // Check for required Canvas API token
      const canvasToken = canvasTokenInput.value.trim();
      if (!canvasToken) {
        showStatus('Canvas API token is required. Please add your Canvas API token first.', 'error');
        return;
      }

      // Get active Canvas tabs (prefer active tab first)
      let tabs = await chrome.tabs.query({
        url: "*://*.instructure.com/*",
        active: true
      });

      // If no active Canvas tab, get any Canvas tab
      if (tabs.length === 0) {
        tabs = await chrome.tabs.query({
          url: "*://*.instructure.com/*"
        });
      }

      if (tabs.length === 0) {
        showStatus('No Canvas tabs found. Please open Canvas first.', 'error');
        return;
      }

      const activeTab = tabs[0];
      
      // Send Canvas token to content script
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          type: 'SET_CANVAS_TOKEN',
          token: canvasToken
        });
      } catch (error) {
      }

      // Wait a moment for content script to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      let response;
      try {
        // Send extraction request to the Canvas tab
        response = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'EXTRACT_ASSIGNMENTS'
        });
      } catch (error) {
        if (error.message.includes('Could not establish connection')) {
          // Content script not loaded, try to inject it
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content-script.js']
            });
            
            // Wait for script to initialize
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Set Canvas token again after injection
            if (canvasToken) {
              await chrome.tabs.sendMessage(activeTab.id, {
                type: 'SET_CANVAS_TOKEN',
                token: canvasToken
              });
            }
            
            // Try extraction again
            response = await chrome.tabs.sendMessage(activeTab.id, {
              type: 'EXTRACT_ASSIGNMENTS'
            });
          } catch (injectionError) {
            throw new Error('Canvas page not ready. Please refresh Canvas and try again.');
          }
        } else {
          throw error;
        }
      }

      if (response && response.success && response.assignments.length > 0) {
        // Sync the extracted assignments
        const syncResult = await chrome.runtime.sendMessage({
          action: 'SYNC_ASSIGNMENTS',
          assignments: response.assignments
        });

        if (syncResult.success) {
          const successCount = syncResult.results.filter(r => r.action !== 'error').length;
          const errorCount = syncResult.results.filter(r => r.action === 'error').length;
          
          let message = `✅ Synced ${successCount} assignments via Canvas API`;
          if (errorCount > 0) {
            message += `, ${errorCount} errors`;
          }
          
          showStatus(message, successCount > 0 ? 'success' : 'error');
          
          // Update last sync time
          lastSyncElement.textContent = formatDate(new Date());
        } else {
          showStatus('❌ Sync failed: ' + syncResult.error, 'error');
        }
      } else if (response && response.success && response.assignments.length === 0) {
        showStatus('No assignments found to sync', 'info');
      } else {
        showStatus('❌ Failed to extract assignments: ' + (response?.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      if (error.message.includes('Could not establish connection')) {
        showStatus('Canvas page not ready. Please refresh Canvas and try again.', 'error');
      } else {
        showStatus('❌ Sync failed: ' + error.message, 'error');
      }
    } finally {
      manualSyncBtn.disabled = false;
      manualSyncBtn.textContent = 'Sync Now';
      syncStatusElement.textContent = 'Ready';
    }
  }

  function updateSyncStatus() {
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = notionDatabaseInput.value.trim();

    if (notionToken && notionDatabaseId) {
      syncStatusElement.textContent = 'Ready';
      manualSyncBtn.disabled = false;
    } else {
      syncStatusElement.textContent = 'Configuration required';
      manualSyncBtn.disabled = true;
    }
  }

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
    statusMessage.classList.remove('hidden');

    // Auto-hide after 8 seconds for success messages
    if (type === 'success') {
      setTimeout(() => {
        statusMessage.classList.add('hidden');
      }, 8000);
    }
  }

  function formatDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  function toggleSettings() {
    const isHidden = settingsSection.classList.contains('hidden');
    
    if (isHidden) {
      settingsSection.classList.remove('hidden');
      expandBtn.textContent = '▲ Hide Settings';
    } else {
      settingsSection.classList.add('hidden');
      expandBtn.textContent = '⚙️ Settings';
    }
  }

  async function handleClearAllData() {
    if (!confirm('Are you sure you want to clear all stored data? This will remove all API tokens and configuration.')) {
      return;
    }

    try {
      clearDataBtn.disabled = true;
      clearDataBtn.innerHTML = '<span class="loading"></span>Clearing...';

      const result = await chrome.runtime.sendMessage({
        action: 'CLEAR_ALL_DATA'
      });

      if (result.success) {
        // Clear the form fields
        canvasTokenInput.value = '';
        notionTokenInput.value = '';
        notionDatabaseInput.value = '';
        lastSyncElement.textContent = 'Never';
        
        showStatus('✅ All data cleared successfully!', 'success');
        updateSyncStatus();
      } else {
        showStatus('❌ Failed to clear data: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('❌ Failed to clear data: ' + error.message, 'error');
    } finally {
      clearDataBtn.disabled = false;
      clearDataBtn.textContent = 'Clear All Data';
    }
  }

  // Update sync status when inputs change
  notionTokenInput.addEventListener('input', updateSyncStatus);
  notionDatabaseInput.addEventListener('input', updateSyncStatus);
});