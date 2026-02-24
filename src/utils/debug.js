// Debug logging utility - gates verbose logs behind a user-togglable flag
// Loaded as a plain script (content scripts) and via side-effect import (service worker).
// Access via globalThis.Debug in both contexts.

const Debug = {
  _enabled: false,
  _initialized: false,

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const result = await chrome.storage.local.get('debugMode');
      this._enabled = result.debugMode === true;
    } catch (error) {
      // Storage unavailable, stay disabled
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.debugMode) {
          this._enabled = changes.debugMode.newValue === true;
        }
      });
    } catch (error) {
      // Listener registration failed, non-critical
    }
  },

  setEnabled(value) {
    this._enabled = value === true;
  },

  log(...args) {
    if (this._enabled) {
      console.log('[DEBUG]', ...args);
    }
  },

  warn(...args) {
    if (this._enabled) {
      console.warn('[DEBUG]', ...args);
    }
  },

  error(...args) {
    console.error(...args);
  }
};

// Make available as global for both content scripts and service worker
if (typeof globalThis !== 'undefined') {
  globalThis.Debug = Debug;
}
