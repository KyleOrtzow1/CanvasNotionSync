import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Set up chrome mock before importing Debug
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => undefined)
    },
    onChanged: {
      addListener: jest.fn()
    }
  }
};

import '../src/utils/debug.js';
const { Debug } = globalThis;

describe('Debug utility', () => {
  beforeEach(() => {
    // Reset internal state
    Debug._enabled = false;
    Debug._initialized = false;

    // Reset mocks
    jest.clearAllMocks();
    chrome.storage.local.get.mockResolvedValue({});

    // Spy on console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('log()', () => {
    test('suppressed when disabled', () => {
      Debug._enabled = false;
      Debug.log('test message');
      expect(console.log).not.toHaveBeenCalled();
    });

    test('outputs when enabled', () => {
      Debug._enabled = true;
      Debug.log('test message');
      expect(console.log).toHaveBeenCalledWith('[DEBUG]', 'test message');
    });

    test('passes multiple arguments', () => {
      Debug._enabled = true;
      Debug.log('msg', { key: 'val' }, 42);
      expect(console.log).toHaveBeenCalledWith('[DEBUG]', 'msg', { key: 'val' }, 42);
    });
  });

  describe('warn()', () => {
    test('suppressed when disabled', () => {
      Debug._enabled = false;
      Debug.warn('test warning');
      expect(console.warn).not.toHaveBeenCalled();
    });

    test('outputs when enabled', () => {
      Debug._enabled = true;
      Debug.warn('test warning');
      expect(console.warn).toHaveBeenCalledWith('[DEBUG]', 'test warning');
    });
  });

  describe('error()', () => {
    test('always outputs regardless of flag', () => {
      Debug._enabled = false;
      Debug.error('test error');
      expect(console.error).toHaveBeenCalledWith('test error');
    });

    test('outputs when enabled too', () => {
      Debug._enabled = true;
      Debug.error('test error');
      expect(console.error).toHaveBeenCalledWith('test error');
    });

    test('does not add [DEBUG] prefix', () => {
      Debug._enabled = true;
      Debug.error('some error', 'detail');
      expect(console.error).toHaveBeenCalledWith('some error', 'detail');
    });
  });

  describe('init()', () => {
    test('reads debugMode from storage', async () => {
      chrome.storage.local.get.mockResolvedValue({ debugMode: true });

      await Debug.init();

      expect(chrome.storage.local.get).toHaveBeenCalledWith('debugMode');
      expect(Debug._enabled).toBe(true);
    });

    test('defaults to false if not set in storage', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      await Debug.init();

      expect(Debug._enabled).toBe(false);
    });

    test('is idempotent — second call is a no-op', async () => {
      chrome.storage.local.get.mockResolvedValue({ debugMode: true });

      await Debug.init();
      expect(Debug._enabled).toBe(true);

      // Change storage value
      chrome.storage.local.get.mockResolvedValue({ debugMode: false });
      await Debug.init();

      // Still true because init was skipped
      expect(Debug._enabled).toBe(true);
      // get was only called once
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });

    test('handles storage errors gracefully', async () => {
      chrome.storage.local.get.mockRejectedValue(new Error('storage unavailable'));

      await Debug.init();

      expect(Debug._enabled).toBe(false);
    });

    test('registers storage change listener', async () => {
      await Debug.init();
      expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
    });
  });

  describe('setEnabled()', () => {
    test('updates flag synchronously', () => {
      Debug.setEnabled(true);
      expect(Debug._enabled).toBe(true);

      Debug.setEnabled(false);
      expect(Debug._enabled).toBe(false);
    });

    test('coerces non-boolean values', () => {
      Debug.setEnabled('yes');
      expect(Debug._enabled).toBe(false);

      Debug.setEnabled(true);
      expect(Debug._enabled).toBe(true);
    });
  });

  describe('storage change listener', () => {
    test('updates flag when storage changes', async () => {
      await Debug.init();

      // Get the registered listener
      const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];

      // Simulate storage change
      listener({ debugMode: { newValue: true } }, 'local');
      expect(Debug._enabled).toBe(true);

      listener({ debugMode: { newValue: false } }, 'local');
      expect(Debug._enabled).toBe(false);
    });

    test('ignores changes from non-local areas', async () => {
      await Debug.init();

      const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];

      Debug._enabled = false;
      listener({ debugMode: { newValue: true } }, 'sync');
      expect(Debug._enabled).toBe(false);
    });

    test('ignores unrelated storage changes', async () => {
      await Debug.init();

      const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];

      Debug._enabled = false;
      listener({ someOtherKey: { newValue: 'value' } }, 'local');
      expect(Debug._enabled).toBe(false);
    });
  });

  describe('[DEBUG] prefix', () => {
    test('log prepends [DEBUG]', () => {
      Debug._enabled = true;
      Debug.log('hello');
      expect(console.log).toHaveBeenCalledWith('[DEBUG]', 'hello');
    });

    test('warn prepends [DEBUG]', () => {
      Debug._enabled = true;
      Debug.warn('hello');
      expect(console.warn).toHaveBeenCalledWith('[DEBUG]', 'hello');
    });
  });

  describe('globalThis export', () => {
    test('Debug is available on globalThis', () => {
      expect(globalThis.Debug).toBeDefined();
      expect(globalThis.Debug.log).toBeInstanceOf(Function);
      expect(globalThis.Debug.warn).toBeInstanceOf(Function);
      expect(globalThis.Debug.error).toBeInstanceOf(Function);
    });
  });
});
