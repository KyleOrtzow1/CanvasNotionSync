// Canvas-Notion Sync Popup Script - Enhanced for Canvas API
/* global normalizeNotionDatabaseId, CANVAS_TAB_PATTERNS */
document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  const canvasTokenInput = document.getElementById('canvasToken');
  const notionTokenInput = document.getElementById('notionToken');
  const notionDatabaseInput = document.getElementById('notionDatabase');
  const prepareDatabaseBtn = document.getElementById('prepareDatabaseBtn');
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
  const setupToggle = document.getElementById('setupToggle');
  const setupBody = document.getElementById('setupBody');
  const setupBadge = document.getElementById('setupBadge');
  const setupStep1 = document.getElementById('setupStep1');
  const setupStep2 = document.getElementById('setupStep2');
  const setupStep3 = document.getElementById('setupStep3');
  const setupDone = document.getElementById('setupDone');
  const setupDatabaseId = document.getElementById('setupDatabaseId');
  const notionTokenHint = document.getElementById('notionTokenHint');
  const notionDatabaseHint = document.getElementById('notionDatabaseHint');
  const advancedToggle = document.getElementById('advancedToggle');
  const advancedBody = document.getElementById('advancedBody');
  const saveIndicator = document.getElementById('saveIndicator');

  // Autosave state. Declared before loadConfiguration() runs, since it writes to it.
  const AUTOSAVE_DELAY_MS = 400;
  let autosaveTimer = null;
  let saveIndicatorTimer = null;
  // What the service worker currently holds, so a half-typed URL can't clobber it.
  let savedDatabaseId = '';
  // The database step 3 last set up, so the step stays ticked across popup opens.
  let preparedDatabaseId = '';

  // Load existing configuration
  loadConfiguration();
  
  // Event listeners
  testBtn.addEventListener('click', handleTestConnection);
  if (prepareDatabaseBtn) prepareDatabaseBtn.addEventListener('click', handlePrepareDatabase);
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
        savedDatabaseId = credentials.notionDatabaseId;
      }

      const prepared = await chrome.storage.local.get('preparedDatabaseId');
      preparedDatabaseId = prepared.preparedDatabaseId || '';

      updateFieldHints();

      // Someone still mid-setup should land straight on the instructions, with
      // no clicks in between: both Settings and the setup steps open on their
      // own. Once sync is configured they stay closed and out of the way.
      if (!updateSetupProgress()) {
        setSettingsOpen(true);
        openAccordion(setupToggle, setupBody);
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

  // ---------------------------------------------------------------------
  // Autosave
  //
  // Every field in Settings persists as you type, so a setup interrupted by the
  // popup closing picks up exactly where it left off. Tokens and the database ID
  // go through the service worker, which stores them encrypted; the setup page
  // URL is a plain local draft that only this popup reads back.
  // ---------------------------------------------------------------------
  function queueAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(persistConfiguration, AUTOSAVE_DELAY_MS);
  }

  function flushAutosave() {
    if (autosaveTimer === null) return;
    clearTimeout(autosaveTimer);
    persistConfiguration();
  }

  async function persistConfiguration() {
    autosaveTimer = null;

    const canvasToken = canvasTokenInput.value.trim();
    const notionToken = notionTokenInput.value.trim();
    const databaseValue = notionDatabaseInput.value.trim();
    // Accepts a pasted Notion URL as well as a bare or dashed database ID.
    const parsedDatabaseId = normalizeNotionDatabaseId(databaseValue);

    // Mid-edit a URL doesn't parse yet; that shouldn't throw away the ID already
    // stored. Only an emptied field means "forget it".
    let notionDatabaseId;
    if (!databaseValue) {
      notionDatabaseId = null;
    } else if (parsedDatabaseId) {
      notionDatabaseId = parsedDatabaseId;
    } else {
      notionDatabaseId = savedDatabaseId || null;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'STORE_CREDENTIALS',
        canvasToken: canvasToken || null,
        notionToken: notionToken || null,
        notionDatabaseId: notionDatabaseId
      });

      if (!result || !result.success) {
        showStatus('Could not save your settings: ' + ((result && result.error) || 'unknown error'), 'error');
        return;
      }

      savedDatabaseId = notionDatabaseId || '';
      flashSaved();
    } catch (error) {
      showStatus('Could not save your settings: ' + error.message, 'error');
    }
  }

  function flashSaved() {
    if (!saveIndicator) return;
    saveIndicator.classList.remove('hidden');
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => saveIndicator.classList.add('hidden'), 1500);
  }

  // ---------------------------------------------------------------------
  // Guided setup
  // ---------------------------------------------------------------------

  function isNotionTokenShaped(token) {
    return token.startsWith('ntn_') || token.startsWith('secret_');
  }

  /**
   * Nudge on malformed input without blocking it — whatever is typed is still
   * saved, so a user can leave a field half-finished and come back to it.
   */
  function updateFieldHints() {
    const token = notionTokenInput.value.trim();
    const tokenOk = !token || isNotionTokenShaped(token);
    notionTokenHint.textContent = tokenOk
      ? 'Starts with "ntn_". Stored encrypted on this computer only.'
      : 'That doesn\'t look like a Notion access token — it should start with "ntn_".';
    notionTokenHint.classList.toggle('warn', !tokenOk);

    const database = notionDatabaseInput.value.trim();
    const databaseOk = !database || Boolean(normalizeNotionDatabaseId(database));
    notionDatabaseHint.textContent = databaseOk
      ? 'The database\'s 32-character ID works too.'
      : 'No database ID in that link yet — copy the database URL from your browser\'s address bar.';
    notionDatabaseHint.classList.toggle('warn', !databaseOk);
  }

  /**
   * Tick off the steps whose inputs are filled in, and summarize on the
   * dropdown header so the state is readable without expanding it.
   */
  function updateSetupProgress() {
    const databaseId = normalizeNotionDatabaseId(notionDatabaseInput.value);
    const step1 = isNotionTokenShaped(notionTokenInput.value.trim());
    const step2 = Boolean(databaseId);
    const step3 = Boolean(databaseId) && databaseId === preparedDatabaseId;

    setupStep1.classList.toggle('complete', step1);
    setupStep2.classList.toggle('complete', step2);
    setupStep3.classList.toggle('complete', step3);

    if (step3) {
      setupDatabaseId.textContent = databaseId;
      setupDone.classList.remove('hidden');
    } else {
      setupDone.classList.add('hidden');
    }

    const configured = step1 && step2 && step3;
    if (configured) {
      setupBadge.textContent = 'Set up ✓';
    } else {
      setupBadge.textContent = `Step ${!step1 ? 1 : (!step2 ? 2 : 3)} of 3`;
    }
    setupBadge.classList.toggle('complete', configured);

    return configured;
  }

  function toggleAccordion(toggle, body) {
    const willOpen = body.classList.contains('hidden');
    body.classList.toggle('hidden', !willOpen);
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  function openAccordion(toggle, body) {
    body.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }

  async function handleTestConnection() {
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = normalizeNotionDatabaseId(notionDatabaseInput.value);

    if (!notionToken || !notionDatabaseId) {
      showStatus('Enter your Notion access token and database ID first', 'error');
      return;
    }

    try {
      setButtonLoading(testBtn, 'Testing...');

      const result = await chrome.runtime.sendMessage({
        action: 'TEST_NOTION_CONNECTION',
        token: notionToken,
        databaseId: notionDatabaseId
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

  async function handlePrepareDatabase() {
    const notionToken = notionTokenInput.value.trim();
    const databaseId = normalizeNotionDatabaseId(notionDatabaseInput.value);

    if (!notionToken) {
      showStatus('Paste your Notion access token in step 1 first', 'error');
      notionTokenInput.focus();
      return;
    }

    if (!databaseId) {
      showStatus('Paste the URL of the Notion database you added Canvas Sync to (step 2)', 'error');
      notionDatabaseInput.focus();
      return;
    }

    try {
      setButtonLoading(prepareDatabaseBtn, 'Setting up...');

      const result = await chrome.runtime.sendMessage({
        action: 'PREPARE_NOTION_DATABASE',
        token: notionToken,
        databaseId: databaseId
      });

      if (!result.success) {
        showStatus('❌ ' + result.error, 'error');
        return;
      }

      // Persist right away rather than waiting out the autosave debounce, so
      // the sync below runs against saved credentials.
      const saveResult = await chrome.runtime.sendMessage({
        action: 'STORE_CREDENTIALS',
        canvasToken: canvasTokenInput.value.trim() || null,
        notionToken: notionToken,
        notionDatabaseId: databaseId
      });

      if (!saveResult.success) {
        showStatus('✅ Database set up, but saving the configuration failed: ' + saveResult.error + '. Re-type the last character of a field to try saving again.', 'error');
        return;
      }

      savedDatabaseId = databaseId;
      preparedDatabaseId = databaseId;
      await chrome.storage.local.set({ preparedDatabaseId: databaseId });
      updateSetupProgress();
      updateSyncStatus();

      // Sync reads assignments out of an open Canvas tab; without one it fails
      // immediately, so say what's missing rather than reporting a failure.
      const canvasTabs = await chrome.tabs.query({ url: CANVAS_TAB_PATTERNS });

      if (canvasTabs.length === 0) {
        showStatus(`✅ ${result.message} Open a Canvas tab, then press "Sync Now" to fill it in.`, 'info');
        return;
      }

      // The user already has the database open in Notion — no tab to open, so
      // the first sync runs right here with its progress on the Sync button.
      showStatus(`✅ ${result.message} Syncing your assignments now…`, 'success');
      prepareDatabaseBtn.disabled = false;
      prepareDatabaseBtn.textContent = 'Set Up Database';
      await handleManualSync();
    } catch (error) {
      showStatus('❌ Could not set up that database: ' + error.message, 'error');
    } finally {
      prepareDatabaseBtn.disabled = false;
      prepareDatabaseBtn.textContent = 'Set Up Database';
    }
  }

  async function handleTestCanvasAPI() {
    const canvasToken = canvasTokenInput.value.trim();

    try {
      setButtonLoading(testCanvasBtn, 'Testing...');

      // Send token to content script and test
      const tabs = await chrome.tabs.query({
        url: CANVAS_TAB_PATTERNS,
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

      // Test connectivity with a single lightweight request, not a full extraction
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'TEST_CANVAS_CONNECTION'
      });

      if (response.success) {
        showStatus(`✅ Connected to Canvas as ${response.name}`, 'success');
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

      // Canvas token is optional: same-origin requests fall back to the Canvas session cookie.
      const canvasToken = canvasTokenInput.value.trim();

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
    const notionDatabaseId = normalizeNotionDatabaseId(notionDatabaseInput.value);

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

  function setSettingsOpen(open) {
    settingsSection.classList.toggle('hidden', !open);
    expandBtn.textContent = open ? '▲ Hide Settings' : '⚙️ Settings';
  }

  function toggleSettings() {
    setSettingsOpen(settingsSection.classList.contains('hidden'));
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
        savedDatabaseId = '';
        preparedDatabaseId = '';
        await chrome.storage.local.remove('preparedDatabaseId');
        lastSyncElement.textContent = 'Never';

        showStatus('✅ All data cleared successfully!', 'success');
        updateFieldHints();
        updateSetupProgress();
        updateSyncStatus();
        openAccordion(setupToggle, setupBody);
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
          if (p.total > 0) {
            percent = 15 + Math.round((Math.min(p.current, p.total) / p.total) * 10);
            text = `Extracting courses ${p.current}/${p.total}...`;
          } else {
            percent = 15;
            text = 'Extracting assignments...';
          }
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

  // Settings inputs: reflect the change in the UI, then save it. Every field in
  // Settings is autosaved, so a half-finished setup survives the popup closing.
  [canvasTokenInput, notionTokenInput, notionDatabaseInput].forEach((field) => {
    field.addEventListener('input', () => {
      updateFieldHints();
      updateSetupProgress();
      updateSyncStatus();
      queueAutosave();
    });
    // Leaving a field shouldn't wait out the debounce.
    field.addEventListener('change', flushAutosave);
    field.addEventListener('blur', flushAutosave);
  });

  // The popup is torn down the moment it loses focus — save what's pending first.
  window.addEventListener('pagehide', flushAutosave);

  setupToggle.addEventListener('click', () => toggleAccordion(setupToggle, setupBody));
  advancedToggle.addEventListener('click', () => toggleAccordion(advancedToggle, advancedBody));
});
