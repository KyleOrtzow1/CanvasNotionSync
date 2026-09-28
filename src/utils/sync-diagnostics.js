// Bounded, allowlisted end-of-sync diagnostics summary (issue #72).
//
// A sync that reports `errors: 7` says nothing about *what* failed: the
// assignment loop catches per-item failures and keeps going, and the next
// 30-minute auto-sync revisits the same ones. This collects coarse, fixed
// category/operation labels for those failures so a sync log entry — and, in
// aggregate, Analytics — can distinguish an error-free run from a partially
// failed one from a run where every item failed.
//
// Everything stored here is drawn from two fixed allowlists. Assignment
// titles, Canvas IDs, Notion page/database IDs, URLs, tokens, and raw error
// messages never enter a summary, so the result is safe to log and safe to
// derive an Analytics parameter from.
//
// Shared on purpose: #61's per-endpoint request timing attaches to the same
// end-of-sync summary through `recordSection()` rather than building a
// parallel mechanism.

import { ERROR_CATEGORIES, categorizeError } from './analytics.js';

// The stage an item was in when it failed. Coarse by design — enough to tell a
// create from an update from a deletion, not enough to identify an assignment.
export const SYNC_OPERATIONS = Object.freeze([
  'lookup',              // cache comparison / searching Notion for an existing page
  'create',              // creating a Notion page
  'update',              // updating a Notion page
  'delete',              // archiving a page for an assignment that went away
  'status_correction',   // rewriting a status that regressed in Notion
  'status_preservation', // reading a page's current status before a write
  'reconcile',           // the once-per-sync cache/Notion reconciliation pass
  'schema',              // reading the database schema (e.g. Checkbox detection)
  'unknown'
]);

// Distinct (category, operation) pairs retained per sync. The allowlists cap
// the theoretical maximum already; this keeps the stored object bounded even
// if either list grows later.
export const MAX_TRACKED_COMBINATIONS = 40;

// Run outcomes, in the order a report would read them.
export const SYNC_OUTCOMES = Object.freeze(['empty', 'clean', 'partial', 'all_failed']);

const NO_CATEGORY = 'none';

function safeOperation(operation) {
  return SYNC_OPERATIONS.includes(operation) ? operation : 'unknown';
}

/**
 * Counts occurrences per allowlisted key, capped at `limit` distinct keys.
 * Occurrences for keys beyond the cap are still counted, under `overflow`.
 */
class BoundedCounter {
  constructor(limit) {
    this.limit = limit;
    this.counts = new Map();
    this.overflow = 0;
  }

  add(key) {
    if (!this.counts.has(key) && this.counts.size >= this.limit) {
      this.overflow++;
      return;
    }
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
  }

  get total() {
    return this.overflow + [...this.counts.values()].reduce((sum, value) => sum + value, 0);
  }

