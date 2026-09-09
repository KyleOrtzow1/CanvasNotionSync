import { ANALYTICS_CONFIG } from './analytics-config.js';

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const SESSION_MS = 30 * 60 * 1000;
const SKIP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 32;
const SOURCES = ['popup', 'canvas_page', 'periodic', 'setup'];
const CATEGORIES = ['authentication', 'permission', 'not_found', 'rate_limit', 'server',
  'network', 'configuration', 'no_canvas_tab', 'in_progress', 'integration', 'schema', 'unknown'];
const enumValue = values => value => values.includes(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;
const duration = value => Number.isSafeInteger(value) && value >= 0 && value <= 86400000;
const outcome = enumValue(['success', 'failure']);
const source = enumValue(SOURCES);
const category = enumValue(CATEGORIES);
// Every parameter is required. An unexpected key or invalid value drops the
// entire event, rather than letting a caller smuggle free text into GA.
const SCHEMAS = new Map(Object.entries({
  extension_installed: {},
  extension_updated: {},
  analytics_enabled: {},
  notion_token_saved: {},
  notion_connection_tested: { outcome, category },
  database_prepared: { outcome, category },
  setup_completed: {},
  sync_started: { source },
  sync_completed: { source, created: count, updated: count, skipped: count,
    deleted: count, errors: count, duration_ms: duration },
  sync_failed: { source, category, duration_ms: duration },
  auto_sync_skipped: { reason: enumValue(['no_canvas_tab', 'in_progress', 'configuration']) },
  popup_opened: {},
  manual_sync_clicked: { source: enumValue(['popup', 'canvas_page']) },
  settings_changed: { setting: enumValue(['canvas_token', 'notion_token', 'notion_database', 'debug_mode']) }
}));
const MILESTONES = new Set(['notion_token_saved', 'setup_completed']);
const LOCAL_STATE = ['analyticsClientId', 'analyticsMilestones', 'analyticsSkipTimes'];

export function sanitizeEvent(name, params = {}) {
  const schema = SCHEMAS.get(name);
  if (!schema || !params || typeof params !== 'object' || Array.isArray(params)) return null;
  const entries = Object.entries(schema);
  if (Object.keys(params).length !== entries.length) return null;
  const values = new Map(Object.entries(params));
  const safe = [];
  for (const [key, validate] of entries) {
    if (!values.has(key) || !validate(values.get(key))) return null;
    safe.push([key, values.get(key)]);
  }
  return { name, params: Object.fromEntries(safe) };
}

// Only this fixed category is returned; neither input strings nor Error objects
// are ever accepted by track(). Legacy Canvas errors arrive as strings.
export function categorizeError(error) {
  const status = Number(error?.status);
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status <= 599) return 'server';
  if (status === 400) return 'schema';
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (message.includes('not configured')) return 'configuration';
  if (message.includes('no canvas tabs')) return 'no_canvas_tab';
  if (message.includes('already in progress')) return 'in_progress';
  if (message.includes('session expired') || message.includes('401') || message.includes('unauthorized')) return 'authentication';
  if (message.includes('403') || message.includes('permission denied')) return 'permission';
  if (message.includes('429') || message.includes('rate limit')) return 'rate_limit';
  if (message.includes('failed to fetch') || message.includes('network') || message.includes('timeout')) return 'network';
  if (message.includes('load canvas integration') || message.includes('receiving end')) return 'integration';
  return 'unknown';
}

export function syncCounts(results, startedAt) {
  return {
    created: results?.created?.length || 0, updated: results?.updated?.length || 0,
    skipped: results?.skipped?.length || 0, deleted: results?.deleted?.length || 0,
    errors: results?.errors?.length || 0,
    duration_ms: Math.min(86400000, Math.max(0, Date.now() - startedAt))
  };
}

export class Analytics {
  constructor(config = ANALYTICS_CONFIG) {
    this.config = config;
    this.sequence = Promise.resolve();
    this.generation = 0;
    this.blocked = false;
    this.pending = 0;
    this.requests = new Set();
    this.windowStart = 0;
    this.windowCount = 0;
  }

  serialize(task) {
    const operation = this.sequence.then(task);
    this.sequence = operation.catch(() => {});
    return operation;
  }

  configured() {
    return /^G-[A-Z0-9]+$/.test(this.config.measurementId) &&
      typeof this.config.apiSecret === 'string' && this.config.apiSecret.length > 0;
  }

