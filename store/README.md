# Chrome Web Store listing assets

Everything the store listing needs, and the script that produces it.

| File | Where it goes |
| --- | --- |
| `description.txt` | Listing "Detailed description" |
| `screenshots/*.png` | Screenshots (1280x800, up to 5) |
| `promo/small-tile-440x280.png` | Small promo tile |
| `promo/marquee-1400x560.png` | Marquee promo tile (optional) |

## Regenerating the images

The script drives a real browser, so it needs Playwright. Playwright is
deliberately **not** a devDependency — CI runs `npm ci` on three jobs and the
package downloads a browser on install, which is a lot of machinery for
something run by hand when the popup changes. Install it for the run:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run assets:store
```

The images are **generated from `popup.html` itself**, rendered in Chromium
behind a stubbed `chrome` API with fictional sync data. Nothing is drawn by
hand, so a screenshot cannot quietly disagree with the UI it depicts — which is
what happened to the previous set: they were pasted in as PNGs and still showed
a required Canvas API token and a "Save Configuration" button months after both
were removed.

**Re-run this script whenever the popup changes**, and re-upload the images.

If you already have a Chromium, or the environment's browser predates the
installed Playwright build, point the script at it instead of downloading one:

```bash
CHROMIUM_PATH=/path/to/chrome npm run assets:store
```

Running the script without Playwright installed prints these instructions
rather than a stack trace.

## What each screenshot shows

| Screenshot | State |
| --- | --- |
| `screenshot-1-popup-main.png` | Main view after a successful sync |
| `screenshot-2-guided-setup.png` | Settings → Setup instructions, the three-step flow |
| `screenshot-3-notion-database.png` | The resulting Notion database (a mock of the schema `Set Up Database` creates) |
| `screenshot-4-sync-logs.png` | Sync log viewer |
| `screenshot-5-no-token.png` | Advanced, showing the Canvas token is optional |

Screenshot 3 is the one piece that is not a render of the extension — Notion
itself is not available to the script — so if the database schema changes, edit
`ROWS` and the header row in `scripts/generate-store-assets.mjs` to match.