  toObject() {
    return Object.fromEntries([...this.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }
}

/**
 * Per-sync diagnostics accumulator. One instance per sync run.
 */
export class SyncDiagnostics {
  constructor({ maxCombinations = MAX_TRACKED_COMBINATIONS } = {}) {
    this.maxCombinations = maxCombinations;
    // Failures that end up in `results.errors` — one per failed item, so the
    // occurrence count matches the `errors` count reported for the same sync.
    this.itemCategories = new BoundedCounter(ERROR_CATEGORIES.length);
    this.itemOperations = new BoundedCounter(SYNC_OPERATIONS.length);
    this.itemCombinations = new BoundedCounter(maxCombinations);
    // Failures the sync deliberately tolerates and continues past (a failed
    // reconciliation pass, a status read that did not come back). They never
    // appear in `results.errors`, and are kept separate so the two are never
    // added together by accident.
    this.suppressedCombinations = new BoundedCounter(maxCombinations);
  }

  /**
   * Record a failure that fails its item and is reported in `results.errors`.
   * @param {Error|string|{status?: number, message?: string}} error - never stored, only categorized
   * @param {string} operation - one of SYNC_OPERATIONS; anything else becomes 'unknown'
   */
  recordItemError(error, operation) {
    const category = categorizeError(error);
    const stage = safeOperation(operation);
    this.itemCategories.add(category);
    this.itemOperations.add(stage);
    this.itemCombinations.add(`${category}:${stage}`);
  }

  /**
   * Record a failure the sync swallowed and continued past. Counted apart from
   * item errors: these do not fail an assignment, but a sync that cannot
   * reconcile or cannot read statuses behaves differently from one that can.
   * @param {Error|string|{status?: number, message?: string}} error
   * @param {string} operation
   */
  recordSuppressedError(error, operation) {
    this.suppressedCombinations.add(`${categorizeError(error)}:${safeOperation(operation)}`);
  }

  /**
   * Attach an aggregate from another subsystem (e.g. #61's per-endpoint
   * timing) to this sync's summary. Sections are passed through as given —
   * callers own keeping their own data bounded and free of content.
   * @param {string} name
   * @param {Object} data
   */
  recordSection(name, data) {
    if (typeof name !== 'string' || !name || !data || typeof data !== 'object') return;
    if (!this.sections) this.sections = {};
    this.sections[name] = data; // eslint-disable-line security/detect-object-injection -- string key, plain data container
  }

  /**
   * The category responsible for the most item errors, or 'none'. Ties break on
   * the fixed category order so the value is stable run to run.
   */
  dominantCategory() {
    let winner = NO_CATEGORY;
    let best = 0;
    for (const category of ERROR_CATEGORIES) {
      const count = this.itemCategories.counts.get(category) || 0;
      if (count > best) { winner = category; best = count; }
    }
    return winner;
  }

  /**
   * Build the bounded summary for this run.
   * @param {Object} tallies
   * @param {number} tallies.itemsProcessed - items the sync attempted (successes + failures)
   * @param {number} tallies.itemsSucceeded - items that completed without error
   * @returns {Object} summary safe to log and to derive analytics parameters from
   */
  summarize({ itemsProcessed = 0, itemsSucceeded = 0 } = {}) {
    const processed = Number.isFinite(itemsProcessed) && itemsProcessed > 0 ? Math.floor(itemsProcessed) : 0;
    const succeeded = Number.isFinite(itemsSucceeded) && itemsSucceeded > 0 ? Math.floor(itemsSucceeded) : 0;
    const itemErrors = this.itemCombinations.total;

    let outcome;
    if (processed === 0) outcome = 'empty';
    else if (itemErrors === 0) outcome = 'clean';
    else if (succeeded === 0) outcome = 'all_failed';
    else outcome = 'partial';

    const summary = {
      outcome,
      itemsProcessed: processed,
      itemsSucceeded: succeeded,
      // Occurrences, not distinct assignments: one sync can fail the same
      // assignment once, and the next sync fails it again.
      itemErrors,
      dominantCategory: this.dominantCategory(),
      categories: this.itemCategories.toObject(),
      operations: this.itemOperations.toObject(),
      combinations: this.itemCombinations.toObject(),
      suppressed: this.suppressedCombinations.toObject(),
      suppressedErrors: this.suppressedCombinations.total
    };

    if (this.itemCombinations.overflow > 0) summary.untrackedCombinations = this.itemCombinations.overflow;
    if (this.suppressedCombinations.overflow > 0) summary.untrackedSuppressed = this.suppressedCombinations.overflow;
    if (this.sections) summary.sections = this.sections;
    return summary;
  }
}

/**
 * One-line, content-free description of a summary, for the sync log.
 * @param {Object} summary - from SyncDiagnostics.summarize()
 * @returns {string}
 */
export function describeDiagnostics(summary) {
  if (!summary) return 'Sync diagnostics unavailable';
  const parts = [`outcome ${summary.outcome}`, `${summary.itemErrors} item error(s)`];
  const breakdown = Object.entries(summary.combinations || {})
    .map(([key, count]) => `${key} x${count}`)
    .join(', ');
  if (breakdown) parts.push(breakdown);
  if (summary.suppressedErrors > 0) parts.push(`${summary.suppressedErrors} tolerated`);
  return `Sync diagnostics: ${parts.join('; ')}`;
}
