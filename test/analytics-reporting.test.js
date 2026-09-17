import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sanitizeEvent } from '../src/utils/analytics.js';

const doc = readFileSync(fileURLToPath(new URL('../docs/analytics.md', import.meta.url)), 'utf8');

// GA reports are built on registered parameter names and enum values, and a
// registration that names a parameter the extension never sends reports
// (not set) forever without failing anything. The doc's "Custom definitions to
// register" table is the registration instruction, so these tests read it back
// and check it against what sanitizeEvent() actually accepts.
function definitions() {
  const rows = new Map();
  for (const line of doc.split('\n')) {
    const match = line.match(/^\| `([a-z_]+)` \| (Dimension|Metric) \| (.+?) \|$/);
    if (!match) continue;
    const values = [...match[3].matchAll(/`([a-z_]+)`/g)].map(value => value[1]);
    rows.set(match[1], { kind: match[2], note: match[3], values });
  }
  return rows;
}

const registered = definitions();
const dimensions = [...registered].filter(([, row]) => row.kind === 'Dimension');
const metrics = [...registered].filter(([, row]) => row.kind === 'Metric').map(([name]) => name);

// The enum values the worker accepts, read from their definitions rather than
// restated here, so a value added to the code without a matching table row
// fails rather than quietly going unregistered.
const analyticsSource = readFileSync(
  fileURLToPath(new URL('../src/utils/analytics.js', import.meta.url)), 'utf8'
);
function literals(pattern) {
  const match = analyticsSource.match(pattern);
  if (!match) throw new Error(`No enum definition matched ${pattern}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(value => value[1]);
}
const ACCEPTED = {
  source: literals(/const SOURCES = \[([\s\S]*?)\]/),
  category: literals(/const CATEGORIES = \[([\s\S]*?)\]/),
  outcome: literals(/const outcome = enumValue\(\[([\s\S]*?)\]\)/),
  reason: literals(/auto_sync_skipped: \{ reason: enumValue\(\[([\s\S]*?)\]\)/),
  setting: literals(/settings_changed: \{ setting: enumValue\(\[([\s\S]*?)\]\)/)
};

// One event per documented enum dimension, carrying the rest of that event's
// required parameters. extension_version is added by prepare(), not by callers.
const CARRIERS = {
  source: value => ['sync_started', { source: value }],
  outcome: value => ['notion_connection_tested', { outcome: value, category: 'unknown' }],
  category: value => ['notion_connection_tested', { outcome: 'failure', category: value }],
  reason: value => ['auto_sync_skipped', { reason: value }],
  setting: value => ['settings_changed', { setting: value }]
};

describe('documented custom definitions', () => {
  test('registers the twelve definitions the reports use', () => {
    expect([...registered.keys()].sort()).toEqual([
      'category', 'created', 'deleted', 'duration_ms', 'errors', 'extension_version',
      'outcome', 'reason', 'setting', 'skipped', 'source', 'updated'
    ]);
  });

  test.each(dimensions.filter(([name]) => CARRIERS[name]))('%s documents only accepted values', (name, row) => {
    expect(row.values.length).toBeGreaterThan(0);
    for (const value of row.values) {
      expect(sanitizeEvent(...CARRIERS[name](value))).not.toBeNull();
    }
    expect(sanitizeEvent(...CARRIERS[name]('undocumented_value'))).toBeNull();
  });

  test.each(Object.entries(ACCEPTED))('%s documents every accepted value', (name, accepted) => {
    // The test above proves the documented values are accepted; this one proves
    // nothing accepted is missing from the table, which is what would leave a
    // real value out of a report's breakdown.
    expect([...registered.get(name).values].sort()).toEqual([...accepted].sort());
  });

  test('extension_version is documented as a dimension on every event', () => {
    expect(registered.get('extension_version').kind).toBe('Dimension');
    expect(registered.get('extension_version').values).toHaveLength(0);
  });

  test('the registered metrics are exactly the numeric parameters of sync_completed', () => {
    // sanitizeEvent requires the schema's keys exactly, so an accepted payload
    // built from the documented metric names proves the two sets match.
    const params = Object.fromEntries(metrics.map(name => [name, 0]));
    expect(sanitizeEvent('sync_completed', { source: 'periodic', ...params })).not.toBeNull();
    expect(metrics).toContain('errors');
    expect(metrics).toContain('duration_ms');
  });

  test('duration_ms is registered in milliseconds', () => {
    expect(registered.get('duration_ms').note).toBe('Milliseconds');
  });
});

describe('reporting guidance', () => {
  test('keeps Total users as the metric and names what it counts', () => {
    expect(doc).toMatch(/observed installation identities/);
    expect(doc).toMatch(/`Active users` renders empty by construction/);
  });

  test('refuses synthetic engagement time in production', () => {
    expect(doc).toMatch(/Do not add `engagement_time_msec` to production builds/);
  });

  test('keeps the onboarding cohorts cumulative and error-free at the last step', () => {
    const onboarding = doc.slice(doc.indexOf('### 2. Onboarding'), doc.indexOf('### 3. Reliability'));
    const steps = ['1. New installation', '2. Token saved', '3. Setup completed', '4. Error-free sync']
      .map(step => onboarding.indexOf(`| ${step} |`));

    expect(steps).not.toContain(-1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(onboarding).toMatch(/`errors` = 0/);
    expect(onboarding).toMatch(/extension_updated/);
  });

  test('keeps completions, failures, and skips as separate populations', () => {
    const reliability = doc.slice(doc.indexOf('### 3. Reliability'), doc.indexOf('### Arithmetic'));
    for (const row of ['Error-free completion', 'Partial-error completion', 'Fatal failure', 'Sampled preflight skip']) {
      expect(reliability).toContain(`| ${row} |`);
    }
  });
});
