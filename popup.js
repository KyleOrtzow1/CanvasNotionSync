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

  // Load existing configuration
  loadConfiguration();
  
  // Event listeners
  saveBtn.addEventListener('click', handleSaveConfiguration);
  testBtn.addEventListener('click', handleTestConnection);
  if (testCanvasBtn) testCanvasBtn.addEventListener('click', handleTestCanvasAPI);
  manualSyncBtn.addEventListener('click', handleManualSync);

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
            console.warn('Failed to send Canvas token to content scripts:', error);
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
      showStatus('Please enter Canvas API token first', 'error');
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

      // Send token to content script
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SET_CANVAS_TOKEN',
        token: canvasToken
      });

      // Test extraction
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'EXTRACT_ASSIGNMENTS'
      });

      if (response.success) {
        const apiAssignments = response.assignments.filter(a => a.source?.includes('api'));
        if (apiAssignments.length > 0) {
          showStatus(`✅ Canvas API working! Found ${apiAssignments.length} assignments via API`, 'success');
        } else {
          showStatus(`⚠️ Canvas token set, but no API assignments found. Found ${response.assignments.length} assignments via other methods.`, 'warning');
        }
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

      // Get active Canvas tabs
      const tabs = await chrome.tabs.query({
        url: "*://*.instructure.com/*"
      });

      if (tabs.length === 0) {
        showStatus('No Canvas tabs found. Please open Canvas first.', 'error');
        return;
      }

      // Send Canvas token if available
      const canvasToken = canvasTokenInput.value.trim();
      if (canvasToken) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_CANVAS_TOKEN',
          token: canvasToken
        }).catch(() => {
          // Content script might not be loaded, ignore
        });
      }

      // Send extraction request to the active Canvas tab
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'EXTRACT_ASSIGNMENTS'
      });

      if (response && response.success && response.assignments.length > 0) {
        // Sync the extracted assignments
        const syncResult = await chrome.runtime.sendMessage({
          action: 'SYNC_ASSIGNMENTS',
          assignments: response.assignments
        });

        if (syncResult.success) {
          const successCount = syncResult.results.filter(r => r.action !== 'error').length;
          const errorCount = syncResult.results.filter(r => r.action === 'error').length;
          
          let message = `✅ Synced ${successCount} assignments`;
          if (errorCount > 0) {
            message += `, ${errorCount} errors`;
          }

          // Show extraction method info
          const apiCount = response.assignments.filter(a => a.source?.includes('api')).length;
          if (apiCount > 0) {
            message += ` (${apiCount} via Canvas API)`;
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

  // Update sync status when inputs change
  notionTokenInput.addEventListener('input', updateSyncStatus);
  notionDatabaseInput.addEventListener('input', updateSyncStatus);
});