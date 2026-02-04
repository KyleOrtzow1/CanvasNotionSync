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
  const clearDataBtn = document.getElementById('clearDataBtn');
  const statusMessage = document.getElementById('status-message');
  const lastSyncElement = document.getElementById('lastSync');
  const syncStatusElement = document.getElementById('syncStatus');
  const expandBtn = document.getElementById('expandBtn');
  const settingsSection = document.getElementById('settingsSection');

  // Load existing configuration
  loadConfiguration();
  
  // Event listeners
  saveBtn.addEventListener('click', handleSaveConfiguration);
  testBtn.addEventListener('click', handleTestConnection);
  if (testCanvasBtn) testCanvasBtn.addEventListener('click', handleTestCanvasAPI);
  manualSyncBtn.addEventListener('click', handleManualSync);
  if (expandBtn) expandBtn.addEventListener('click', toggleSettings);
  if (clearDataBtn) clearDataBtn.addEventListener('click', handleClearAllData);

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
      setButtonLoading(saveBtn, 'Saving...');

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
            // Failed to query Canvas tabs - extension may not be injected yet
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
      setButtonLoading(testBtn, 'Testing...');

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
      setButtonLoading(testCanvasBtn, 'Testing...');

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

  function updateSyncProgress(stage, progress, text) {
    const button = manualSyncBtn;
    const buttonText = button.querySelector('.btn-text');
    
    // Add progress class and update text
    button.classList.add('btn-progress');
    button.style.setProperty('--progress', `${progress}%`);
    buttonText.textContent = text;
    
    // Update sync status with simple text
    syncStatusElement.textContent = 'Syncing...';
  }

  function resetSyncButton() {
    const button = manualSyncBtn;
    const buttonText = button.querySelector('.btn-text');
    
    button.classList.remove('btn-progress');
    button.style.removeProperty('--progress');
    button.disabled = false;
    buttonText.textContent = 'Sync Now';
    syncStatusElement.textContent = 'Ready';
  }

  async function handleManualSync() {
    try {
      manualSyncBtn.disabled = true;
      updateSyncProgress('starting', 0, 'Starting sync...');

      // Check for required Canvas API token
      const canvasToken = canvasTokenInput.value.trim();
      if (!canvasToken) {
        showStatus('Canvas API token is required. Please add your Canvas API token first.', 'error');
        return;
      }

      updateSyncProgress('connecting', 20, 'Connecting to Canvas...');
      
      // Add some progress steps to make it feel more responsive
      await new Promise(resolve => setTimeout(resolve, 300));
      updateSyncProgress('extracting', 40, 'Extracting assignments...');
      
      await new Promise(resolve => setTimeout(resolve, 200));
      updateSyncProgress('syncing', 60, 'Syncing to Notion...');

      // Start background sync
      const syncResult = await chrome.runtime.sendMessage({
        action: 'START_BACKGROUND_SYNC',
        canvasToken: canvasToken
      });

      if (syncResult.success) {
        updateSyncProgress('finishing', 90, 'Finalizing sync...');
        
        // Use the total assignment count from background sync
        const totalAssignments = syncResult.assignmentCount || 0;

        // Ensure results is an array before filtering
        const results = Array.isArray(syncResult.results) ? syncResult.results : [];
        const errorCount = results.filter(r => r.action === 'error').length;

        updateSyncProgress('complete', 100, `Synced ${totalAssignments} assignments!`);
        
        // Brief pause to show completion
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        let message = `✅ Synced ${totalAssignments} assignments via Canvas API`;
        if (errorCount > 0) {
          message += `, ${errorCount} errors`;
        }
        
        showStatus(message, totalAssignments > 0 ? 'success' : 'error');
        
        // Update last sync time display
        lastSyncElement.textContent = formatDate(new Date());
      } else {
        showStatus('❌ Sync failed: ' + syncResult.error, 'error');
      }
    } catch (error) {
      showStatus('❌ Sync failed: ' + error.message, 'error');
    } finally {
      resetSyncButton();
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
      setButtonLoading(clearDataBtn, 'Clearing...');

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

  // Helper function to safely set button loading state
  function setButtonLoading(button, loadingText) {
    button.disabled = true;
    const loadingSpan = document.createElement('span');
    loadingSpan.className = 'loading';
    button.textContent = loadingText;
    button.insertBefore(loadingSpan, button.firstChild);
  }

  // Update sync status when inputs change
  notionTokenInput.addEventListener('input', updateSyncStatus);
  notionDatabaseInput.addEventListener('input', updateSyncStatus);
});