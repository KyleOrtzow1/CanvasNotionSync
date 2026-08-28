import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Chrome API mock — must be set up before any src/ imports
// ---------------------------------------------------------------------------

const mockStorage = {
  _data: {},
  get: jest.fn(async (keys) => {
    if (typeof keys === 'string') {
      return { [keys]: mockStorage._data[keys] };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map(k => [k, mockStorage._data[k]]));
    }
    return { ...mockStorage._data };
  }),
  set: jest.fn(async (obj) => { Object.assign(mockStorage._data, obj); }),
  remove: jest.fn(async (key) => {
    if (typeof key === 'string') delete mockStorage._data[key];
    if (Array.isArray(key)) key.forEach(k => delete mockStorage._data[k]);
  }),
  clear: jest.fn(async () => { mockStorage._data = {}; }),
  getBytesInUse: jest.fn(async () => 1048576),
  QUOTA_BYTES: 10485760
};

const messageListeners = [];
const alarmListeners = [];

globalThis.chrome = {
  storage: { local: mockStorage },
  runtime: {
    onMessage: {
      addListener: jest.fn((fn) => messageListeners.push(fn))
    },
    sendMessage: jest.fn()
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1, url: 'https://school.instructure.com' }]),
    sendMessage: jest.fn(async () => ({ success: true, assignments: [], activeCourseIds: [] }))
  },
  notifications: {
    create: jest.fn()
  },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn((fn) => alarmListeners.push(fn)) }
  },
  scripting: {
    executeScript: jest.fn(async () => {})
  }
};

// Load error-messages.js so getUserFriendlyNotionError is available globally
await import('../src/utils/error-messages.js');
// Load sync-logger.js so globalThis.SyncLogger is available
await import('../src/utils/sync-logger.js');
const { SyncLogger } = globalThis;

// ---------------------------------------------------------------------------
// Import handlers under test
// ---------------------------------------------------------------------------

const { showNotification, testNotionConnection, setupPeriodicSync } = await import('../src/handlers/background-handlers.js');
const { setupMessageHandlers } = await import('../src/handlers/message-handlers.js');
const { CredentialManager } = await import('../src/credentials/credential-manager.js');

// ---------------------------------------------------------------------------
// showNotification
// ---------------------------------------------------------------------------

describe('showNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls chrome.notifications.create with title and message', () => {
    showNotification('Test Title', 'Test message body');
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.title).toBe('Test Title');
    expect(opts.message).toBe('Test message body');
  });

  test('sets type to "basic"', () => {
    showNotification('Hello', 'World');
    const [opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.type).toBe('basic');
  });

  test('includes an iconUrl', () => {
    showNotification('Icon test', 'body');
    const [opts] = chrome.notifications.create.mock.calls[0];
    expect(opts.iconUrl).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// testNotionConnection
// ---------------------------------------------------------------------------

describe('testNotionConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeResponse(body, status = 200) {
    return {
      ok: status < 400,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body)
    };
  }

  test('returns success when database has data sources', async () => {
    globalThis.fetch = jest.fn()
      // First call: getDatabase
      .mockResolvedValueOnce(makeResponse({
        id: 'db1',
        title: [{ text: { content: 'My DB' } }],
        data_sources: [{ id: 'ds1', type: 'database' }]
      }))
      // Second call: queryDataSource
      .mockResolvedValueOnce(makeResponse({ results: [], has_more: false }));

    const result = await testNotionConnection('test-token', 'db1');
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Connection successful/i);
  });

  test('returns failure when database has no data sources', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(makeResponse({
      id: 'db1',
      data_sources: []
    }));

    const result = await testNotionConnection('test-token', 'db1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no data source/i);
  });

  test('returns failure on 401 unauthorized', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      makeResponse({ message: 'unauthorized' }, 401)
    );

    const result = await testNotionConnection('bad-token', 'db1');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Message handler routing
// ---------------------------------------------------------------------------

