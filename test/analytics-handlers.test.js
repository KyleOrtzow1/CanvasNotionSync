import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';

const syncAssignments = jest.fn();
const getDatabase = jest.fn();
const queryDataSource = jest.fn();
await jest.unstable_mockModule('../src/sync/assignment-syncer.js', () => ({
  AssignmentSyncer: jest.fn().mockImplementation(() => ({ syncAssignments }))
}));
await jest.unstable_mockModule('../src/api/notion-api.js', () => ({
  NotionAPI: jest.fn().mockImplementation(() => ({
    getDatabase, queryDataSource,
    getDataSource: async () => ({ properties: { Name: { type: 'title' } } }),
    updateDataSourceProperties: async () => ({}), listViews: async () => ({ results: [] })
  }))
}));

let data = {};
let sessionData = {};
const listeners = [];
const alarms = [];
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async keys => typeof keys === 'string' ? { [keys]: data[keys] } : { ...data }),
      set: jest.fn(async values => Object.assign(data, values)),
      remove: jest.fn(async keys => { for (const key of [keys].flat()) delete data[key]; }),
      getBytesInUse: async () => 0, QUOTA_BYTES: 10485760
    },
    session: {
      get: async () => ({ ...sessionData }), set: async values => Object.assign(sessionData, values),
      remove: async key => { delete sessionData[key]; }
    }
  },
  runtime: {
    id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`,
    getManifest: () => ({ version: '1.1.0' }),
    onMessage: { addListener: listener => listeners.push(listener) },
    onStartup: { addListener: jest.fn() }, onSuspend: { addListener: jest.fn() }
  },
  tabs: { query: jest.fn(), sendMessage: jest.fn() },
  scripting: { executeScript: jest.fn() },
  notifications: { create: jest.fn() },
  alarms: { create: jest.fn(), onAlarm: { addListener: listener => alarms.push(listener) } }
};
const { analytics, Analytics } = await import('../src/utils/analytics.js');
const { CredentialManager } = await import('../src/credentials/credential-manager.js');
const { setupMessageHandlers } = await import('../src/handlers/message-handlers.js');
const { handleBackgroundSync, handleAssignmentSync, setupPeriodicSync, setupSecurityHandlers,
  recordVerifiedSetup } = await import('../src/handlers/background-handlers.js');
const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
const canvas = { id: 'test-extension', url: 'https://school.instructure.com/courses/42', frameId: 0, tab: { id: 2 } };
const credentials = { notionToken: 'ntn_private', notionDatabaseId: 'private-db', canvasToken: 'private-canvas-token' };
let track;

function send(request, sender = popup) {
  return new Promise(resolve => {
    const result = listeners[0](request, sender, resolve);
    if (!result) resolve(undefined);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  data = {}; sessionData = {}; listeners.length = 0; alarms.length = 0;
  analytics.blocked = false;
  track = jest.spyOn(analytics, 'track').mockResolvedValue(false);
  jest.spyOn(CredentialManager, 'getCredentials').mockResolvedValue({ ...credentials });
  jest.spyOn(CredentialManager, 'storeCredentials').mockResolvedValue({ success: true });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  chrome.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  chrome.tabs.sendMessage.mockImplementation(async (id, request) => request.type === 'EXTRACT_ASSIGNMENTS'
    ? { success: true, assignments: [{ title: 'private assignment' }], activeCourseIds: ['private-course'] }
    : { success: true });
  syncAssignments.mockResolvedValue({ created: [{ id: 'private-page' }], updated: [], skipped: [], deleted: [], errors: [] });
  getDatabase.mockResolvedValue({ id: 'private-db', data_sources: [{ id: 'private-source' }] });
  queryDataSource.mockResolvedValue({ results: [] });
  setupMessageHandlers();
});
afterEach(() => jest.restoreAllMocks());

describe('sync event ownership', () => {
  test('popup emits one click/start/completion and safe full-operation counts', async () => {
    const response = await send({ action: 'START_BACKGROUND_SYNC', canvasToken: 'private-canvas-token' });
    expect(response.success).toBe(true);
    expect(track.mock.calls.filter(([event]) => event === 'sync_started')).toEqual([['sync_started', { source: 'popup' }]]);
    const completions = track.mock.calls.filter(([event]) => event === 'sync_completed');
    expect(completions).toHaveLength(1);
    expect(completions[0][1]).toMatchObject({ source: 'popup', created: 1, updated: 0, skipped: 0, deleted: 0, errors: 0 });
    expect(completions[0][1].duration_ms).toBeGreaterThanOrEqual(90);
    expect(track).toHaveBeenCalledWith('manual_sync_clicked', { source: 'popup' });
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/private|ntn_/);
  });

  test('Canvas page sync uses the initiating tab and stored token, including extraction', async () => {
    const response = await send({ action: 'START_BACKGROUND_SYNC', source: 'periodic' }, canvas);
    expect(response.success).toBe(true);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: 'SET_CANVAS_TOKEN', token: credentials.canvasToken });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: 'EXTRACT_ASSIGNMENTS', forceRefresh: false });
    expect(track).toHaveBeenCalledWith('manual_sync_clicked', { source: 'canvas_page' });
    expect(track).toHaveBeenCalledWith('sync_started', { source: 'canvas_page' });
  });

  test('setup sync is identified separately and never reports a manual click', async () => {
    await send({ action: 'START_BACKGROUND_SYNC', source: 'setup' });
    expect(track).toHaveBeenCalledWith('sync_started', { source: 'setup' });
    expect(track.mock.calls.some(([name]) => name === 'manual_sync_clicked')).toBe(false);
  });

  test('zero assignments produces a zero-count completion and clears active progress', async () => {
    chrome.tabs.sendMessage.mockResolvedValue({ success: true, assignments: [] });
    const response = await handleBackgroundSync(null);
    expect(response.assignmentCount).toBe(0);
    expect(data.sync_progress.active).toBe(false);
    expect(track).toHaveBeenCalledWith('sync_completed', expect.objectContaining({ created: 0, errors: 0 }));
    expect(track.mock.calls.some(([name]) => name === 'setup_completed')).toBe(false);
  });

  test('partial errors remain a completion with error counts, not a second failure event', async () => {
    syncAssignments.mockResolvedValue({ created: [], updated: [], skipped: [], deleted: [], errors: [{ error: 'private URL' }] });
    await handleBackgroundSync(null);
    expect(track).toHaveBeenCalledWith('sync_completed', expect.objectContaining({ errors: 1 }));
    expect(track.mock.calls.some(([name]) => ['sync_failed', 'setup_completed'].includes(name))).toBe(false);
  });

  test('Canvas extraction failure produces one categorized terminal event', async () => {
    chrome.tabs.sendMessage.mockImplementation(async (id, request) => request.type === 'EXTRACT_ASSIGNMENTS'
      ? { success: false, error: 'Canvas session expired at https://private.example?token=ntn_private' } : {});
    await expect(handleBackgroundSync(null)).rejects.toThrow('session expired');
    expect(track).toHaveBeenCalledWith('sync_failed', expect.objectContaining({ category: 'authentication', source: 'popup' }));
    expect(track.mock.calls.filter(([name]) => name === 'sync_failed')).toHaveLength(1);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/private|https:/);
  });

  test('Notion failure is reported once despite nested sync handlers', async () => {
    syncAssignments.mockRejectedValue(Object.assign(new Error('private DB'), { status: 429 }));
    await expect(handleBackgroundSync(null)).rejects.toThrow();
    expect(track.mock.calls.filter(([name]) => name === 'sync_failed')).toEqual([
      ['sync_failed', expect.objectContaining({ category: 'rate_limit' })]
    ]);
  });

  test('legacy assignment message still emits one start and completion', async () => {
    await send({ action: 'SYNC_ASSIGNMENTS', assignments: [{}] }, canvas);
    expect(track.mock.calls.filter(([name]) => name === 'sync_started')).toHaveLength(1);
    expect(track.mock.calls.filter(([name]) => name === 'sync_completed')).toHaveLength(1);
  });

  test('unavailable analytics never delays a successful sync response', async () => {
    track.mockImplementation(() => new Promise(() => {}));
    expect((await handleBackgroundSync(null)).success).toBe(true);
  });

  test('periodic preflight skips never inflate sync failure/start counts', async () => {
    setupPeriodicSync();
    CredentialManager.getCredentials.mockResolvedValueOnce({});
    await alarms[0]({ name: 'periodicSync' });
    expect(track).toHaveBeenCalledWith('auto_sync_skipped', { reason: 'configuration' });
    chrome.tabs.query.mockResolvedValue([]);
    await alarms[0]({ name: 'periodicSync' });
    expect(track).toHaveBeenCalledWith('auto_sync_skipped', { reason: 'no_canvas_tab' });
    expect(track.mock.calls.some(([name]) => name.startsWith('sync_'))).toBe(false);
  });

  test('overlapping periodic and legacy sync attempts do not create duplicate operations', async () => {
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { started = resolve; });
    syncAssignments.mockImplementationOnce(async () => {
      started(); await gate;
      return { created: [], updated: [], skipped: [], deleted: [], errors: [] };
    });
    const first = handleBackgroundSync(null);
    await reached;
    await expect(handleBackgroundSync(null, { source: 'periodic' })).rejects.toThrow('already in progress');
    await expect(handleAssignmentSync([])).rejects.toThrow('already in progress');
    release(); await first;
    expect(track).toHaveBeenCalledWith('auto_sync_skipped', { reason: 'in_progress' });
    expect(track.mock.calls.filter(([name]) => name === 'sync_started')).toHaveLength(1);
  });
});

describe('setup, UI boundary and clearing', () => {
  test('setup completion follows successful verification of the saved configuration', async () => {
    await send({ action: 'TEST_NOTION_CONNECTION', token: credentials.notionToken, databaseId: credentials.notionDatabaseId });
    expect(track).toHaveBeenCalledWith('notion_connection_tested', { outcome: 'success', category: 'unknown' });
    expect(track).toHaveBeenCalledWith('setup_completed');
    track.mockClear();
    await recordVerifiedSetup('different token', credentials.notionDatabaseId);
    expect(track).not.toHaveBeenCalled();
  });

  test('preparation then credential save records setup even when the initial configuration was empty', async () => {
    CredentialManager.getCredentials.mockResolvedValue({});
    await send({ action: 'PREPARE_NOTION_DATABASE', token: credentials.notionToken, databaseId: credentials.notionDatabaseId });
    expect(track).toHaveBeenCalledWith('database_prepared', { outcome: 'success', category: 'unknown' });
    expect(track).not.toHaveBeenCalledWith('setup_completed');
    CredentialManager.getCredentials.mockResolvedValue(credentials);
    await send({ action: 'STORE_CREDENTIALS', ...credentials });
    await Promise.resolve();
    expect(track).toHaveBeenCalledWith('setup_completed');
    expect(track).toHaveBeenCalledWith('notion_token_saved');
  });

  test('a failed connection test sends a category, and does not complete setup', async () => {
    getDatabase.mockRejectedValue(Object.assign(new Error('private DB URL'), { status: 401 }));
    await send({ action: 'TEST_NOTION_CONNECTION', token: 'private', databaseId: 'private' });
    expect(track).toHaveBeenCalledWith('notion_connection_tested', { outcome: 'failure', category: 'authentication' });
    expect(track).not.toHaveBeenCalledWith('setup_completed');
  });

  test.each([canvas, { ...popup, id: 'other-extension' }, { ...popup, tab: { id: 2 } },
    { ...popup, url: 'chrome-extension://test-extension/popup.html.attacker' }])(
    'rejects analytics/preference messages from non-popup senders', async sender => {
      expect(await send({ action: 'SET_ANALYTICS_PREFERENCE', enabled: true }, sender)).toEqual({ success: false });
      expect(await send({ action: 'TRACK_ANALYTICS', eventName: 'popup_opened' }, sender)).toEqual({ success: false });
      expect(track).not.toHaveBeenCalled();
    }
  );

  test('popup cannot forge backend outcomes through the analytics message', async () => {
    await send({ action: 'TRACK_ANALYTICS', eventName: 'setup_completed' });
    expect(track).not.toHaveBeenCalled();
    await send({ action: 'TRACK_ANALYTICS', eventName: 'popup_opened', params: {} });
    expect(track).toHaveBeenCalledWith('popup_opened', {});
  });

  test('sync source cannot be forged from unrelated pages or subframes', async () => {
    for (const sender of [{ ...canvas, frameId: 3 }, { ...canvas, url: 'https://school.instructure.com.evil.test/' },
      { ...canvas, url: 'http://school.instructure.com/' }, { ...canvas, url: 'bad URL' }]) {
      expect((await send({ action: 'START_BACKGROUND_SYNC' }, sender)).success).toBe(false);
    }
    expect(syncAssignments).not.toHaveBeenCalled();
  });

  test('clear-all preserves a durable opt-out while deleting credentials and analytics state', async () => {
    data = { encryptedCredentials: 'private', analyticsClientId: crypto.randomUUID(), analyticsMilestones: ['setup_completed'] };
    sessionData = { analyticsSession: { id: 1 } };
    expect((await send({ action: 'CLEAR_ALL_DATA' })).success).toBe(true);
    expect(data).toEqual({ analyticsEnabled: false });
    expect(sessionData).toEqual({});
    globalThis.fetch = jest.fn();
    const freshWorker = new Analytics({ measurementId: 'G-TEST123', apiSecret: 'test-secret' });
    expect(await freshWorker.track('popup_opened')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('data_cleared');
  });

  test('normal suspension is not wired to deletion', () => {
    setupSecurityHandlers();
    expect(chrome.runtime.onSuspend.addListener).not.toHaveBeenCalled();
    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled();
  });
});
