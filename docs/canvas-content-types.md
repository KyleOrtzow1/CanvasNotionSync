# Syncing more Canvas content than assignments

Investigation for [#66](../../issues/66). Today sync writes one thing —
assignments — into one Notion database. Canvas exposes plenty more per course.
This is the written recommendation on which of it is worth syncing, in what
order, and what each one would cost.

Nothing here is implemented. The follow-up issues at the bottom are the
implementation work; this file is the reasoning behind their order.

---

## Recommendation

Build **announcements** first, **calendar events** second, and stop there until
either is actually in users' hands. Modules are worth doing only as a static
course outline, files are not worth doing at all right now, and grades stay out
of scope.

| # | Type | Verdict | Canvas requests per sync | Notion writes per sync |
| --- | --- | --- | --- | --- |
| 1 | Announcements | Build first | **1** for all courses | a handful of creates; never updated |
| 2 | Calendar events | Build second | **ceil(N/10)** | low, but needs a date window |
| 3 | Modules / pages | Later, outline only | **N**, up to N + M | one page per module |
| 4 | Files | Defer | **N** minimum, more with folders | high churn, low value per row |
| 5 | Grades / submissions | Out of scope | — | — |

*N = number of active courses, M = number of modules across them.*

The ordering is driven by Notion writes, not Canvas reads — see the cost model
below. Announcements win on both counts: one Canvas request covers every
course, and an announcement is written once and never touched again.

---

## What a sync costs today

The baseline everything else is measured against. For N active courses and A
assignments, of which C changed since the last sync:

**Canvas** (from `content-script.js`, running in the Canvas tab on the user's
session cookie):

* `1` — `GET /courses?enrollment_state=active&per_page=100`, cached 10 minutes
* `N` — `GET /courses/:id/assignments?per_page=100&include=submission`, cached
  5 minutes each; submissions ride along on this call rather than costing a
  request of their own

**Notion** (from `AssignmentSyncer`, at 3 requests/second sustained):

* `2` — `getDatabase` plus `getDataSource` (the `Checkbox` column probe)
* `ceil(A/100)` — `queryDataSource` pages building the Canvas ID truth map
* `2` per changed assignment — `getPage` for status preservation, then
  `updatePage`
* `1` per new assignment, `1` per deletion

So Canvas is roughly `N + 1` requests against a 700-unit bucket that refills at
10 units/second, while Notion is roughly `2C + 3` requests against a hard
3/second ceiling. **Notion is the bottleneck, and it is not close**: 60 changed
assignments is about 6 Canvas requests and about 120 Notion requests — 40
seconds of sync before any new content type is added.

That is the number to protect. A content type that adds one Canvas request is
free; a content type that adds a Notion row per course per week is not.

### Constants this arithmetic depends on

Kept honest by `test/canvas-content-types.test.js`, which fails if the code and
this table disagree.

| Constant | Value | Source |
| --- | --- | --- |
| `CanvasRateLimiter.bucketCapacity` | 700 | `src/api/canvas-rate-limiter.js` |
| `CanvasRateLimiter.leakRate` | 10 | `src/api/canvas-rate-limiter.js` |
| `NotionRateLimiter.maxRequestsPerSecond` | 5 | `src/api/notion-rate-limiter.js` |
| `NotionRateLimiter.averageRequestsPerSecond` | 3 | `src/api/notion-rate-limiter.js` |
| `AssignmentCacheManager.defaultTTL` | 2592000000 | `src/cache/assignment-cache-manager.js` |

---

## The candidates

### 1. Announcements — build first

`GET /api/v1/announcements` takes a repeated `context_codes[]` parameter
("List of context_codes to retrieve announcements for (for example,
`course_123`)"), so **one request covers every enrolled course**. No maximum
number of context codes is documented, unlike the calendar endpoint below. The
default window is "posted since 14 days ago" through "28 days from start_date",
which is close to the window worth syncing anyway; `active_only=true` drops
unpublished postings.

The alternative shape, `GET /courses/:id/discussion_topics?only_announcements=true`,
costs one request per course for the same data. Prefer the announcements
endpoint.

Announcements are also the easiest thing in Canvas to model: an announcement is
posted once, is rarely edited, and is never "due". Change detection reduces to
"have I seen this ID before", with no status ladder, no manual-edit
preservation, and no deletion policy worth arguing about — an announcement that
disappears from the window stays in Notion as history.

Shape: **Title** (title), **Course** (select), **Posted** (date), **Author**
(text), **Link** (url), **Canvas ID** (text), **Message** (text, sanitized
through the existing `sanitizeHTML`).

### 2. Calendar events — build second

`GET /api/v1/calendar_events` is the non-assignment due dates: exams, lecture
times, review sessions. Two constraints shape it:

* Context codes are **"Limited to 10 context codes, additional ones are
  ignored"** — so it is `ceil(N/10)` requests, not one. Still cheap.
* `type` defaults to `event`. It must stay that way: `type=assignment` returns
  the same assignments this extension already syncs, and pulling them in would
  duplicate every row.

The risk is volume, not cost. An institution that publishes recurring lecture
times as calendar events will produce a Notion row per meeting per week.
`start_date`/`end_date` must be set explicitly — a bounded forward window, not
`all_events=true` — and the row count should be capped before this ships.

Shape: **Title**, **Course**, **Start**, **End**, **Location**, **Link**,
**Canvas ID**.

### 3. Modules / pages — later, and only as an outline

`GET /courses/:id/modules` is one request per course. `include[]=items` is a
suggestion, not a guarantee: *"Canvas is free to omit 'items' for any
particular module if it deems them too numerous to return inline. Callers must
be prepared to use the List Module Items API if items are not returned."* So
the honest cost is `N` requests best case, `N + M` worst case, and the worst
case is the one that shows up for exactly the heavyweight courses a user most
wants an outline of.

Module items are also mostly pointers at things already synced (assignments) or
things not worth a Notion row (individual pages). A module sync is worth doing
as a **read-only course outline**, one Notion page per module with its items as
text, and is worth nothing as a row-per-item mirror. Low priority either way.

### 4. Files — defer

One request per course for `GET /courses/:id/files`, more if folders are walked.
Three problems, none fatal but together disqualifying for a first pass:

* **Links.** The `url` field on a Canvas File is a `/files/:id/download` URL
  carrying a verifier. The API documents no lifetime for it, and the historical
  `reset_verifier` endpoint means it is explicitly revocable. Store the
  permalink `/courses/:course_id/files/:id` instead, which resolves against the
  user's session like every other link this extension writes.
* **Churn.** Files are the one candidate that is regularly renamed, replaced and
  deleted, so this is the type that actually forces the archive-vs-leave-alone
  decision — and it forces it for the type with the least value per row.
* **Value.** A Notion row whose entire content is a filename and a link is worth
  less than the Canvas files page it points at.

Revisit if users ask for it. Metadata only in any case — never file contents.

### 5. Grades / submissions — out of scope

Submission state already rides along on the assignments call, and `Grade` is
already a synced column. A separate grades view is the most privacy-sensitive
thing on the list and the one with the least to add. Keep it out of this line of
work entirely.

---

## The six design questions

**1. One database or several?** Several — one per content type, each with its
own template module alongside `src/utils/notion-database-template.js`. The
assignments template is not overloadable: `planAssignmentSchemaUpdate()`
reconciles against a fixed property set and reports a wrong-typed column as a
conflict rather than retyping it, so adding announcement columns to the same
database would make every existing user's database "incomplete" at the next
setup run. Separate databases also keep the default view sorts meaningful —
announcements sorted by due date is nonsense.

**2. Setup flow.** `CredentialManager.storeCredentials(canvasToken, notionToken,
notionDatabaseId)` is positional and single-database, and `notionDatabaseId` is
read directly in `background-handlers.js` and `popup.js`. The migration is:
keep `notionDatabaseId` as the assignments database forever (no existing user's
setup changes), and add a separate `notionDatabaseIds` map keyed by content
type for the new ones. A missing key means the type is off. Creating the
databases from one parent page is possible — `POST /v1/databases` with a
`page_id` parent — but the extension has never called it: setup today patches a
database the *user* created, which is also what makes the Notion "Connections"
sharing step work. Creating databases automatically would need the parent page
shared with the integration first, so it is the same manual step moved, not
removed. Recommend keeping the existing pattern: the user creates each database
and pastes its URL, one row per enabled type.

**3. Opt-in per type.** Default off, every type, no exceptions. A checkbox per
type under Settings, and an absent database ID is itself the off switch, so an
existing install that upgrades syncs exactly what it synced before.

**4. Rate limits and cadence.** Announcements at one Canvas request per sync can
ride the existing 30-minute cadence without a second thought. Calendar events
at `ceil(N/10)` can too. Anything per-course-per-module (modules, files) should
run on a slower cadence — a separate alarm at a multiple of the sync interval —
so a heavyweight type cannot lengthen every assignment sync. The Notion side is
the real budget: each enabled type adds its own `queryDataSource` truth-map
pages plus a write per changed item, against the same 3 requests/second.

**5. Change detection.** `AssignmentCacheManager` generalizes: it is
`CacheManager` with an `assignment:`-prefixed key, a field list, and a 30-day
TTL. A sibling per type with its own prefix and field list reuses the LRU, the
persistence and the quota handling as they are. The one thing that does *not*
generalize is deletion: assignments archive in Notion when they vanish from an
active course, which is right for assignments and wrong for announcements
(history) and undecided for files. Deletion policy belongs to each type, not to
the shared cache.

**6. Notifications.** `notifySyncResult()` already suppresses a periodic sync
that changed nothing. New announcements are worth a notification and should
count as changes in that same summary — one notification per sync covering
everything that changed, not one per content type.

---

## What still needs a human

* **Whether to ship any of this.** The cost analysis says announcements are
  cheap; it does not say users want them. Worth asking before building.
* **Notion database setup burden.** Every enabled type is another database the
  user creates and shares with the integration. Two types is probably the
  practical ceiling for setup patience, which is the real argument for stopping
  after calendar events.
* **Chrome Web Store listing.** New content types change what the extension
  reads from Canvas, so the store description and `docs/privacy-policy.html`
  both need updating before release. No new permissions are required — every
  endpoint here is on the Canvas origin the content script already runs on.
* **A real Canvas account to measure against.** The request counts above are
  derived from the endpoint documentation and this repo's code, not from a live
  run. Announcement and calendar-event *volumes* per course are the numbers
  worth checking before committing to the row counts.

## Follow-up issues to file

1. **Sync Canvas announcements into a second Notion database** — the
   announcements endpoint with repeated `context_codes[]`, an
   `AnnouncementCacheManager`, an announcements database template, and an
   opt-in checkbox defaulting to off.
2. **Add a per-content-type database configuration** — the `notionDatabaseIds`
   map, its migration from the single `notionDatabaseId`, and the popup rows.
   Prerequisite for (1); worth splitting only if (1) gets large.
3. **Sync non-assignment calendar events** — after (1) ships and only with a
   bounded date window and a row cap.
