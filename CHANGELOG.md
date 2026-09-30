# Changelog

All notable changes to Canvas-Notion Assignment Sync are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are the ones published to the Chrome Web Store, and match the
`version` field in `manifest.json`.

Entries go under **Unreleased** as they land. `npm run bump` turns that
section into a released one, and the release workflow reads it back out as the
GitHub Release notes — so what is written here is what ships.

## [Unreleased]

## [1.3.1] - 2026-09-30

### Fixed

- Syncing from the popup, or the automatic sync every 30 minutes, no longer
  fails with "Failed to load Canvas integration" when Chrome has unloaded a
  Canvas tab to save memory. The sync used to pick the leftmost Canvas tab, even
  if it was unloaded. It now skips unloaded tabs and prefers the Canvas tab you
  are looking at. If one Canvas tab can't be reached, it tries the next. If
  every Canvas tab is unloaded, the popup now tells you to click one to reload
  it (#87).

## [1.3.0] - 2026-09-28

### Added

- A circuit breaker on the Canvas and Notion call paths. After five consecutive
  failures an endpoint is skipped for 30 seconds, then retried once to see if it
  recovered, so an outage fails fast instead of making every assignment pay the
  full retry ladder. Failures that mean the same thing for every request — an
  expired Canvas session, a Notion token that was revoked, a database no longer
  shared with the integration — pause that service straight away and stop the
  sync rather than repeating themselves once per assignment. The popup says
  which service is not responding, and state changes appear in the sync log
  (#60).
- Per-sync failure diagnostics: each sync now ends with a bounded summary of
  which stage failed and why, using fixed error categories only — no titles,
  IDs, URLs, or raw error text. It appears in the sync log, and distinguishes
  error-free completions from partial-error ones and from runs where every item
  failed. `sync_completed` gains two aggregate parameters, `item_outcome` and
  `item_error_category`; see `docs/sync-diagnostics.md` (#72).
- Debug Mode syncs end with a per-endpoint request timing summary for Canvas and
  Notion: call count, total, average, and slowest duration per endpoint, with
  rate-limiter waiting time reported separately from time spent on requests.
  Endpoints are grouped by shape, so no course, assignment, or page IDs are
  logged (#61).
- The popup checks an optional Canvas access token's format as you type, and
  says what is wrong with one that could never work — a truncated copy-paste,
  say — instead of failing later with the same error an expired token gives.
  The help text now describes what a Canvas token looks like (#59).
- The sync log warns when a Status or Course value being written is not an
  option in your Notion database, so a renamed status or course no longer grows
  the option list without anyone noticing. The value is still written (#56).

### Changed

- Automatic syncs only show a notification when something was created or
  updated, with shorter wording. Manual syncs still confirm, and partial
  failures are still reported (#64).
- Fewer requests per sync: the Notion database layout is read once and reused
  for an hour (re-running **Set Up Database** refreshes it), and identical
  Canvas requests made at the same time share one response (#56, #58).
- Analytics events carry the time they were recorded, so setup is always
  reported ahead of the sync that confirmed it (#70).
- Analytics retention is now 14 months, and new activity extends it for a
  returning installation. The privacy policy has been updated to match.

### Fixed

- Canvas 5xx responses and dropped connections retry with exponential backoff
  instead of failing the assignment outright. Bounded to two retries, so a
  Canvas outage still fails quickly; 4xx responses are unchanged and fail fast
  (#54).
- A sustained Notion rate limit could retry indefinitely. Retries are now
  capped with a bounded backoff that respects `Retry-After`, and retried
  requests count against the pacing limits (#69).

## [1.2.0] - 2026-09-10

### Added

- Opt-out GA4 tracking for setup, feature use, and sync reliability, with a
  visible toggle, strict payload allowlists, and direct requests. See
  `docs/analytics.md` for required configuration and disclosures (#65).
- Analytics regression tests for privacy, opt-out races, and sync entry points.
- Automated Chrome Web Store releases: a tagged commit builds, uploads and
  submits the extension for review via the Chrome Web Store API v2
  (`scripts/publish-store.mjs`, `.github/workflows/release.yml`).
- `npm run bump` moves the version in `package.json`, `manifest.json`,
  `package-lock.json` and this changelog together
  (`scripts/bump-version.mjs`).
- CI check that the `package.json` and `manifest.json` versions agree, and
  that a release tag matches them
  (`.github/scripts/check-version-sync.cjs`).
- `RELEASING.md`, covering the one-time store/service-account setup, the
  per-release runbook, and what remains a manual step.

### Fixed

- Normal service-worker suspension no longer clears credentials/preferences.
  Clear All Data retains the analytics-off preference.
- Canvas-page sync uses the worker's full sync path and overlap guard. Empty
  sync results clear the active progress indicator.

## [1.1.0]

Released before this changelog was started; see the git history for what
changed.
