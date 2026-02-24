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
  const debugModeCheckbox = document.getElementById('debugMode');
  const storageText = document.getElementById('storageText');
  const storageBar = document.getElementById('storageBar');
  const storageWarning = document.getElementById('storageWarning');
  const cleanupCacheBtn = document.getElementById('cleanupCacheBtn');
  const logsExpandBtn = document.getElementById('logsExpandBtn');
  const logsSection = document.getElementById('logsSection');
  const logContainer = document.getElementById('logContainer');
  const viewAllLogsBtn = document.getElementById('viewAllLogsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const errorsSection = document.getElementById('errorsSection');
  const errorContainer = document.getElementById('errorContainer');

  // Load existing configuration
  loadConfiguration();
  
  // Event listeners
  saveBtn.addEventListener('click', handleSaveConfiguration);
  testBtn.addEventListener('click', handleTestConnection);
  if (testCanvasBtn) testCanvasBtn.addEventListener('click', handleTestCanvasAPI);
  manualSyncBtn.addEventListener('click', handleManualSync);
  if (expandBtn) expandBtn.addEventListener('click', toggleSettings);
  if (clearDataBtn) clearDataBtn.addEventListener('click', handleClearAllData);
  if (debugModeCheckbox) debugModeCheckbox.addEventListener('change', handleDebugModeToggle);
  if (cleanupCacheBtn) cleanupCacheBtn.addEventListener('click', handleCleanupCache);
  if (logsExpandBtn) logsExpandBtn.addEventListener('click', toggleLogs);
  if (viewAllLogsBtn) viewAllLogsBtn.addEventListener('click', () => loadSyncLogs(100));
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearSyncLogs);
  syncStatusElement.addEventListener('click', () => {
    if (syncStatusElement.classList.contains('has-errors')) toggleErrors();
  });

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

      // Load debug mode setting
      const debugResult = await chrome.storage.local.get('debugMode');
      if (debugModeCheckbox) {
        debugModeCheckbox.checked = debugResult.debugMode === true;
      }

      await loadStorageQuota();

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
    syncStatusElement.classList.remove('has-errors');
  }

  async function handleManualSync() {
    try {
      manualSyncBtn.disabled = true;
      updateSyncProgress('starting', 0, 'Starting sync...');

      // Check for required Canvas API token
      const canvasToken = canvasTokenInput.value.trim();
      if (!canvasToken) {
        showStatus('Canvas API token is required. Please add your Canvas API token first.', 'error');
        resetSyncButton();
        return;
      }

      // Start background sync — progress updates come via storage listener
      const syncResult = await chrome.runtime.sendMessage({
        action: 'START_BACKGROUND_SYNC',
        canvasToken: canvasToken
      });

      if (syncResult.success) {
        const totalAssignments = syncResult.assignmentCount || 0;

        updateSyncProgress('complete', 100, `Synced ${totalAssignments} assignments!`);
        await new Promise(resolve => setTimeout(resolve, 1000));

        let message = `Synced ${totalAssignments} assignments via Canvas API`;
        const errorCount = syncResult.results?.errors?.length || 0;
        if (errorCount > 0) {
          message += `, ${errorCount} errors`;
        }

        showStatus(message, totalAssignments > 0 ? 'success' : 'error');
        lastSyncElement.textContent = formatDate(new Date());
        await loadStorageQuota();
        loadErrorStats();
      } else {
        showStatus('Sync failed: ' + syncResult.error, 'error');
      }
    } catch (error) {
      showStatus('Sync failed: ' + error.message, 'error');
    } finally {
      resetSyncButton();
    }
  }

  async function handleDebugModeToggle() {
    const enabled = debugModeCheckbox.checked;
    await chrome.storage.local.set({ debugMode: enabled });
    chrome.runtime.sendMessage({ action: 'SET_DEBUG_MODE', enabled: enabled }).catch(() => {});
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

  async function loadStorageQuota() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_STORAGE_QUOTA' });
      if (response && response.success) {
        const q = response.quota;
        storageText.textContent = `${q.formattedUsed} / ${q.formattedQuota} (${q.percentUsed.toFixed(1)}%)`;
        storageBar.style.width = `${Math.min(q.percentUsed, 100)}%`;

        if (q.status === 'critical') {
          storageBar.style.background = '#dc3545';
          storageWarning.textContent = 'Storage nearly full! Clear old cache to avoid data loss.';
          storageWarning.classList.remove('hidden');
        } else if (q.status === 'warning') {
          storageBar.style.background = '#ffc107';
          storageWarning.textContent = 'Storage usage is high.';
          storageWarning.classList.remove('hidden');
        } else {
          storageBar.style.background = '#2e7d32';
          storageWarning.classList.add('hidden');
        }
      }
    } catch (error) {
      // Non-critical, ignore
    }
  }

  async function handleCleanupCache() {
    try {
      setButtonLoading(cleanupCacheBtn, 'Cleaning...');

      const response = await chrome.runtime.sendMessage({ action: 'CLEANUP_STORAGE' });

      if (response && response.success) {
        const r = response.result;
        const freedKB = (r.freedBytes / 1024).toFixed(1);
        showStatus(`Cleaned ${r.entriesRemoved} entries, freed ${freedKB} KB`, 'success');
        await loadStorageQuota();
      } else {
        showStatus('Cleanup failed', 'error');
      }
    } catch (error) {
      showStatus('Cleanup failed: ' + error.message, 'error');
    } finally {
      cleanupCacheBtn.disabled = false;
      cleanupCacheBtn.textContent = 'Clear Old Cache';
    }
  }

  function toggleLogs() {
    const isHidden = logsSection.classList.contains('hidden');

    if (isHidden) {
      logsSection.classList.remove('hidden');
      logsExpandBtn.textContent = '▲ Hide Logs';
      loadSyncLogs(20);
    } else {
      logsSection.classList.add('hidden');
      logsExpandBtn.textContent = 'Sync Logs';
    }
  }

  async function loadSyncLogs(limit) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SYNC_LOGS', limit });
      if (response && response.success) {
        renderLogs(response.logs);
      }
    } catch (error) {
      // Non-critical
    }
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logContainer.innerHTML = '<div class="log-empty">No sync logs yet</div>';
      return;
    }

    const levelIcons = { info: '✅', warning: '⚠️', error: '❌' };

    logContainer.innerHTML = logs.map(entry => {
      const icon = levelIcons[entry.level] || '📋';
      const time = formatLogTime(entry.timestamp);
      const escapedMessage = escapeHtml(entry.message);
      return `<div class="log-entry level-${entry.level}">` +
        `<span class="log-time">${time}</span>` +
        `<span class="log-icon">${icon}</span>` +
        `<span class="log-message">${escapedMessage}</span>` +
        `</div>`;
    }).join('');
  }

  function formatLogTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function clearSyncLogs() {
    if (!confirm('Clear all sync logs?')) return;

    try {
      await chrome.runtime.sendMessage({ action: 'CLEAR_SYNC_LOGS' });
      renderLogs([]);
      showStatus('Sync logs cleared', 'success');
    } catch (error) {
      showStatus('Failed to clear logs', 'error');
    }
  }

  // Listen for real-time sync progress updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.sync_progress) {
      const p = changes.sync_progress.newValue;
      if (!p || !p.active) return;

      let percent = 0;
      let text = 'Syncing...';

      switch (p.phase) {
        case 'extracting':
          percent = 15;
          text = 'Extracting assignments...';
          break;
        case 'reconciling':
          percent = 25;
          text = 'Reconciling cache...';
          break;
        case 'syncing':
          percent = p.total > 0 ? 25 + Math.round((p.current / p.total) * 65) : 50;
          text = `Syncing ${p.current}/${p.total}...`;
          break;
        case 'cleanup':
          percent = 92;
          text = 'Cleaning up...';
          break;
        case 'complete':
          percent = 100;
          text = 'Complete!';
          break;
      }

      updateSyncProgress(p.phase, percent, text);

      if (p.currentTitle) {
        const truncated = p.currentTitle.length > 25
          ? p.currentTitle.slice(0, 25) + '...'
          : p.currentTitle;
        syncStatusElement.textContent = `Updating: ${truncated}`;
      }
    }
  });

  // Error stats functions
  async function loadErrorStats() {
    try {
      const data = await chrome.storage.local.get('sync_error_stats');
      const stats = data.sync_error_stats;
      if (stats && stats.lastSyncErrorCount > 0) {
        syncStatusElement.textContent = `${stats.lastSyncErrorCount} error${stats.lastSyncErrorCount !== 1 ? 's' : ''}`;
        syncStatusElement.classList.add('has-errors');
        renderErrors(stats.lastSyncErrors || []);
      } else {
        syncStatusElement.classList.remove('has-errors');
        errorsSection.classList.add('hidden');
      }
    } catch (error) {
      // Non-critical
    }
  }

  function renderErrors(errors) {
    if (!errors || errors.length === 0) {
      errorContainer.innerHTML = '<div class="log-empty">No errors</div>';
      return;
    }

    errorContainer.innerHTML = errors.map(err => {
      const title = escapeHtml(err.title || err.canvasId || 'Unknown');
      const message = escapeHtml(err.error || 'Unknown error');
      return `<div class="error-entry">` +
        `<span class="error-entry-title">${title}:</span>` +
        `<span class="error-entry-message">${message}</span>` +
        `</div>`;
    }).join('');
  }

  function toggleErrors() {
    const isHidden = errorsSection.classList.contains('hidden');
    if (isHidden) {
      errorsSection.classList.remove('hidden');
    } else {
      errorsSection.classList.add('hidden');
    }
  }

  // Load error stats on startup
  loadErrorStats();

  // Update sync status when inputs change
  notionTokenInput.addEventListener('input', updateSyncStatus);
  notionDatabaseInput.addEventListener('input', updateSyncStatus);
});