describe('setupMessageHandlers — message routing', () => {
  let capturedListener;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage._data = {};
    // Clear previously registered listeners
    messageListeners.length = 0;
    setupMessageHandlers();
    capturedListener = messageListeners[messageListeners.length - 1];
  });

  function sendMessage(request) {
    return new Promise((resolve) => {
      const returnedTrue = capturedListener(request, {}, resolve);
      // If the handler didn't call sendResponse synchronously and returned true
      // (indicating async), the promise will be resolved via sendResponse
      if (!returnedTrue) {
        // Synchronous handler — resolve with undefined if not already resolved
        resolve(undefined);
      }
    });
  }

  test('GET_CANVAS_CACHE returns legacy success response', async () => {
    const response = await sendMessage({ action: 'GET_CANVAS_CACHE' });
    expect(response.success).toBe(true);
  });

  test('SET_CANVAS_CACHE returns legacy success response', async () => {
    const response = await sendMessage({ action: 'SET_CANVAS_CACHE', data: {} });
    expect(response.success).toBe(true);
  });

  test('GET_CACHE_STATS returns stats object', async () => {
    const response = await sendMessage({ action: 'GET_CACHE_STATS' });
    expect(response.success).toBe(true);
    expect(response.stats).toBeDefined();
    expect(response.stats.assignment).toBeDefined();
  });

  test('CLEAR_CACHE returns success', async () => {
    const response = await sendMessage({ action: 'CLEAR_CACHE' });
    expect(response.success).toBe(true);
  });

  test('GET_STORAGE_QUOTA returns quota info', async () => {
    const response = await sendMessage({ action: 'GET_STORAGE_QUOTA' });
    expect(response.success).toBe(true);
    expect(response.quota).toBeDefined();
    expect(response.quota.bytesInUse).toBeDefined();
    expect(response.quota.status).toBeDefined();
  });

  test('CLEANUP_STORAGE returns cleanup result', async () => {
    const response = await sendMessage({ action: 'CLEANUP_STORAGE' });
    expect(response.success).toBe(true);
    expect(response.result).toBeDefined();
    expect(typeof response.result.entriesRemoved).toBe('number');
  });

  test('STORE_CREDENTIALS is handled (returns success or error shape)', async () => {
    const response = await sendMessage({
      action: 'STORE_CREDENTIALS',
      canvasToken: 'ct',
      notionToken: 'nt',
      notionDatabaseId: 'db1'
    });
    // Shape: { success: true } or { success: false, error: ... }
    expect(typeof response.success).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// setupPeriodicSync — periodic auto-sync alarm (issue #34)
// ---------------------------------------------------------------------------

describe('setupPeriodicSync — periodic auto-sync alarm', () => {
  let capturedAlarmListener;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStorage._data = {};
    alarmListeners.length = 0;
    SyncLogger._logs = [];
    SyncLogger._buffer = [];

    chrome.tabs.query.mockImplementation(async () => [{ id: 1, url: 'https://school.instructure.com' }]);
    chrome.tabs.sendMessage.mockImplementation(async () => ({ success: true, assignments: [], activeCourseIds: [] }));

    setupPeriodicSync();
    capturedAlarmListener = alarmListeners[alarmListeners.length - 1];
  });

  test('ignores alarms that are not periodicSync', async () => {
    await capturedAlarmListener({ name: 'someOtherAlarm' });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('with no credentials stored, the tick returns without attempting a sync', async () => {
    await capturedAlarmListener({ name: 'periodicSync' });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('firing the periodicSync alarm with credentials configured invokes the sync path', async () => {
    await CredentialManager.storeCredentials('canvas-token', 'notion-token', 'db-1');

    await capturedAlarmListener({ name: 'periodicSync' });

    expect(chrome.tabs.query).toHaveBeenCalled();
    const sentTypes = chrome.tabs.sendMessage.mock.calls.map(([, msg]) => msg.type);
    expect(sentTypes).toContain('SET_CANVAS_TOKEN');
    expect(sentTypes).toContain('EXTRACT_ASSIGNMENTS');
  });

  test('a second tick while a sync is already in flight is skipped and does not double-write sync_progress', async () => {
    await CredentialManager.storeCredentials('canvas-token', 'notion-token', 'db-1');

    let releaseExtract;
    const gate = new Promise((resolve) => { releaseExtract = resolve; });
    chrome.tabs.sendMessage.mockImplementation(async (tabId, msg) => {
      if (msg.type === 'EXTRACT_ASSIGNMENTS') {
        await gate;
        return { success: true, assignments: [], activeCourseIds: [] };
      }
      return {};
    });

    const firstTick = capturedAlarmListener({ name: 'periodicSync' });
    // Let the first tick run up to (and block on) the extraction call.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const writesBeforeSecondTick = mockStorage.set.mock.calls.length;
    await capturedAlarmListener({ name: 'periodicSync' });
    expect(mockStorage.set.mock.calls.length).toBe(writesBeforeSecondTick);

    releaseExtract();
    await firstTick;
  });

  test('a throwing sync is logged via SyncLogger rather than swallowed', async () => {
    await CredentialManager.storeCredentials('canvas-token', 'notion-token', 'db-1');
    // Every content-script handshake fails (tab exists, but nothing ever answers) —
    // a genuine failure, distinct from the expected "no Canvas tabs" skip case.
    chrome.tabs.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));

    await capturedAlarmListener({ name: 'periodicSync' });

    const logged = SyncLogger.getLogs(20);
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  }, 10000);
});
