# Releasing

Cutting a release is one command and one tag. Everything after that — build,
lint, tests, security checks, upload, submission for review, GitHub Release —
runs in CI.

What CI does **not** do is change the store listing. Screenshots, the
description, promo tiles and privacy justifications have no API and are
uploaded by hand. See [What stays manual](#what-stays-manual).

---

## Cutting a release

```bash
npm run bump -- minor          # or patch / major / an explicit 1.4.2
```

That moves the version in `package.json`, `manifest.json`,
`package-lock.json` and `CHANGELOG.md` together, and opens a dated section in
the changelog for this version.

Then:

```bash
# 1. Fill in the CHANGELOG entry under the new version heading.
#    It becomes the GitHub Release notes verbatim, so write it for users.

git commit -am "Release v1.2.0"
git push

git tag -a v1.2.0 -m "v1.2.0"
git push origin v1.2.0
```

The tag push starts the release workflow. It will:

1. Run ESLint, the manifest security check, `npm audit`, and the full test suite.
2. Verify the tag, `package.json` and `manifest.json` all agree.
3. Build the zip with `npm run build:zip`.
4. Check with the store that this version is higher than what is live and that
   nothing else is pending.
5. Upload the package and submit it for review.
6. Create a GitHub Release with that zip attached and the changelog section as
   its notes.

Review takes anywhere from a few hours to a few days.

### Releasing after approval

The workflow submits with `STAGED_PUBLISH`, so an approved build **waits** —
it does not go live on its own. When review passes, open the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole) and press
**Publish** on the staged version.

That gap is deliberate: it means an approved build can still be held back if
something turns up between submitting and shipping, and nothing reaches users
without someone deciding it should.

To skip the gate for a particular release, run the publish step with
`--publish-immediately`, which goes live as soon as review passes.

---

## One-time setup

Done once, by someone with owner access to the store listing.

### 1. Enable the API

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (or pick an existing one).
2. Search for **Chrome Web Store API** and enable it.

### 2. Create the service account

1. **IAM & Admin → Service Accounts → Create service account.** No project
   roles are needed — its access comes from the Developer Dashboard, not from
   Cloud IAM.
2. On the new account, **Keys → Add key → Create new key → JSON**. Download it.
3. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   go to **Account** and add the service account's email address
   (`something@project.iam.gserviceaccount.com`) to grant it API access.

> **One per publisher.** The store allows a single service account per
> publisher account. If one is already attached for something else, either
> reuse it or switch this script to the OAuth client + refresh token flow —
> in which case note that refresh tokens expire after 7 days unless the OAuth
> consent screen is published out of "Testing" status.

The publishing account also needs 2-Step Verification enabled.

### 3. Add the credentials to GitHub

**Settings → Secrets and variables → Actions.**

| Name | Kind | Value |
| --- | --- | --- |
| `CWS_SERVICE_ACCOUNT_KEY` | Secret | The entire downloaded JSON key file, braces included |
| `CWS_PUBLISHER_ID` | Variable | Publisher ID, from the Developer Dashboard URL |
| `CWS_EXTENSION_ID` | Variable | Extension ID, the long string in the store listing URL |

The two IDs are variables rather than secrets on purpose — neither is
sensitive (the extension ID is public in the store URL), and having them
readable in the workflow log is worth more than hiding them, because a wrong
ID is otherwise a 403 with nothing to look at.

### 4. Verify it works

Before trusting it with a real release, check the credentials without
uploading anything:

```bash
export CWS_SERVICE_ACCOUNT_KEY="$(cat ~/Downloads/key.json)"
export CWS_PUBLISHER_ID=...
export CWS_EXTENSION_ID=...

npm run publish:store -- --dry-run
```

A dry run authenticates, reads the item's current state, runs every preflight
check, and stops. It uploads nothing and changes nothing, so it is safe to run
as often as you like.

---

## What stays manual

The Chrome Web Store API can upload and publish a **package**. It has no
endpoints for the **listing**, so these are still done by hand in the
Developer Dashboard:

- Screenshots and promo tiles
- The detailed description (`store/description.txt`)
- Category, language, and pricing
- Privacy practices and permission justifications
- Visibility (public / unlisted / private)
- Creating the item in the first place

**When the popup UI changes, the screenshots go stale.** They are generated
from `popup.html` itself — see [`store/README.md`](store/README.md) — so
regenerate and re-upload them:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run assets:store
```

Nothing in the release pipeline checks this, and nothing can: the store gives
no way to read back what the current screenshots show.

---

## When something goes wrong

**Preflight says a submission is already under review.**
The store accepts one submission at a time per item. Wait for it to finish, or
cancel it in the Developer Dashboard.

**Preflight says an approved build is already staged.**
A previous release was approved and never released. Publish or discard it in
the dashboard, then re-run.

**Preflight says the version is already live or lower.**
The version was not bumped, or the tag points at an old commit. `npm run bump`
and tag again.

**The publish step fails with 403.**
Either the service account was never added under **Account** in the Developer
Dashboard, or `CWS_PUBLISHER_ID` is wrong. The log shows the ID it used.

**The publish step fails with `invalid_grant`.**
The key is wrong or revoked. Re-download it and update the secret.

**The store returned warnings and the release stopped.**
That is the default (`blockOnWarnings`). Read the warnings in the log. If they
are acceptable, re-run the workflow from the Actions tab, or run
`npm run publish:store -- --no-block-on-warnings` locally.

**A release failed after the package uploaded.**
The draft is already in place at the store, so building again is wasted work.
Re-run the workflow from the Actions tab — preflight will tell you where
things actually stand before anything else happens.

---

## The pieces

| File | What it does |
| --- | --- |
| `scripts/bump-version.mjs` | Moves the version in all four files at once |
| `scripts/build-zip.mjs` | Builds the store package from an explicit file list |
| `scripts/publish-store.mjs` | Talks to the Chrome Web Store API v2 |
| `.github/scripts/check-version-sync.cjs` | Fails CI when versions drift |
| `.github/scripts/changelog-section.cjs` | Pulls one version's notes out of the changelog |
| `.github/workflows/release.yml` | Ties it together on a tag push |

`publish-store.mjs` uses the **v2** API and no dependencies. Both are
deliberate: the v1 API stops working on **15 October 2026**, and most
published npm helpers and GitHub Actions for this still speak v1.
