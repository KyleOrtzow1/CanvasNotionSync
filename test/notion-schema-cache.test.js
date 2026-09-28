/**
 * Tests for the Notion data source schema cache and the select-option lookup
 * built on it (#56).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import {
  NotionSchemaCache,
  NOTION_SCHEMA_TTL,
  getSelectOptionNames
} from '../src/cache/notion-schema-cache.js';

const SCHEMA = {
  'Assignment Name': { id: 'p1', type: 'title' },
  'Status': {
    id: 'p2',
    type: 'select',
    select: { options: [{ name: 'Not Started' }, { name: 'Graded' }] }
  }
};

describe('NotionSchemaCache', () => {
  let cache;

  beforeEach(() => {
    cache = new NotionSchemaCache();
  });

  test('defaults to an hour, long enough to span the 30-minute auto-sync', () => {
    expect(NOTION_SCHEMA_TTL).toBe(60 * 60 * 1000);
    expect(cache.ttl).toBe(NOTION_SCHEMA_TTL);
  });

  test('getOrFetch reads through on a miss and caches the result', async () => {
    const fetchSchema = jest.fn(async () => SCHEMA);

    await expect(cache.getOrFetch('ds1', fetchSchema)).resolves.toBe(SCHEMA);
    await expect(cache.getOrFetch('ds1', fetchSchema)).resolves.toBe(SCHEMA);

    expect(fetchSchema).toHaveBeenCalledTimes(1);
  });

  test('caches per data source, so a different database is read separately', async () => {
    const first = jest.fn(async () => SCHEMA);
    const second = jest.fn(async () => ({ Other: { type: 'select' } }));

    await cache.getOrFetch('ds1', first);
    await cache.getOrFetch('ds2', second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(await cache.get('ds2')).toEqual({ Other: { type: 'select' } });
  });

  test('re-reads once the TTL has passed', async () => {
    const shortLived = new NotionSchemaCache({ ttl: 1 });
    const fetchSchema = jest.fn(async () => SCHEMA);

    await shortLived.getOrFetch('ds1', fetchSchema);
    await new Promise(resolve => setTimeout(resolve, 5));
    await shortLived.getOrFetch('ds1', fetchSchema);

    expect(fetchSchema).toHaveBeenCalledTimes(2);
  });

  test('a failed read is not cached as "no schema" for the whole TTL', async () => {
    const fetchSchema = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SCHEMA);

    await expect(cache.getOrFetch('ds1', fetchSchema)).resolves.toBeNull();
    await expect(cache.getOrFetch('ds1', fetchSchema)).resolves.toBe(SCHEMA);

    expect(fetchSchema).toHaveBeenCalledTimes(2);
  });

  test('invalidate forces the next read to go back to Notion', async () => {
    const fetchSchema = jest.fn(async () => SCHEMA);

    await cache.getOrFetch('ds1', fetchSchema);
    await cache.invalidate('ds1');

    expect(await cache.get('ds1')).toBeNull();
    await cache.getOrFetch('ds1', fetchSchema);
    expect(fetchSchema).toHaveBeenCalledTimes(2);
  });

  test('invalidating one data source leaves the others alone', async () => {
    await cache.set('ds1', SCHEMA);
    await cache.set('ds2', SCHEMA);

    await cache.invalidate('ds1');

    expect(await cache.get('ds1')).toBeNull();
    expect(await cache.get('ds2')).toBe(SCHEMA);
  });

  test('clear drops everything', async () => {
    await cache.set('ds1', SCHEMA);
    await cache.clear();
    expect(await cache.get('ds1')).toBeNull();
  });

  test('ignores a missing data source ID rather than caching under undefined', async () => {
    await cache.set(undefined, SCHEMA);
    expect(await cache.get(undefined)).toBeNull();
    await expect(cache.invalidate(undefined)).resolves.toBeUndefined();
  });
});

describe('getSelectOptionNames', () => {
  test('lists the options a select column offers', () => {
    expect(getSelectOptionNames(SCHEMA, 'Status')).toEqual(['Not Started', 'Graded']);
  });

  test('returns an empty list for a select with no options yet (a fresh Course column)', () => {
    expect(getSelectOptionNames({ Course: { type: 'select', select: {} } }, 'Course')).toEqual([]);
  });

  test('returns null for a column the database does not have', () => {
    expect(getSelectOptionNames(SCHEMA, 'Course')).toBeNull();
  });

  test('returns null for a same-named column of another type', () => {
    // Notion's own `status` type, which the template cannot create — there is
    // nothing here to validate select values against.
    expect(getSelectOptionNames({ Status: { type: 'status' } }, 'Status')).toBeNull();
  });

  test('returns null when there is no schema at all', () => {
    expect(getSelectOptionNames(null, 'Status')).toBeNull();
    expect(getSelectOptionNames(undefined, 'Status')).toBeNull();
  });

  test('skips malformed options instead of yielding undefined names', () => {
    const schema = { Course: { type: 'select', select: { options: [{ name: 'ENG101' }, {}, null] } } };
    expect(getSelectOptionNames(schema, 'Course')).toEqual(['ENG101']);
  });
});
