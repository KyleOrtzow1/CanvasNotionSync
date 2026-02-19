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
  clear: jest.fn(async () => { mockStorage._data = {}; })
};

const messageListeners = [];

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
    onAlarm: { addListener: jest.fn() }
  },
  scripting: {
    executeScript: jest.fn(async () => {})
  }
};

// Load error-messages.js so getUserFriendlyNotionError is available globally
await import('../src/utils/error-messages.js');

// ---------------------------------------------------------------------------
// Import handlers under test
// ---------------------------------------------------------------------------

const { showNotification, testNotionConnection } = await import('../src/handlers/background-handlers.js');
const { setupMessageHandlers } = await import('../src/handlers/message-handlers.js');

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
