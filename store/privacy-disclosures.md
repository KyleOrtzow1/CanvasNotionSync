# Analytics: store disclosure changes before release

Repository edits do not update the Chrome Web Store developer dashboard.

- Publish the revised `docs/privacy-policy.html` at the existing policy URL and
  use `store/description.txt` for the listing.
- Declare **User activity** for extension UI/setup/sync events and **Website
  content** for existing assignment functionality. Review the current form's
  authentication and identifier categories against existing data handling;
  retain all required declarations.
- Disclose the random persistent installation identifier under the applicable
  identifier/personal-information category in the current dashboard. Do not call
  the analytics anonymous just because it excludes names and email addresses.
- State the purpose: measuring this extension's setup completion, feature use,
  and sync reliability. Google Analytics receives event names, fixed categories,
  counts, durations, extension version, random installation/session IDs, and
  ordinary HTTPS transport metadata. It receives no academic content, tokens,
  database IDs, URLs, raw errors, or sync logs from the analytics payload.
- Disclose analytics as on by default for new installs and upgrades, with the
  always-visible popup toggle and an opt-out that persists across updates.
  Clear All Data disables analytics and retains the opt-out flag.
- Declare Google Analytics as a third-party recipient/processor. Do not claim
  that data goes only to Canvas and Notion. There is no sale, advertising, or
  unrelated profiling use in this implementation.
- Justify `https://www.google-analytics.com/*` for HTTPS Measurement Protocol
  requests from the worker. No script is injected on Google Analytics pages.
- Confirm production GA retention is 2 months with reset on new activity off.
  Aggregate reports may persist longer. Local clearing/opt-out does not erase
  data Google already received.

Check the current [Chrome Web Store requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
when completing the actual form. These are proposed declarations, not evidence
that the dashboard or GA property settings have been changed.
