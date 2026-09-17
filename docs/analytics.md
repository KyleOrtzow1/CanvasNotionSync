# Extension analytics

[Issue #65](https://github.com/KyleOrtzow1/CanvasNotionSync/issues/65) uses direct
GA4 Measurement Protocol requests from the service worker. Analytics defaults to
on for new installations and upgrades; a saved opt-out always wins. The popup
disclosure and toggle are under Settings → Advanced.

## Configuration and release

1. Create separate development and production **GA4 properties**, each with a
   **Web** stream and Measurement Protocol API secret. Use the store listing URL
   as the website URL.
2. Disable Google Signals, advertising personalization, enhanced measurement,
   and unnecessary account data sharing. Do not link advertising accounts. Set
   event/user retention to **14 months**, with reset on new user activity enabled.
   Confirm these settings before publishing the privacy policy.
3. Set `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` in your shell environment, then
   run `npm run configure:analytics`. This writes `src/utils/analytics-config.js`.
   For local DebugView checks, also set `GA4_DEBUG=true`, use the development
   property, and reload the unpacked extension.
4. Set the production GitHub Actions variable `GA4_MEASUREMENT_ID` and secret
   `GA4_API_SECRET`. The release workflow generates production configuration
   before building the ZIP and fails if either is absent or malformed.
5. Do not commit generated configuration. The checked-in values are empty:
   source checkouts and CI make no analytics requests until configured. Values
   in the shipped ZIP, including the write secret, are extractable even if their
   input was a GitHub secret. Direct requests intentionally accept forged-event
   risk. If abused, rotate the stream secret and ship a newly configured build;
   old builds using the revoked secret will stop reporting.
6. Publish `docs/privacy-policy.html` and update the store description and Privacy
   practices declarations using `store/privacy-disclosures.md` before releasing.
   Review any upgrade permission prompt caused by the added GA host access.

CI does not verify production GA settings, store declarations, or live event
receipt. They are separate release prerequisites.

## Event contract

The envelope contains a locally generated random numeric-pair `client_id` and advertising
consent fields set to `DENIED`. All events have `extension_version`. Only these
event parameters are accepted; unknown events, extra fields, invalid enum values,
and invalid numeric ranges drop the whole event. No free text is accepted.

| Event | Parameters | Meaning |
| --- | --- | --- |
| `extension_installed` | none | `onInstalled` reason `install` |
| `extension_updated` | none | Extension update; ignores Chrome updates |
| `analytics_enabled` | none | User explicitly turns analytics on |
| `analytics_disabled` | none | One final notification when the user explicitly turns analytics off |
| `notion_token_saved` | none | First nonempty saved token per analytics identity; does not imply validity |
| `notion_connection_tested` | `outcome`, `category` | Explicit connection test result |
| `database_prepared` | `outcome`, `category` | Preparing the user's existing database, not creating a new one |
| `setup_completed` | none | Saved credentials match successful Notion verification or an error-free nonempty sync; once per analytics identity |
| `sync_started` | `source` | Accepted sync attempt; excludes periodic preflight skips |
| `sync_completed` | `source`, `created`, `updated`, `skipped`, `deleted`, `errors`, `duration_ms` | Completion, including zero-work and partial-error outcomes |
| `sync_failed` | `source`, `category`, `duration_ms` | Fatal failure, including Canvas extraction |
| `auto_sync_skipped` | `reason` | At most once per reason per 24 hours; not the exact number of skipped ticks |
| `popup_opened` | none | Popup opened |
| `manual_sync_clicked` | `source` | Explicit popup/Canvas-page request; excludes setup-triggered sync |
| `settings_changed` | `setting` | Committed input edit or debug-mode change; never its value |

- `source`: `popup`, `canvas_page`, `periodic`, `setup`. Clicks allow only the
  first two. The worker derives the source from the sender; only the popup may
  request `setup`.
- `outcome`: `success`, `failure`.
- `category`: `authentication`, `permission`, `not_found`, `rate_limit`, `server`,
  `network`, `configuration`, `no_canvas_tab`, `in_progress`, `integration`,
  `schema`, `unknown`. For successful outcomes, `unknown` does not indicate an error.
- `reason`: `configuration`, `no_canvas_tab`, `in_progress`.
- `setting`: `canvas_token`, `notion_token`, `notion_database`, `debug_mode`.
- Counts: integers from 0 to 10,000,000. Duration: milliseconds, capped at one day.

The Canvas-page button now measures extraction + Notion work through the same
worker path as popup/periodic sync. The legacy `SYNC_ASSIGNMENTS` message measures
only processing of supplied assignments, since extraction predates that message.

There is no `data_cleared` event. Clear All Data aborts pending analytics work,
removes credentials, caches, configuration, analytics sessions/checkpoints,
and preserves the installation ID and current analytics preference. If on
(including the default), future events reuse the ID; if off, tracking stays off.
Normal worker suspension does not clear local storage.

An explicit UI opt-out saves the off preference, invalidates queued work and
aborts pending requests, then attempts one final `analytics_disabled` event using
the previous installation ID (or a newly saved ID if none existed). It includes
only the standard version/debug metadata, without session or content fields.
Delivery is best effort with a three-second timeout and no retry. Other events
are blocked immediately; repeating an already saved opt-out sends nothing.
Opt-out retains the installation ID locally, clears the active session and activity checkpoints, and collects nothing while off. Re-enabling reuses the ID with a new session, linking future activity with earlier activity; no opted-out events are collected or replayed. Clear All Data also retains the installation ID. Local deletion and opt-out do not delete
analytics already received by Google.

## Sessions and interpretation

Popup openings, manual clicks, and committed edits start/refresh a 30-minute
session in `chrome.storage.session`. Related foreground events may carry its
numeric `session_id`. Background events neither create nor extend interactive
sessions; periodic events do not attach to an existing session. Production builds do not invent
`engagement_time_msec`: sync runtime is not user engagement. Use custom event
reports, not default engaged-user/time metrics or Realtime active-user counts.

Milestones and skip throttles survive worker restarts. Delivery is best effort:
no offline queue/retry, a 3-second request timeout, at most 32 pending events and
60 requests per minute per worker. Network loss, worker termination, opt-out,
blocking Google, or rate caps can lose events. Started/terminal counts need not
reconcile. Do not infer exact failures by subtracting completions from starts.

Never pass credentials, academic content, complete result objects, raw errors,
or URLs to `track()`. UI telemetry and preference messages require the exact
extension popup sender; UI messages cannot report backend outcomes. Requests
omit cookies/referrers and reject redirects. Opt-out is enforced by preventing
requests locally, separately from the explicit advertising-consent denial.


Debug builds add `debug_mode: 1` and a synthetic `engagement_time_msec: 100`
to satisfy [Google's DebugView verification instructions](https://developers.google.com/analytics/devguides/collection/protocol/ga4/verify-implementation).
This is a development-only diagnostic value, not measured user engagement.
Production builds omit both fields. Always use a separate development property.
A validation pass or HTTP 204 alone does not prove ingestion. Check Realtime's
Event count by Event name separately from active-user counts and DebugView.

## Reporting setup

This is an event-only Measurement Protocol implementation. Production sends no
`engagement_time_msec`, no `session_start`, and no `user_engagement`, so GA
derives **zero active users** from it. `Active users` counts users with an
engaged session, and nothing here produces one. Every report below therefore
uses **`Total users`**, which counts distinct `client_id` values regardless of
engagement. Any report, exploration, or Realtime card whose metric is
`Active users` renders empty by construction, not because events are missing.
Do not add `engagement_time_msec` to production builds to make GA's default
metrics populate: sync runtime is not user engagement, and reporting it as such
would be a fabricated number in every engagement metric the property exposes.
The synthetic value stays a debug-build DebugView aid.

`Total users` means **observed installation identities**, not people: one Chrome
profile that has not opted out. One person with two profiles counts twice; a
reinstall that regenerates the ID counts twice; an opted-out installation counts
zero. Clear All Data keeps the ID, so it does not split an identity.

### Custom definitions to register

Registered under Admin → Custom definitions, event-scoped. Names must match the
payload parameters exactly; `test/analytics-reporting.test.js` checks this table
against the event schema in `src/utils/analytics.js`.

| Parameter | Registered as | Values |
| --- | --- | --- |
| `source` | Dimension | `popup`, `canvas_page`, `periodic`, `setup` |
| `outcome` | Dimension | `success`, `failure` |
| `category` | Dimension | `authentication`, `permission`, `not_found`, `rate_limit`, `server`, `network`, `configuration`, `no_canvas_tab`, `in_progress`, `integration`, `schema`, `unknown` |
| `reason` | Dimension | `no_canvas_tab`, `in_progress`, `configuration` |
| `setting` | Dimension | `canvas_token`, `notion_token`, `notion_database`, `debug_mode` |
| `extension_version` | Dimension | Manifest version; present on every event |
| `created` | Metric | Standard unit |
| `updated` | Metric | Standard unit |
| `skipped` | Metric | Standard unit |
| `deleted` | Metric | Standard unit |
| `errors` | Metric | Standard unit |
| `duration_ms` | Metric | Milliseconds |

Mark `setup_completed` as a key event. Custom definitions are not retroactive:
they apply to data received after registration, and GA reports earlier events as
`(not set)` or zero. That is a registration artifact, not evidence that the
payload omitted the field.

### 1. Usage — installations

Free-form exploration, rows `Event name`, values **`Total users` and
`Event count`**. Event count alone answers "how much did this happen", not "how
many installations did it". Both columns are needed, and the `Total users`
column must be labelled *observed installation identities*, not users or people.

Break down by `extension_version` to separate versions, and restrict to the UI
events (`popup_opened`, `manual_sync_clicked`, `settings_changed`) for a
participating-installation view. Opt-out, reinstalls, and ID resets affect
coverage and continuity in both columns.

### 2. Onboarding — installation cohorts instead of a funnel

**Funnel explorations do not work against this property.** A funnel exploration
reports its steps with GA's engagement-based user metric, which is structurally
zero here, so the visualization renders no data even while the builder's
matching-users summary counts a nonzero cohort — the discrepancy observed on
September 14, 2026 (empty funnel, 9 matching users for Aug 15 – Sep 13). Metric
compatibility is the leading explanation and is confirmed in the property, not
here; the check is in [What still needs a human](#what-still-needs-a-human).
Either way, treat funnel semantics as unsupported for this implementation rather
than as a broken report to fix.

The supported equivalent is a free-form exploration with `Total users` and four
**cumulative user-scoped segments**, applied as segment comparisons:

| Segment | Conditions (user scope, each adds to the previous) |
| --- | --- |
| 1. New installation | Event name = `extension_installed` |
| 2. Token saved | ...and event name = `notion_token_saved` |
| 3. Setup completed | ...and event name = `setup_completed` |
| 4. Error-free sync | ...and event name = `sync_completed` **and** `errors` = 0, with the condition group scoped to *within the same event* |

Each segment is a subset of the one before it, so `Total users` per segment is
monotonically decreasing and step-to-step ratios are defensible conversion
within the cohort. Upgrading installations are excluded automatically: they send
`extension_updated`, not `extension_installed`. Report them separately with a
fifth segment (`extension_updated` and not `extension_installed`) rather than
mixing them into the same denominator.

Two deliberate choices:

- **The conditions are not sequenced.** They ask whether an installation reached
  each stage, not whether it reached them in order. Milestone events fire once
  per identity, so ordering adds nothing to the counts today, and GA orders
  events by receipt — which [#70](../../issues/70) leaves nondeterministic for
  the sync that verifies setup. Once #70 lands, the same
  four conditions can be rebuilt as a sequence segment ("indirectly followed
  by") to measure ordered progression; until then a sequence would undercount
  step 4.
- **The `errors = 0` condition uses the registered metric.** If a numeric
  condition on a custom metric proves unusable in the segment builder, use the
  categorical completion field added by [#72](../../issues/72) instead. Do not
  substitute "any `sync_completed`": that counts partial-error syncs as
  successful setup.

An installation from before analytics shipped has no `extension_installed`
event and is absent from the cohort entirely. Because the segments are
cumulative, that undercounts step 1 rather than producing a step larger than
its predecessor.

### 3. Reliability — completions, failures, and skips

Four distinct populations. Keep them in separate rows; none of them is the
denominator of another.

| Population | Definition |
| --- | --- |
| Error-free completion | `sync_completed` with `errors` = 0 |
| Partial-error completion | `sync_completed` with `errors` > 0 |
| Fatal failure | `sync_failed`, broken down by `category` and `source` |
| Sampled preflight skip | `auto_sync_skipped`, at most once per reason per 24 hours |

Split the two completion rows with an Explore metric filter on `errors`, and
never label `sync_completed` as "successful syncs" — the event covers zero-work
and partial-error outcomes alike. `auto_sync_skipped` is throttled per reason
per identity, so it is a presence signal, not a count of skipped ticks; it must
stay out of any rate calculated over sync attempts.

GA sums `duration_ms`. Mean duration is that sum divided by the event count of
the same row; there is no average metric for a custom metric. The same holds
for `created`, `updated`, `skipped`, `deleted`, and `errors`.

### Arithmetic that does not hold

- **Installs ÷ setup completions is not a conversion rate.** The standard
  reports' 23 installation events and 15 `setup_completed` events cover
  different cohorts over the same window: `setup_completed` fires once per
  identity and can come from an installation that predates the window, and an
  installation in the window may complete setup after it. Use the cumulative
  segments above.
- **Summed `errors` is not a count of failed syncs.** 7,375 item-error
  occurrences across 125 completions is a sum of a per-event metric. Occurrences,
  affected syncs, and affected installation identities are three different
  numbers; [#72](../../issues/72) is what makes the second one reportable.
- **Event count is not installations.** Read it beside `Total users`, never
  instead of it.
- **Started and terminal events do not reconcile.** Delivery is best effort, so
  `sync_started` minus `sync_completed` is not a failure count.
- **Zero active users and zero engagement are expected**, in both Realtime and
  the standard reports, and say nothing about whether events arrived.

## Production reporting as inspected September 14, 2026

Property `553519881` uses web stream `G-4MYV1NB8TW`. Event and user retention
are 14 months, with reset on new user activity enabled. Ads personalization is
disabled in all regions. The twelve custom definitions above are registered, and
`setup_completed` is marked as a key event. Use the development property for
tests; the production internal-traffic filter remains in Testing and does not
exclude developer activity.

The saved **Extension usage and reliability** exploration needs three
corrections, none of which can be made from this repository:

1. **Usage – installations** carries only `Event count` in Values. Add
   `Total users` and label it as observed installation identities.
2. **Setup – new installations** is a funnel exploration and renders no data.
   Replace it with the cumulative-segment table in *Onboarding* above; keep the
   funnel tab only if the diagnosis below fails.
3. **Reliability** does not separate error-free from partial-error completions.
   Apply the `errors` split and keep fatal failures and sampled skips in their
   own rows.

The local privacy policy reflects the retention preference above. Publish that
updated policy through the normal release process.

### What still needs a human

Nothing in this section is code. All of it needs someone with access to GA
property `553519881` and the development property:

- **Apply the three corrections** in the saved exploration.
- **Confirm the funnel diagnosis before discarding the funnel tab.** Open its
  builder, confirm the metric is GA's engagement-based user metric, then run the
  step-4 conditions as a free-form `Total users` table over the identical date
  range. A nonzero table beside an empty funnel confirms metric incompatibility.
  A nonzero funnel would falsify the diagnosis; the segment table remains the
  recommended report either way.
- **Validate on the development property**, not production: a fresh profile
  installing, saving a token, completing setup, and running one error-free
  nonempty sync must appear in all four cumulative segments, and a sync with at
  least one item error must appear in segments 1–3 only.
- **Re-check after [#70](../../issues/70)** to switch the onboarding segments to
  ordered sequence conditions, and after [#72](../../issues/72) to move the
  reliability split onto its categorical fields.

## Validation

- Run `npm test`, `npm run test:integration-rate`, `npm run lint`,
  `npm run check:security`, `npm run check:version`, and `npm run build:zip`.
- Configure an unpacked development build with `GA4_DEBUG=true`; inspect every
  request shape in the worker's Network panel.
- Validate representative payloads with `/debug/mp/collect` and
  `ENFORCE_RECOMMENDATIONS`. Validation does not populate reports or prove the
  secret is valid. Then send normal `/mp/collect` events with `debug_mode: 1`
  and positive `engagement_time_msec`, then confirm receipt in the development property's DebugView.
- Exercise install/update, popup, autosave, setup success/failure, all sync
  sources, empty results, partial errors, extraction errors, missing tabs,
  concurrent requests, and a failing/slow analytics connection.
- Turn analytics off; verify one final `analytics_disabled` attempt and no other subsequent GA requests, including
  after worker restart or extension update. Test Clear All Data with analytics on and off: the preference and installation ID must stay unchanged. Requests
  already received by Google cannot be recalled by a local abort.
- Restore production configuration (`GA4_DEBUG=false`) before a release and
  verify GA property settings and store declarations separately.

References: [Chrome GA4 guide](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4),
[Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag),
[validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events).