  async getEnabled() {
    const state = await chrome.storage.local.get('analyticsEnabled');
    return !this.blocked && state.analyticsEnabled !== false;
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Invalid analytics preference'));
    // Invalidate work immediately, before any async storage operation yields.
    const generation = ++this.generation;
    this.blocked = true;
    for (const controller of this.requests) controller.abort();
    return this.serialize(async () => {
      await chrome.storage.local.set({ analyticsEnabled: enabled });
      if (!enabled) {
        await chrome.storage.local.remove(LOCAL_STATE);
        await chrome.storage.session.remove('analyticsSession');
      }
      if (generation === this.generation) this.blocked = !enabled;
      return { success: true, enabled };
    });
  }

  track(name, params = {}) {
    try {
      const event = sanitizeEvent(name, params);
      if (!event || this.blocked || !this.configured() || this.pending >= MAX_PENDING) return Promise.resolve(false);
      const generation = this.generation;
      this.pending++;
      // Serialize only storage preparation. Fetch never holds this lock and
      // callers never need to await delivery. No persistent event queue/retry.
      return this.serialize(() => this.prepare(event, generation))
        .then(payload => payload && generation === this.generation && !this.blocked
          ? this.send(payload) : false)
        .catch(() => false)
        .finally(() => { this.pending--; });
    } catch {
      return Promise.resolve(false);
    }
  }

  async prepare(event, generation) {
    const state = await chrome.storage.local.get(['analyticsEnabled', ...LOCAL_STATE]);
    if (state.analyticsEnabled === false || this.blocked || generation !== this.generation) return null;
    const now = Date.now();
    if (now - this.windowStart >= 60000) { this.windowStart = now; this.windowCount = 0; }
    if (this.windowCount >= 60) return null;
    const milestones = new Set(Array.isArray(state.analyticsMilestones)
      ? state.analyticsMilestones.filter(name => MILESTONES.has(name)) : []);
    if (MILESTONES.has(event.name) && milestones.has(event.name)) return null;
    const skips = new Map(Object.entries(state.analyticsSkipTimes || {}));
    if (event.name === 'auto_sync_skipped' && Number.isFinite(skips.get(event.params.reason)) &&
        now - skips.get(event.params.reason) < SKIP_INTERVAL_MS) return null;

    let clientId = state.analyticsClientId;
    if (typeof clientId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(clientId)) {
      clientId = crypto.randomUUID();
    }
    const updates = { analyticsClientId: clientId };
    if (MILESTONES.has(event.name)) {
      milestones.add(event.name);
      updates.analyticsMilestones = [...milestones];
    }
    if (event.name === 'auto_sync_skipped') {
      updates.analyticsSkipTimes = Object.fromEntries(['no_canvas_tab', 'in_progress', 'configuration']
        .map(reason => [reason, reason === event.params.reason ? now : Number(skips.get(reason)) || 0]));
    }
    await chrome.storage.local.set(updates);
    // Opt-out is queued behind this operation and removes any IDs just written.
    if (this.blocked || generation !== this.generation) return null;

    const { analyticsSession } = await chrome.storage.session.get('analyticsSession');
    const interactive = event.name === 'popup_opened' || event.name === 'manual_sync_clicked' ||
      event.name === 'settings_changed';
    let session = analyticsSession;
    if (interactive) {
      if (!session || !Number.isSafeInteger(session.id) || !Number.isFinite(session.lastActivity) ||
          now - session.lastActivity >= SESSION_MS) session = { id: now, lastActivity: now };
      session = { id: session.id, lastActivity: now };
      await chrome.storage.session.set({ analyticsSession: session });
    }
    const params = { ...event.params, extension_version: chrome.runtime.getManifest().version };
    // Background events neither create nor extend an interactive session.
    // No invented engagement duration; sync duration is its own metric.
    if (session && Number.isSafeInteger(session.id) && session.id > 0 &&
        Number.isFinite(session.lastActivity) && now - session.lastActivity < SESSION_MS &&
        event.params.source !== 'periodic' && event.name !== 'auto_sync_skipped') params.session_id = session.id;
    if (this.config.debug === true) params.debug_mode = 1;
    this.windowCount++;
    return {
      client_id: clientId,
      consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
      events: [{ name: event.name, params }]
    };
  }

  async send(payload) {
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const query = new URLSearchParams({ measurement_id: this.config.measurementId, api_secret: this.config.apiSecret });
      const response = await fetch(`${ENDPOINT}?${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), credentials: 'omit', referrerPolicy: 'no-referrer',
        redirect: 'error', signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }
}

export const analytics = new Analytics();

export function setupAnalytics() {
  chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') void analytics.track('extension_installed');
    if (details.reason === 'update') void analytics.track('extension_updated');
  });
}
