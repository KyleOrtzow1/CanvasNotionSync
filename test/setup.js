// Provide a no-op Debug global for content script modules that use /* global Debug */
globalThis.Debug = {
  _enabled: false,
  _initialized: false,
  init: async () => {},
  setEnabled: () => {},
  log: () => {},
  warn: () => {},
  error: (...args) => console.error(...args)
};
