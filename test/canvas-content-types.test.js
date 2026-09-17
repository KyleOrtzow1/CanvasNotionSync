import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import '../src/api/canvas-rate-limiter.js';
import { NotionRateLimiter } from '../src/api/notion-rate-limiter.js';
import { AssignmentCacheManager } from '../src/cache/assignment-cache-manager.js';

const { CanvasRateLimiter } = globalThis;

const doc = readFileSync(
  fileURLToPath(new URL('../docs/canvas-content-types.md', import.meta.url)),
  'utf8'
);

// The write-up's ordering argument is arithmetic over the limiter and cache
// settings, so a change to any of them invalidates the recommendation rather
// than merely dating it. The doc lists each value it relies on in a table;
// these tests read that table back and compare it against the live objects, so
// the two cannot drift apart silently.
function documentedConstants() {
  const rows = new Map();
  for (const line of doc.split('\n')) {
    const match = line.match(/^\|\s*`([A-Za-z]+\.[A-Za-z]+)`\s*\|\s*([0-9]+)\s*\|\s*`([^`]+)`\s*\|$/);
    if (match) {
      rows.set(match[1], { value: Number(match[2]), source: match[3] });
    }
  }
  return rows;
}

describe('docs/canvas-content-types.md', () => {
  const constants = documentedConstants();

  const live = {
    'CanvasRateLimiter.bucketCapacity': {
      actual: () => new CanvasRateLimiter().bucketCapacity,
      source: 'src/api/canvas-rate-limiter.js'
    },
    'CanvasRateLimiter.leakRate': {
      actual: () => new CanvasRateLimiter().leakRate,
      source: 'src/api/canvas-rate-limiter.js'
    },
    'NotionRateLimiter.maxRequestsPerSecond': {
      actual: () => new NotionRateLimiter().maxRequestsPerSecond,
      source: 'src/api/notion-rate-limiter.js'
    },
    'NotionRateLimiter.averageRequestsPerSecond': {
      actual: () => new NotionRateLimiter().averageRequestsPerSecond,
      source: 'src/api/notion-rate-limiter.js'
    },
    'AssignmentCacheManager.defaultTTL': {
      actual: () => new AssignmentCacheManager().defaultTTL,
      source: 'src/cache/assignment-cache-manager.js'
    }
  };

  test('documents every constant its cost model uses', () => {
    expect([...constants.keys()].sort()).toEqual(Object.keys(live).sort());
  });

  test.each(Object.entries(live))('%s matches the documented value', (name, { actual, source }) => {
    const documented = constants.get(name);
    expect(documented).toBeDefined();
    expect(documented.value).toBe(actual());
    expect(documented.source).toBe(source);
  });

  test('keeps the recommended build order ahead of the deferred types', () => {
    const order = ['Announcements', 'Calendar events', 'Modules / pages', 'Files', 'Grades / submissions']
      .map(type => doc.indexOf(`| ${type} |`));

    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
