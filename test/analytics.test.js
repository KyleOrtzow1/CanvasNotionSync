import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
import { Analytics, analytics, categorizeError, sanitizeEvent, setupAnalytics, syncCounts } from '../src/utils/analytics.js';
import { analyticsConfigFromEnv } from '../scripts/configure-analytics.mjs';

const CONFIG = { measurementId: 'G-TEST123456', apiSecret: 'test-write-secret', debug: false };
let local;
let session;
let client;

function storageArea() {
  const data = {};
  return {
    data,
    get: jest.fn(async keys => {
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, data[key]]));
      return { ...data };
    }),
    set: jest.fn(async values => Object.assign(data, values)),
    remove: jest.fn(async keys => { for (const key of [keys].flat()) delete data[key]; })
  };
}

beforeEach(() => {
  local = storageArea();
  session = storageArea();
  globalThis.chrome = {
    storage: { local, session },
    runtime: { getManifest: () => ({ version: '1.1.0' }), onInstalled: { addListener: jest.fn() } }
  };
  globalThis.fetch = jest.fn(async () => ({ ok: true }));
  client = new Analytics(CONFIG);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

const payloads = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

describe('analytics privacy boundary and transport', () => {
  test('default-on sends a minimal event directly, without cookies, referrer, or ads consent', async () => {
    expect(await client.getEnabled()).toBe(true);
    expect(await client.track('popup_opened')).toBe(true);
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).origin + new URL(url).pathname).toBe('https://www.google-analytics.com/mp/collect');
    expect(new URL(url).searchParams.get('measurement_id')).toBe(CONFIG.measurementId);
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    const payload = payloads()[0];
    expect(Object.keys(payload).sort()).toEqual(['client_id', 'consent', 'events']);
    expect(payload.client_id).toBe(local.data.analyticsClientId);
    expect(payload.client_id).toMatch(/^[0-9]{1,10}\.[0-9]{1,10}$/);
    expect(payload.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
    expect(payload.events).toEqual([{ name: 'popup_opened', params: {
      extension_version: '1.1.0', session_id: expect.any(Number)
    } }]);
  });

  test.each([
    ['unknown_event', {}], ['sync_started', { source: 'https://school.instructure.com/courses/123' }],
    ['popup_opened', { token: 'ntn_private' }], ['sync_started', { source: 'popup', databaseId: 'private' }],
    ['settings_changed', { setting: 'debug_mode', value: 'assignment title' }],
    ['sync_failed', { source: 'popup', category: 'raw error containing ntn_private', duration_ms: 1 }],
    ['sync_started', { source: { url: 'https://private.example' } }], ['popup_opened', null],
    ['popup_opened', []], ['sync_started', {}], ['constructor', {}],
    ['sync_completed', { source: 'popup', created: -1, updated: 0, skipped: 0, deleted: 0, errors: 0, duration_ms: 1 }],
    ['sync_failed', { source: 'popup', category: 'unknown', duration_ms: Infinity }]
  ])('drops invalid event %s and all unexpected parameters', async (name, params) => {
    expect(await client.track(name, params)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
  });

  test('copies allowed parameters before a caller can mutate them', async () => {
    const params = { source: 'popup' };
    const delivery = client.track('sync_started', params);
    params.source = 'private URL';
    await delivery;
    expect(payloads()[0].events[0].params.source).toBe('popup');
  });

  test('does not send anything or generate an ID when unconfigured', async () => {
    expect(await new Analytics({ measurementId: '', apiSecret: '', debug: false }).track('extension_installed')).toBe(false);
    expect(local.set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('network and storage failures resolve silently without logs', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    fetch.mockRejectedValueOnce(new Error('network private URL'));
    expect(await client.track('popup_opened')).toBe(false);
    local.get.mockRejectedValueOnce(new Error('storage failed'));
    expect(await client.track('popup_opened')).toBe(false);
    fetch.mockResolvedValueOnce({ ok: false });
    expect(await client.track('popup_opened')).toBe(false);
    expect(errorLog).not.toHaveBeenCalled();
    expect(client.requests.size).toBe(0);
  });

  test('times out a stuck request without retrying', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const delivery = client.track('popup_opened');
    await jest.advanceTimersByTimeAsync(3001);
    expect(await delivery).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('bounds queued work and per-minute traffic', async () => {
    await Promise.all(Array.from({ length: 100 }, () => client.track('popup_opened')));
    expect(fetch).toHaveBeenCalledTimes(32);
    for (let i = 0; i < 50; i++) await client.track('popup_opened');
    expect(fetch).toHaveBeenCalledTimes(60);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    expect(await client.track('popup_opened')).toBe(true);
  });
});

describe('preference, identity and lifecycle', () => {
  test('stored opt-out survives restart and prevents all analytics network requests', async () => {
    local.data.analyticsEnabled = false;
    expect(await client.getEnabled()).toBe(false);
    expect(await client.track('extension_updated')).toBe(false);
    expect(await new Analytics(CONFIG).track('popup_opened')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(local.data.analyticsClientId).toBeUndefined();
  });

  test('concurrent events and a worker restart reuse one generated installation ID', async () => {
    await Promise.all([client.track('popup_opened'), client.track('sync_started', { source: 'popup' })]);
    await new Analytics(CONFIG).track('extension_updated');
    expect(new Set(payloads().map(payload => payload.client_id)).size).toBe(1);
  });

  test('migrates a legacy UUID once and keeps the new ID across worker restarts', async () => {
    const legacyId = 'f1ef4d74-0b8f-4552-9d04-a6d72894ef0b';
    local.data.analyticsClientId = legacyId;
    await client.track('popup_opened');
    const migratedId = local.data.analyticsClientId;
    expect(migratedId).toMatch(/^[0-9]{1,10}\.[0-9]{1,10}$/);
    await new Analytics(CONFIG).track('popup_opened');
    expect(payloads().map(payload => payload.client_id)).toEqual([migratedId, migratedId]);
    expect(JSON.stringify(payloads())).not.toContain(legacyId);
  });
  test('replaces malformed stored IDs rather than forwarding arbitrary storage strings', async () => {
    local.data.analyticsClientId = 'ntn_private-token';
    await client.track('popup_opened');
    expect(JSON.stringify(payloads())).not.toContain('ntn_private');
  });

  test('opt-out invalidates queued preparations without creating an identity', async () => {
    const event = client.track('popup_opened');
    const preference = client.setEnabled(false);
    expect(await event).toBeFalsy();
    await preference;
    expect(local.data).toEqual({ analyticsEnabled: false });
    expect(session.data).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  test('opt-out aborts in-flight requests without waiting for Google', async () => {
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      requestStarted();
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const event = client.track('popup_opened');
    await started;
    await client.setEnabled(false);
    expect(await event).toBe(false);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await client.track('popup_opened')).toBe(false);
  });

  test('opt-out during an ID write retains the identity without sending afterwards', async () => {
    let release;
    let writing;
    const gate = new Promise(resolve => { release = resolve; });
    const wrote = new Promise(resolve => { writing = resolve; });
    local.set.mockImplementationOnce(async values => {
      writing();
      await gate;
      Object.assign(local.data, values);
    });
    const event = client.track('popup_opened');
    await wrote;
    const disable = client.setEnabled(false);
    release();
    await Promise.all([event, disable]);
    expect(local.data).toEqual({ analyticsEnabled: false, analyticsClientId: expect.stringMatching(/^[0-9]{1,10}\.[0-9]{1,10}$/) });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('reenabling after a worker restart reuses the identity and starts a fresh session', async () => {
    await client.track('popup_opened');
    const firstId = local.data.analyticsClientId;
    const oldSession = session.data.analyticsSession;
    await client.setEnabled(false);
    expect(session.data).toEqual({});
    const restarted = new Analytics(CONFIG);
    expect(await restarted.track('popup_opened')).toBe(false);
    expect(local.data.analyticsClientId).toBe(firstId);
    jest.spyOn(Date, 'now').mockReturnValue(oldSession.lastActivity + 1000);
    await restarted.setEnabled(true);
    await restarted.track('popup_opened');
    expect(local.data.analyticsClientId).toBe(firstId);
    expect(session.data.analyticsSession.id).not.toBe(oldSession.id);
    expect(payloads().map(payload => payload.client_id)).toEqual([firstId, firstId]);
    await Promise.all([client.setEnabled(true), client.setEnabled(false)]);
    expect(await client.getEnabled()).toBe(false);
    expect(await client.track('popup_opened')).toBe(false);
    await expect(client.setEnabled('false')).rejects.toThrow();
  });

  test('explicit opt-out sends one final event and repeated opt-out sends nothing', async () => {
    await client.track('popup_opened');
    const id = local.data.analyticsClientId;
    fetch.mockClear();
    await client.setEnabled(false, { recordOptOut: true });
    expect(payloads()).toEqual([{ client_id: id,
      consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
      events: [{ name: 'analytics_disabled', params: { extension_version: '1.1.0' } }] }]);
    expect(local.data).toEqual({ analyticsEnabled: false, analyticsClientId: id });
    await client.setEnabled(false, { recordOptOut: true });
    expect(await client.track('popup_opened')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('opt-out remains saved when its final event times out', async () => {
    jest.useFakeTimers();
    fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const disable = client.setEnabled(false, { recordOptOut: true });
    await jest.advanceTimersByTimeAsync(3001);
    await expect(disable).resolves.toEqual({ success: true, enabled: false });
    expect(local.data).toEqual({ analyticsEnabled: false, analyticsClientId: expect.stringMatching(/^[0-9]{1,10}\.[0-9]{1,10}$/) });
    expect(await client.track('popup_opened')).toBe(false);
  });

  test.each([true, false])('clear data preserves the identity and preference %s across restart', async enabled => {
    await client.track('popup_opened');
    const previousId = local.data.analyticsClientId;
    await client.setEnabled(enabled);
    await client.clearData();
    expect(local.data).toEqual({ analyticsEnabled: enabled, analyticsClientId: previousId });
    expect(session.data).toEqual({});
    const restarted = new Analytics(CONFIG);
    expect(await restarted.getEnabled()).toBe(enabled);
    await restarted.setEnabled(true);
    await restarted.track('popup_opened');
    expect(local.data.analyticsClientId).toBe(previousId);
  });

  test('storage failure while opting out stays blocked in the current worker', async () => {
    local.set.mockRejectedValueOnce(new Error('quota'));
    await expect(client.setEnabled(false)).rejects.toThrow('quota');
    expect(await client.track('popup_opened')).toBe(false);
  });

  test('installation listener distinguishes extension install/update from Chrome update', () => {
    const track = jest.spyOn(analytics, 'track').mockResolvedValue(true);
    setupAnalytics();
    const listener = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
    for (const reason of ['install', 'update', 'chrome_update']) listener({ reason });
    expect(track.mock.calls).toEqual([['extension_installed'], ['extension_updated']]);
  });
});

describe('event meaning and reporting metadata', () => {
  test('setup milestones deduplicate across autosaves and restarts', async () => {
    await Promise.all(Array.from({ length: 10 }, () => client.track('notion_token_saved')));
    await new Analytics(CONFIG).track('notion_token_saved');
    await client.track('setup_completed');
    await client.track('setup_completed');
    expect(payloads().map(p => p.events[0].name)).toEqual(['notion_token_saved', 'setup_completed']);
  });

  test('skip reasons are limited to once per reason per day, including restarts', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await client.track('auto_sync_skipped', { reason: 'no_canvas_tab' });
    expect(await new Analytics(CONFIG).track('auto_sync_skipped', { reason: 'no_canvas_tab' })).toBeFalsy();
    await client.track('auto_sync_skipped', { reason: 'configuration' });
    Date.now.mockReturnValue(now + 86400001);
    await client.track('auto_sync_skipped', { reason: 'no_canvas_tab' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('background activity never creates or extends an interactive session or invents engagement time', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await client.track('sync_started', { source: 'periodic' });
    expect(session.data.analyticsSession).toBeUndefined();
    await client.track('popup_opened');
    const originalSession = { ...session.data.analyticsSession };
    Date.now.mockReturnValue(now + 1000);
    await client.track('sync_started', { source: 'periodic' });
    expect(session.data.analyticsSession).toEqual(originalSession);
    expect(payloads()[2].events[0].params.session_id).toBeUndefined();
    Date.now.mockReturnValue(now + 1800001);
    await client.track('manual_sync_clicked', { source: 'popup' });
    expect(session.data.analyticsSession.id).not.toBe(originalSession.id);
    expect(JSON.stringify(payloads())).not.toContain('engagement_time_msec');
  });

  test('DebugView mode is a build setting, independent of the user debug logging toggle', async () => {
    local.data.debugMode = true;
    await client.track('popup_opened');
    await new Analytics({ ...CONFIG, debug: true }).track('popup_opened');
    expect(payloads()[0].events[0].params.debug_mode).toBeUndefined();
    expect(payloads()[0].events[0].params.engagement_time_msec).toBeUndefined();
    expect(payloads()[1].events[0].params.debug_mode).toBe(1);
    expect(payloads()[1].events[0].params.engagement_time_msec).toBe(100);
  });

  test('summaries extract counts, including partial failures, never content', () => {
    const stats = syncCounts({ created: [{ title: 'private' }], updated: [], skipped: [],
      deleted: [{ id: 'private' }], errors: [{ error: 'private URL' }] }, Date.now());
    expect(stats).toMatchObject({ created: 1, updated: 0, skipped: 0, deleted: 1, errors: 1 });
    expect(sanitizeEvent('sync_completed', { source: 'setup', ...stats })).not.toBeNull();
    expect(JSON.stringify(stats)).not.toContain('private');
  });

  test.each([[401, 'authentication'], [403, 'permission'], [404, 'not_found'], [429, 'rate_limit'],
    [503, 'server'], [400, 'schema']])('maps HTTP %i to a fixed category', (status, expected) => {
    expect(categorizeError({ status, message: 'private URL and token' })).toBe(expected);
  });
  test.each([['Notion credentials not configured', 'configuration'], ['No Canvas tabs found', 'no_canvas_tab'],
    ['Sync already in progress', 'in_progress'], ['Canvas session expired', 'authentication'],
    ['403 permission denied', 'permission'], ['429 rate limit', 'rate_limit'], ['Failed to fetch', 'network'],
    ['Failed to load Canvas integration', 'integration'], ['token ntn_private URL', 'unknown'], [null, 'unknown']])(
    'maps legacy errors without forwarding strings', (input, expected) => expect(categorizeError(input)).toBe(expected)
  );
});

describe('build configuration', () => {
  test('requires both values and defaults to production', () => {
    expect(() => analyticsConfigFromEnv({})).toThrow('GA4_MEASUREMENT_ID');
    expect(() => analyticsConfigFromEnv({ GA4_MEASUREMENT_ID: CONFIG.measurementId })).toThrow();
    expect(analyticsConfigFromEnv({ GA4_MEASUREMENT_ID: CONFIG.measurementId, GA4_API_SECRET: CONFIG.apiSecret })).toEqual(CONFIG);
  });
  test('validates debug mode and rejects malformed configuration without echoing secrets', () => {
    const env = { GA4_MEASUREMENT_ID: CONFIG.measurementId, GA4_API_SECRET: CONFIG.apiSecret };
    expect(analyticsConfigFromEnv({ ...env, GA4_DEBUG: 'true' }).debug).toBe(true);
    expect(() => analyticsConfigFromEnv({ ...env, GA4_DEBUG: 'yes' })).toThrow('GA4_DEBUG');
    expect(() => analyticsConfigFromEnv({ ...env, GA4_API_SECRET: 'private\nsecret' })).toThrow(/^Set GA4/);
  });
});
