import { jest } from '@jest/globals';

// Unit tests must not depend on generated local GA credentials. Analytics tests
// supply explicit configurations; package tests inspect real files separately.
jest.unstable_mockModule('../src/utils/analytics-config.js', () => ({
  ANALYTICS_CONFIG: Object.freeze({ measurementId: '', apiSecret: '', debug: false })
}));
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
