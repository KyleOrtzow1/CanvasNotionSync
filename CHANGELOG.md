# Changelog

All notable changes to Canvas-Notion Assignment Sync are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are the ones published to the Chrome Web Store, and match the
`version` field in `manifest.json`.

Entries go under **Unreleased** as they land. `npm run bump` turns that
section into a released one, and the release workflow reads it back out as the
GitHub Release notes — so what is written here is what ships.

## [Unreleased]

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

### Fixed

- Canvas 5xx responses and dropped connections retry with exponential backoff
  instead of failing the assignment outright. Bounded to two retries, so a
  Canvas outage still fails quickly; 4xx responses are unchanged and fail fast
  (#54).

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
