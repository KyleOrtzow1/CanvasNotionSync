# Implementation notes

Design decisions that span both APIs and aren't obvious from any single source
file, plus the feature backlog that isn't yet concrete enough to be an issue.

For API reference, go to the source rather than a copy kept here:

- **Canvas LMS REST API** — https://canvas.instructure.com/doc/api/
  (live explorer at `/doc/api/live` on any Canvas instance)
- **Notion API** — https://developers.notion.com/reference/intro
  ([changelog](https://developers.notion.com/page/changelog),
  [2025-09-03 upgrade guide](https://developers.notion.com/docs/upgrade-guide-2025-09-03))

---

## Rate limiting

Canvas and Notion throttle differently, so the two limiters share no code.

**Canvas** is a cost-based leaky bucket: 700-unit capacity leaking 10 units per
second, per access token. Requests carry an `X-Request-Cost` and the response
reports `X-Rate-Limit-Remaining`, so `CanvasRateLimiter` starts optimistic
(full bucket, cost estimate of 2) and corrects itself from headers after the
first response. Exhaustion returns **403, not 429** — a 403 from Canvas is
ambiguous between "rate limited" and "not authorized", and the limiter
distinguishes them by body text.

**Notion** publishes an average of ~3 requests/second with short bursts
tolerated. `NotionRateLimiter` enforces both: 5 requests in any 1-second window
and 30 in any 10-second window, over a sliding timestamp list.

Neither limiter knows about the other. A sync is Canvas-heavy up front and
Notion-heavy afterwards, so they rarely contend in practice.

## The Notion schema

`src/utils/notion-database-template.js` is the single source of truth for the
columns sync writes, and `planAssignmentSchemaUpdate()` reconciles a database
the user built by hand against it. Two constraints drive that code:

- Notion allows exactly **one title property** per database, so setup *renames*
  whatever title column exists rather than adding `Assignment Name`. The rename
  is keyed by property ID, because freeing up a name may collide with a column
  being added under that same name.
- A column that exists with the **wrong type** is reported as a conflict, never
  retyped. Retyping discards the user's data, and Notion cannot create some
  types (a `status` column among them) through the API at all.

`Canvas ID` is stored as `rich_text`, not as a number. It is the deduplication
key: every sync queries Notion for a live page whose `Canvas ID` equals the
incoming one, and reads it back with `extractCanvasIdFromProperty()`. Keeping
it textual means the value written and the value compared are the same string,
with no numeric coercion in between.

## Status preservation

Canvas is authoritative for assignment data but *not* for status. Users move
assignments forward manually in Notion, and a sync must not undo that.

`STATUS_RANK` orders the states and `resolvePreservedStatus()` keeps whichever
is further along, with two wrinkles worth remembering:

- `In Progress` is manual-only — Canvas never emits it — so it sits above
  `Not Started` and survives any sync that would otherwise reset it.
- `Late` ranks equal to `Not Started`: it is a deadline state, not progress.

Reaching `Graded`, `Submitted`, or `Pending Review` also ticks the `Checkbox`
column. That mirrors a Notion database automation, which the template cannot
create itself — Notion exposes no automations endpoint.

## Storage

Everything lives in `chrome.storage.local` (10 MB quota). Credentials are
AES-GCM encrypted before they are written; the assignment cache holds a 30-day
TTL with LRU eviction and field-level diffing so an unchanged assignment costs
no Notion write. `StorageMonitor` watches quota and prunes the cache before it
fills — a full quota fails writes silently, which surfaces as a sync that
appears to succeed and changes nothing.

---

## Feature backlog

Ideas, not commitments. Anything here that becomes concrete should graduate to
a GitHub issue.

### Canvas-side

- Sync calendar events, not just assignments (course and personal events)
- Module structure and completion progress
- Quizzes as assignments, with attempt info and scores
- Graded discussions as assignments; unread counts
- Richer submission detail: late / missing / excused, submission comments
- Canvas planner items, with two-way sync to planner notes
- Course announcements feed
- Grade analytics: current course grade, impact of upcoming work
- Rubric criteria and ratings
- Assignment bucket filters (overdue, upcoming, ungraded)
- Canvas Live Events webhooks to replace polling

### Notion-side

- Sync assignment descriptions as real blocks, preserving Canvas formatting
- Bidirectional sync: push Notion property edits back to Canvas
- Formula and rollup properties for grade calculation and course totals
- Sync Canvas comments and instructor feedback as Notion comments
- Multi-database support: per-course databases, or per assignment type
- Attachments: Canvas files and submissions linked into Notion
- People property for group assignments
- Page icons and covers keyed to assignment type or status
- Prebuilt views: calendar by due date, board by status, timeline by semester

### Cross-cutting

- Batch page creation and updates
- Cache the Notion database schema between syncs
- Sync conflict resolution when both sides changed
- Offline queueing of sync operations
