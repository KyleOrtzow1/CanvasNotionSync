# Sync diagnostics

What the extension records about *why* individual assignments fail during a
sync, and what that data can and cannot establish. Introduced for issue #72.

## The gap this closes

`sync_completed` carried an `errors` count and nothing else. The assignment loop
in `src/sync/assignment-syncer.js` catches a per-item failure, records it in
`results.errors`, and moves to the next assignment, so a run finishes "complete"
whether one item failed or every one did. Local sync logs held the messages, but
only the newest 100 entries, mixed in with routine activity.

That left three questions unanswerable from the data we had:

1. Was a completion error-free, partially failed, or a run in which nothing
   landed at all?
2. Which stage failed — creating a page, updating one, deleting one, reading a
   status?
3. Were the failures one kind of problem repeated, or several different ones?

## What is recorded

`src/utils/sync-diagnostics.js` accumulates one `SyncDiagnostics` per sync run.
The syncer replaces it at the start of every run, so counts never carry over.

Every failure is reduced to two allowlisted labels before it is stored:

- **Category** — the same fixed list the analytics contract uses
  (`ERROR_CATEGORIES` in `src/utils/analytics.js`): `authentication`,
  `permission`, `not_found`, `rate_limit`, `server`, `network`, `configuration`,
  `no_canvas_tab`, `in_progress`, `integration`, `schema`, `unknown`.
- **Operation** — the stage the item reached (`SYNC_OPERATIONS`): `lookup`,
  `create`, `update`, `delete`, `status_correction`, `status_preservation`,
  `reconcile`, `schema`, `unknown`.

Nothing else is kept. Assignment titles, Canvas IDs, Notion page and database
IDs, URLs, tokens, and raw error messages never enter a summary, which is why
the same summary is safe to write to the sync log and to derive an Analytics
parameter from. Raw messages remain where they already were: `results.errors`,
`sync_error_stats.lastSyncErrors`, and the sync log's own entries, all local.

Two buckets are kept deliberately apart:

- **Item errors** — failures that fail their item and appear in
  `results.errors`. The occurrence count matches the `errors` count reported for
  the same sync exactly, so the two can never be added together by accident.
- **Tolerated failures** — failures the sync swallows and continues past: a
  failed reconciliation pass, a status read that did not come back, a schema
  read for the `Checkbox` column. They never fail an item, but a sync that
  cannot reconcile behaves differently from one that can, so they are counted
  under `suppressed` rather than discarded.

The summary is bounded by construction: counters are capped at
`MAX_TRACKED_COMBINATIONS` distinct category/operation pairs, and occurrences
past the cap are still counted under `untrackedCombinations` instead of growing
the object. Five thousand failures produce the same size summary as five.

`recordSection(name, data)` exists so the per-endpoint request timing in #61
attaches to this same end-of-sync summary instead of building a parallel one.

## Where it surfaces

| Surface | Content |
| --- | --- |
| `results.diagnostics` | Full bounded summary, returned to the sync handlers |
| Sync log (popup) | One `Sync diagnostics: …` entry per sync, plus the summary in its details |
| `sync_error_stats.lastSyncDiagnostics` | Last run's summary, cleared on a fatal failure |
| Debug console | Outcome and breakdown lines in the sync summary, debug mode only |
| Analytics | Two aggregate parameters only (below) |

## Outcomes

| `outcome` | Meaning |
| --- | --- |
| `empty` | No items to sync |
| `clean` | Every item succeeded |
| `partial` | Some items failed |
| `all_failed` | No item succeeded |

Deleted (archived) assignments count as items, so a run whose only work was a
failed deletion is `all_failed`, not `clean`.

## What goes to Analytics

Two parameters were added to the validated `sync_completed` contract:
`item_outcome` (the outcome above) and `item_error_category` (the category
behind the most item errors in that sync, or `none`). Both are fixed
enumerations; an unlisted value drops the whole event, as with every other
parameter. The per-category, per-operation breakdown stays local.

`errors` remains a count of occurrences within one sync. It is not a count of
distinct failing assignments, and it is not a count of affected syncs — those
are three different numbers:

- **Occurrences**: the `errors` metric, summed across events.
- **Affected syncs**: `sync_completed` events with `item_outcome` of `partial`
  or `all_failed`. Count events, not the `errors` metric.
- **Observed installation identities**: GA `Total users` over those events —
  installation identities, not people (see `docs/analytics.md`).

A sync that fails the same five assignments every 30 minutes produces new
occurrences on every run without any new assignment failing. Occurrence totals
alone therefore cannot establish how many assignments or installations are
affected.

## Investigation status (September 2026)

Issue #72 opened against production Analytics for September 12–13, 2026: 125
periodic `sync_completed` events across 7 installation identities, 7,375
item-error occurrences, and 20 periodic fatal network failures from a single
installation identity.

**Confirmed**: nothing about the cause. The counts above are observed event
totals. They do not identify which operation failed, whether the occurrences
concentrate in one installation, or whether the item errors and the fatal
network failures are the same problem.

**Hypotheses, none verified**:

- One or a few installations in a durably broken state (revoked Notion access,
  a deleted database, an expired Canvas session) failing every assignment on
  every 30-minute sync. Would appear as `all_failed` with a stable
  `item_error_category` of `authentication`, `not_found`, or `permission`.
- Transient Notion/Canvas failures spread thinly across many syncs. Would appear
  as `partial` with `rate_limit`, `server`, or `network`.
- A schema or validation mismatch failing a subset of assignments repeatedly
  (`schema`, concentrated on `create` or `update`).

The diagnostics above were built to separate these, not because any one of them
has been established. Do not claim a root cause from aggregate counts.

## What still needs a person

1. **A redacted diagnostic sample.** The breakdown identifying the failure has
   to come from an affected installation, supplied voluntarily: the popup's sync
   log with debug mode on, or the `sync_error_stats.lastSyncDiagnostics` object.
   No sampling of user data happens without that.
2. **GA registration.** `item_outcome` and `item_error_category` are
   event-scoped custom dimensions and need registering in the property before
   they populate; historical events will show `(not set)`. Report configuration
   is issue #71.
3. **The remediation.** Once the category is known, the fix likely belongs to an
   existing issue — #60 (circuit breaker, so a durably broken endpoint is not
   retried once per assignment) or #54 (Canvas transient retries) — rather than
   to a new mechanism. If it belongs to neither, open a targeted issue then.
