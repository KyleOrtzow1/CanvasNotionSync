import { CacheManager } from './cache-manager.js';
import '../utils/debug.js';
const { Debug } = globalThis;

// A user editing their database mid-session is rare but not impossible, so the
// schema is re-read hourly rather than kept for the life of the service worker.
// Anything that knowingly changes the schema (running "Set Up Database" again)
// invalidates the entry outright instead of waiting this out.
export const NOTION_SCHEMA_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Cache of Notion data source property schemas, keyed by data source ID.
 *
 * Deliberately memory-only: a schema is cheap to re-read, a restarted service
 * worker starts a sync with `initialize()` anyway, and persisting it would put
 * the user's column layout in chrome.storage for no benefit.
 */
export class NotionSchemaCache {
  /**
   * @param {Object} config
   * @param {number} config.ttl - Entry lifetime in milliseconds
   * @param {number} config.maxEntries - How many data sources to remember
   */
  constructor(config = {}) {
    this.ttl = config.ttl || NOTION_SCHEMA_TTL;
    this.cache = new CacheManager({
      maxMemorySize: config.maxEntries || 5,
      defaultTTL: this.ttl,
      enablePersistence: false,
      storageKey: 'notion_schema_cache'
    });
  }

  keyFor(dataSourceId) {
    return `notion:schema:${dataSourceId}`;
  }

  /**
   * @param {string} dataSourceId
   * @returns {Promise<Object|null>} Cached `properties` map, or null when absent/expired
   */
  async get(dataSourceId) {
    if (!dataSourceId) return null;
    return await this.cache.get(this.keyFor(dataSourceId));
  }

  /**
   * @param {string} dataSourceId
   * @param {Object} schema - `properties` from a Notion data source
   */
  async set(dataSourceId, schema) {
    if (!dataSourceId || !schema) return;
    await this.cache.set(this.keyFor(dataSourceId), schema, this.ttl);
  }

  /**
   * Return the cached schema, or fetch and cache it. `fetchSchema` is only
   * called on a miss, so a sync that runs within the TTL costs no round trip.
   * A fetch returning nothing is not cached — a transient failure shouldn't
   * pin "no schema" for an hour.
   * @param {string} dataSourceId
   * @param {Function} fetchSchema - async () => properties|null
   * @returns {Promise<Object|null>}
   */
  async getOrFetch(dataSourceId, fetchSchema) {
    const cached = await this.get(dataSourceId);
    if (cached) return cached;

    const schema = await fetchSchema();
    if (schema) {
      await this.set(dataSourceId, schema);
    }
    return schema || null;
  }

  /**
   * Drop the cached schema for one data source. Called after anything that
   * changes the schema on purpose, so the next sync reads the new one.
   * @param {string} dataSourceId
   */
  async invalidate(dataSourceId) {
    if (!dataSourceId) return;
    await this.cache.delete(this.keyFor(dataSourceId));
    Debug.log(`Invalidated cached Notion schema for data source ${dataSourceId}`);
  }

  async clear() {
    await this.cache.clear();
  }
}

/**
 * Names of the options a `select` property actually offers.
 *
 * Returns null — meaning "nothing to validate against" — when the property is
 * missing or is not a select, so a database whose Status is a status column
 * (Notion's own type, which the template can't create) is never reported as
 * having unknown values.
 * @param {Object} schema - `properties` from a Notion data source
 * @param {string} propertyName
 * @returns {string[]|null}
 */
export function getSelectOptionNames(schema, propertyName) {
  // Map lookup rather than schema[propertyName]: the key comes from a caller,
  // and indexing an object with it trips security/detect-object-injection.
  const definition = new Map(Object.entries(schema || {})).get(propertyName);
  if (!definition || definition.type !== 'select') return null;

  return (definition.select?.options || [])
    .map(option => option?.name)
    .filter(name => typeof name === 'string');
}

// Shared instance. Setup and sync run in the same service worker, so
// invalidating here after "Set Up Database" is what the next sync reads.
export const notionSchemaCache = new NotionSchemaCache();
