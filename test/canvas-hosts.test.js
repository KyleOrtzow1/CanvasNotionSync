import { describe, test, expect, beforeAll } from '@jest/globals';

describe('canvas-hosts shared module', () => {
  let CANVAS_DOMAINS, CANVAS_TAB_PATTERNS, CANVAS_HOST_RE;

  beforeAll(async () => {
    await import('../src/utils/canvas-hosts.js');
    ({ CANVAS_DOMAINS, CANVAS_TAB_PATTERNS, CANVAS_HOST_RE } = globalThis);
  });

  test('lists both supported Canvas domains', () => {
    expect(CANVAS_DOMAINS).toEqual(['instructure.com', 'canvaslms.com']);
  });

  test('derives an https-only chrome.tabs.query pattern for each domain', () => {
    expect(CANVAS_TAB_PATTERNS).toEqual([
      'https://*.instructure.com/*',
      'https://*.canvaslms.com/*'
    ]);
  });

  test('CANVAS_HOST_RE matches an instructure.com URL', () => {
    expect(CANVAS_HOST_RE.test('https://school.instructure.com/courses/1')).toBe(true);
  });

  test('CANVAS_HOST_RE matches a canvaslms.com URL', () => {
    expect(CANVAS_HOST_RE.test('https://school.canvaslms.com/courses/1')).toBe(true);
  });

  test('CANVAS_HOST_RE captures the origin as group 1', () => {
    const match = 'https://school.canvaslms.com/courses/1'.match(CANVAS_HOST_RE);
    expect(match[1]).toBe('https://school.canvaslms.com');
  });

  test('CANVAS_HOST_RE rejects http:// (manifest only grants https)', () => {
    expect(CANVAS_HOST_RE.test('http://school.instructure.com/courses/1')).toBe(false);
    expect(CANVAS_HOST_RE.test('http://school.canvaslms.com/courses/1')).toBe(false);
  });

  test('CANVAS_HOST_RE rejects unrelated domains', () => {
    expect(CANVAS_HOST_RE.test('https://school.example.com/courses/1')).toBe(false);
    expect(CANVAS_HOST_RE.test('https://notinstructure.com.evil.com/courses/1')).toBe(false);
  });
});
