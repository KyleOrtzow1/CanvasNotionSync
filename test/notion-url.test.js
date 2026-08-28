import { describe, test, expect } from '@jest/globals';
import '../src/utils/notion-url.js';
const { normalizeNotionDatabaseId } = globalThis;

// A representative Notion database ID and a different view ID, used throughout.
const DB_ID = '26ab2d53e56180fb8081d659402f9ece';
const VIEW_ID = '26ab2d53e561804c926f000c8cb145fc';

describe('normalizeNotionDatabaseId', () => {

  test('passes through a bare 32-character ID', () => {
    expect(normalizeNotionDatabaseId(DB_ID)).toBe(DB_ID);
  });

  test('strips dashes from a UUID-formatted ID', () => {
    expect(normalizeNotionDatabaseId('26ab2d53-e561-80fb-8081-d659402f9ece')).toBe(DB_ID);
  });

  test('extracts the ID from an app.notion.com URL', () => {
    expect(normalizeNotionDatabaseId(`https://app.notion.com/p/${DB_ID}`)).toBe(DB_ID);
  });

  test('takes the database ID, not the ?v= view ID', () => {
    const url = `https://app.notion.com/p/${DB_ID}?v=${VIEW_ID}`;
    expect(normalizeNotionDatabaseId(url)).toBe(DB_ID);
    expect(normalizeNotionDatabaseId(url)).not.toBe(VIEW_ID);
  });

  test('extracts the ID from a slugged workspace URL', () => {
    expect(
      normalizeNotionDatabaseId(`https://www.notion.so/workspace/My-Tasks-${DB_ID}`)
    ).toBe(DB_ID);
  });

  test('ignores a trailing slash and a URL fragment', () => {
    expect(normalizeNotionDatabaseId(`https://www.notion.so/${DB_ID}/`)).toBe(DB_ID);
    expect(normalizeNotionDatabaseId(`https://www.notion.so/${DB_ID}#block`)).toBe(DB_ID);
  });

  test('lowercases an uppercase ID', () => {
    expect(normalizeNotionDatabaseId(DB_ID.toUpperCase())).toBe(DB_ID);
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeNotionDatabaseId(`  ${DB_ID}  `)).toBe(DB_ID);
  });

  test('returns empty string when no ID is present', () => {
    expect(normalizeNotionDatabaseId('')).toBe('');
    expect(normalizeNotionDatabaseId(null)).toBe('');
    expect(normalizeNotionDatabaseId(undefined)).toBe('');
    expect(normalizeNotionDatabaseId('not-a-database')).toBe('');
    expect(normalizeNotionDatabaseId('https://app.notion.com/p/')).toBe('');
  });

  test('rejects an ID of the wrong length', () => {
    expect(normalizeNotionDatabaseId(DB_ID.slice(0, 31))).toBe('');
  });
});
