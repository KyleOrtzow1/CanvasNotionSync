// Persistent sync log — stores recent sync events in chrome.storage.local
// Access via globalThis.SyncLogger (singleton pattern matching Debug utility)

const SyncLogger = {
  _logs: [],
  _buffer: [],
  _initialized: false,
  _maxEntries: 100,
  _storageKey: 'sync_logs',

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      const result = await chrome.storage.local.get(this._storageKey);
      this._logs = Array.isArray(result[this._storageKey]) ? result[this._storageKey] : [];
    } catch (error) {
      this._logs = [];
    }
  },

  _createEntry(level, message, details = null) {
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      details
    };
  },

  log(level, message, details) {
    const entry = this._createEntry(level, message, details || null);
    this._buffer.push(entry);
  },

  info(message, details) {
    this.log('info', message, details);
  },

  warn(message, details) {
    this.log('warning', message, details);
  },

  error(message, details) {
    this.log('error', message, details);
  },

  async flush() {
    if (this._buffer.length === 0) return;

    this._logs.push(...this._buffer);
    this._buffer = [];

    // Trim to max entries (FIFO — keep newest)
    if (this._logs.length > this._maxEntries) {
      this._logs = this._logs.slice(this._logs.length - this._maxEntries);
    }

    try {
      await chrome.storage.local.set({ [this._storageKey]: this._logs });
    } catch (error) {
      // Storage write failed, logs remain in memory
    }
  },

  getLogs(limit = 20) {
    // Return most recent entries first
    const all = [...this._logs, ...this._buffer];
    return all.slice(-limit).reverse();
  },

  async clear() {
    this._logs = [];
    this._buffer = [];
    try {
      await chrome.storage.local.remove(this._storageKey);
    } catch (error) {
      // Silent fail
    }
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.SyncLogger = SyncLogger;
}
