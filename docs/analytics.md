# Extension analytics

[Issue #65](https://github.com/KyleOrtzow1/CanvasNotionSync/issues/65) uses direct
GA4 Measurement Protocol requests from the service worker. Analytics defaults to
on for new installations and upgrades; a saved opt-out always wins. The popup
disclosure and toggle are visible above the sync controls for every user.

## Configuration and release

1. Create separate development and production **GA4 properties**, each with a
   **Web** stream and Measurement Protocol API secret. Use the store listing URL
   as the website URL.
2. Disable Google Signals, advertising personalization, enhanced measurement,
   and unnecessary account data sharing. Do not link advertising accounts. Set
   event/user retention to **2 months**, with reset on new activity disabled.
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

The envelope contains a locally generated UUID `client_id` and advertising
consent fields set to `DENIED`. All events have `extension_version`. Only these
event parameters are accepted; unknown events, extra fields, invalid enum values,
and invalid numeric ranges drop the whole event. No free text is accepted.

| Event | Parameters | Meaning |
| --- | --- | --- |
| `extension_installed` | none | `onInstalled` reason `install` |
| `extension_updated` | none | Extension update; ignores Chrome updates |
| `analytics_enabled` | none | User explicitly turns analytics on |
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

There is no `data_cleared` event. Clear All Data first disables analytics, aborts
pending requests, removes identity/session/checkpoints, and removes other local
keys. It retains only `analyticsEnabled: false` so a restart cannot turn tracking
back on. Normal worker suspension does not clear local storage. Re-enabling
creates a fresh UUID. There is no replay of earlier events; local deletion and
opt-out do not delete analytics already received by Google.

## Sessions and interpretation

Popup openings, manual clicks, and committed edits start/refresh a 30-minute
session in `chrome.storage.session`. Related foreground events may carry its
numeric `session_id`. Background events neither create nor extend interactive
sessions; periodic events do not attach to an existing session. We do not invent
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

## Reporting setup

Register event-scoped dimensions for `source`, `outcome`, `category`, `reason`,
`setting`, `extension_version`; numeric metrics for `created`, `updated`,
`skipped`, `deleted`, `errors`, `duration_ms` (milliseconds). Mark `setup_completed`
as a key event. Create these explorations in the production property:

1. Setup: install → saved token → completed setup → completed sync with zero
   errors. Tests/preparation are optional steps, not required funnel stages.
   Existing upgrading installations form a separate cohort.
2. Reliability: terminal outcomes by source/version, partial-error completions,
   and mean duration. Denominator: terminal events actually received; display
   skipped reasons separately.
3. Usage: participating installation IDs with UI/manual-sync/settings events.
   These are installations, not people. Opt-out, reinstalls, and ID resets affect
   coverage and continuity.

## Validation

- Run `npm test`, `npm run test:integration-rate`, `npm run lint`,
  `npm run check:security`, `npm run check:version`, and `npm run build:zip`.
- Configure an unpacked development build with `GA4_DEBUG=true`; inspect every
  request shape in the worker's Network panel.
- Validate representative payloads with `/debug/mp/collect` and
  `ENFORCE_RECOMMENDATIONS`. Validation does not populate reports or prove the
  secret is valid. Then send normal `/mp/collect` events with `debug_mode: 1`
  and confirm their receipt in the development property's DebugView.
- Exercise install/update, popup, autosave, setup success/failure, all sync
  sources, empty results, partial errors, extraction errors, missing tabs,
  concurrent requests, and a failing/slow analytics connection.
- Turn analytics off; verify no subsequent GA requests on any path, including
  after worker restart or extension update. Repeat for Clear All Data. Requests
  already received by Google cannot be recalled by a local abort.
- Restore production configuration (`GA4_DEBUG=false`) before a release and
  verify GA property settings and store declarations separately.

References: [Chrome GA4 guide](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4),
[Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag),
[validation](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events).
