#!/usr/bin/env node
/**
 * Regenerate the Chrome Web Store listing images from the real extension UI.
 *
 * The previous screenshots were committed as opaque PNGs, so they silently went
 * stale as the popup changed (they still showed "Save Configuration" and a
 * required Canvas token, both long gone). This script renders popup.html itself
 * in Chromium behind a stubbed `chrome` API, so a screenshot can never drift
 * from the UI it depicts: re-run it after a UI change.
 *
 * Usage: node scripts/generate-store-assets.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, 'store', 'screenshots');
const PROMO = join(ROOT, 'store', 'promo');

// Chrome Web Store accepts screenshots at exactly 1280x800 or 640x400.
const W = 1280;
const H = 800;

// popup.html is 400px of content plus 20px of body padding either side.
const POPUP_W = 440;

// ---------------------------------------------------------------------------
// Mock extension state
//
// Realistic-but-fictional data. No real tokens, course names, or database IDs.
// ---------------------------------------------------------------------------
const DB_ID = 'a1b2c3d4e5f61a2b3c4d5e6f1a2b3c4d';
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const STATE = {
  credentials: {
    canvasToken: '',
    notionToken: 'ntn_' + 'x'.repeat(42),
    notionDatabaseId: DB_ID,
    lastSync: minsAgo(2)
  },
  storage: {
    preparedDatabaseId: DB_ID,
    debugMode: false,
    sync_error_stats: null
  },
  quota: {
    success: true,
    quota: {
      formattedUsed: '624 KB',
      formattedQuota: '5 MB',
      percentUsed: 12.2,
      status: 'ok'
    }
  },
  logs: {
    success: true,
    logs: [
      { level: 'info', timestamp: minsAgo(2), message: 'Sync complete — 47 assignments across 6 courses' },
      { level: 'info', timestamp: minsAgo(2), message: 'Notion: 3 updated, 1 created, 43 unchanged' },
      { level: 'info', timestamp: minsAgo(2), message: 'BIOL 210: grade posted for "Lab Report 4" (92/100)' },
      { level: 'info', timestamp: minsAgo(2), message: 'CS 340: "Project Milestone 2" marked Submitted' },
      { level: 'warning', timestamp: minsAgo(32), message: 'HIST 105: 1 assignment has no due date' },
      { level: 'info', timestamp: minsAgo(32), message: 'Sync complete — 46 assignments across 6 courses' },
      { level: 'info', timestamp: minsAgo(62), message: 'Archived "Quiz 1" — removed from Canvas' },
      { level: 'info', timestamp: minsAgo(62), message: 'Sync complete — 47 assignments across 6 courses' }
    ]
  }
};

/** Injected before any page script: a chrome API surface popup.js can boot on. */
function makeChromeStub(state) {
  return `(() => {
    const STATE = ${JSON.stringify(state)};
    const store = Object.assign({}, STATE.storage);
    globalThis.chrome = {
      runtime: {
        id: 'store-asset-render',
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage: async (msg) => {
          switch (msg && msg.action) {
            case 'GET_CREDENTIALS':   return STATE.credentials;
            case 'GET_STORAGE_QUOTA': return STATE.quota;
            case 'GET_SYNC_LOGS':     return { success: true, logs: STATE.logs.logs.slice(0, msg.limit || 20) };
            default:                  return { success: true };
          }
        }
      },
      storage: {
        onChanged: { addListener() {} },
        local: {
          get: async (keys) => {
            if (typeof keys === 'string') return { [keys]: store[keys] };
            if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, store[k]]));
            return Object.assign({}, store);
          },
          set: async (obj) => { Object.assign(store, obj); },
          remove: async (k) => { delete store[k]; }
        }
      },
      tabs: { query: async () => [], sendMessage: async () => ({ success: true }) },
      alarms: { create() {}, clear() {} },
      notifications: { create() {} }
    };
  })();`;
}

// ---------------------------------------------------------------------------
// Presentation frame
//
// The popup is 380px wide; dropped raw into a 1280x800 canvas it reads as a
// stamp on an empty field (the old screenshots did exactly that). Scale it up
// with a CSS transform — text re-rasterizes at the larger size, so it stays
// crisp — and pair it with a caption explaining what is on screen.
// ---------------------------------------------------------------------------
function frameHtml({ headline, sub }) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    display: flex; align-items: center; justify-content: center; gap: 56px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #1b5e20 0%, #2e7d32 55%, #43a047 100%);
    position: relative;
  }
  /* Subtle depth so the flat gradient doesn't band on the store page. */
  body::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 78% 22%, rgba(255,255,255,.16), transparent 55%);
  }
  .copy { width: 430px; flex: none; color: #fff; z-index: 1; }
  .copy h2 {
    margin: 0 0 18px; font-size: 42px; line-height: 1.12; font-weight: 700;
    letter-spacing: -0.5px;
  }
  .copy p { margin: 0; font-size: 19px; line-height: 1.5; color: rgba(255,255,255,.88); }
  /* A transform does not change the layout box, so the stage is sized to the
     scaled dimensions by hand; otherwise flex lays the popup out at 380px and
     the enlarged render overflows the canvas and collides with the copy. */
  .stage { z-index: 1; }
  .device {
    width: ${POPUP_W}px;
    transform-origin: top left;
    border-radius: 12px; overflow: hidden; background: #fff;
    box-shadow: 0 24px 70px rgba(0,0,0,.34), 0 3px 10px rgba(0,0,0,.2);
  }
  iframe { display: block; border: 0; width: ${POPUP_W}px; }
</style>
<div class="copy">
  <h2>${headline}</h2>
  <p>${sub}</p>
</div>
<div class="stage"><div class="device"><iframe id="ui" src="popup.html"></iframe></div></div>`;
}

/**
 * Render one popup screenshot.
 * `drive` runs inside the iframe once popup.js has booted, to put the UI into
 * the state being shown (open Settings, expand logs, ...).
 */
async function popupShot(browser, { file, headline, sub, drive, focus }) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.addInitScript(makeChromeStub(STATE));

  // The frame has to live beside popup.html and be reached over file:// itself:
  // an about:blank page (what setContent leaves behind) cannot load a file://
  // iframe, and the load event simply never fires.
  const framePath = join(ROOT, `.store-frame-${file}.html`);
  await writeFile(framePath, frameHtml({ headline, sub }));
  try {
    await page.goto(pathToFileURL(framePath).href);
    await page.waitForFunction(() => {
      const f = document.getElementById('ui');
      return f && f.contentDocument && f.contentDocument.readyState === 'complete';
    }, null, { timeout: 20000 });

    // popup.js boots from DOMContentLoaded and then awaits several async
    // messages before the UI settles; give those microtasks a beat to land.
    await page.waitForTimeout(600);

    if (drive) {
      await page.evaluate(drive);
      await page.waitForTimeout(800);
    }

    // Size the stage from the rendered popup rather than hand-tuning a scale per
    // shot: its height depends on which sections the drive step opened, and a
    // transform contributes nothing to layout, so both the scale and the stage
    // box have to be computed after the fact.
    //
    // Fitting a tall panel entirely on screen would shrink it to illegibility,
    // so anything taller than the stage is shown scrolled to `focus` and
    // clipped instead — which is what the popup does in Chrome anyway.
    await page.evaluate(([popupW, maxW, maxH, focus]) => {
      const frame = document.getElementById('ui');
      const doc = frame.contentDocument;
      const scale = Math.min(maxW / popupW, 1.45);
      const full = Math.ceil(doc.body.scrollHeight);
      const visible = Math.min(full, Math.floor(maxH / scale));

      frame.style.height = visible + 'px';
      const device = frame.parentElement;
      device.style.height = visible + 'px';
      device.style.transform = `scale(${scale})`;
      const stage = device.parentElement;
      stage.style.width = Math.round(popupW * scale) + 'px';
      stage.style.height = Math.round(visible * scale) + 'px';

      if (focus && visible < full) {
        const el = doc.querySelector(focus);
        if (el) {
          const top = el.getBoundingClientRect().top + frame.contentWindow.scrollY;
          frame.contentWindow.scrollTo(0, Math.min(top, full - visible));
        }
      }
    }, [POPUP_W, 600, 700, focus || null]);
    await page.waitForTimeout(200);

    await page.screenshot({ path: join(SHOTS, file) });
  } finally {
    await page.close();
    await rm(framePath, { force: true });
  }
  console.log('  ✓ screenshots/' + file);
}

// ---------------------------------------------------------------------------
// The Notion side of the sync — a static mock of the database the extension
// builds, matching the schema "Set Up Database" actually creates.
// ---------------------------------------------------------------------------
const ROWS = [
  ['✓', 'BIOL 210', 'Lab Report 4', 'Graded', 'Aug 24, 2026', '92/100'],
  ['✓', 'CS 340', 'Project Milestone 2', 'Submitted', 'Aug 26, 2026', '—/50'],
  ['', 'CS 340', 'Problem Set 7', 'In Progress', 'Aug 31, 2026', '—/25'],
  ['', 'HIST 105', 'Response Paper: Reconstruction', 'Not Started', 'Sep 2, 2026', '—/30'],
  ['', 'MATH 227', 'Written Homework 3', 'Not Started', 'Sep 3, 2026', '—/40'],
  ['', 'BIOL 210', 'Midterm Exam', 'Not Started', 'Sep 8, 2026', '—/150'],
  ['', 'STAT 300', 'Data Analysis Project', 'In Progress', 'Sep 11, 2026', '—/100']
];

const STATUS_COLORS = {
  'Graded':      ['#dbeddb', '#1c3829'],
  'Submitted':   ['#d3e5ef', '#183347'],
  'In Progress': ['#fdecc8', '#402c1b'],
  'Not Started': ['#e3e2e0', '#32302c']
};

function notionHtml() {
  const rows = ROWS.map(([done, course, name, status, due, pts]) => {
    const [bg, fg] = STATUS_COLORS[status];
    return `<tr>
      <td class="c-check"><span class="box${done ? ' on' : ''}">${done ? '✓' : ''}</span></td>
      <td><span class="pill course">${course}</span></td>
      <td class="c-name">${name}</td>
      <td><span class="pill" style="background:${bg};color:${fg}">${status}</span></td>
      <td class="c-due">${due}</td>
      <td class="c-pts">${pts}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin:0; width:${W}px; height:${H}px; overflow:hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: linear-gradient(135deg,#1b5e20 0%,#2e7d32 55%,#43a047 100%);
    display:flex; align-items:center; justify-content:center; position:relative; }
  body::after { content:""; position:absolute; inset:0; pointer-events:none;
    background: radial-gradient(circle at 80% 18%, rgba(255,255,255,.16), transparent 55%); }
  .wrap { z-index:1; text-align:center; }
  .cap { color:#fff; margin-bottom:26px; }
  .cap h2 { margin:0 0 10px; font-size:40px; font-weight:700; letter-spacing:-.5px; }
  .cap p { margin:0; font-size:19px; color:rgba(255,255,255,.88); }
  .win { width:1080px; background:#fff; border-radius:12px; overflow:hidden;
    box-shadow:0 24px 70px rgba(0,0,0,.34); text-align:left; }
  .bar { height:38px; background:#f7f7f5; border-bottom:1px solid #eceae6;
    display:flex; align-items:center; padding:0 14px; gap:7px; }
  .dot { width:11px; height:11px; border-radius:50%; }
  .crumb { margin-left:12px; font-size:13px; color:#6b6b6b; }
  .body { padding:22px 30px 28px; }
  .title { font-size:26px; font-weight:700; color:#37352f; margin:0 0 3px;
    display:flex; align-items:center; gap:10px; }
  .title .emoji { font-size:24px; }
  .meta { font-size:13px; color:#9b9a97; margin:0 0 18px; }
  table { width:100%; border-collapse:collapse; font-size:14px; color:#37352f; }
  th { text-align:left; font-weight:500; font-size:12.5px; color:#9b9a97;
    padding:0 10px 9px; border-bottom:1px solid #eceae6; white-space:nowrap; }
  td { padding:11px 10px; border-bottom:1px solid #f1f0ee; vertical-align:middle; }
  .c-check { width:44px; }
  .box { display:inline-block; width:17px; height:17px; border-radius:3px;
    border:1.5px solid #c9c8c5; text-align:center; line-height:15px;
    font-size:12px; color:transparent; }
  .box.on { background:#2e7d32; border-color:#2e7d32; color:#fff; }
  .c-name { font-weight:500; }
  .c-due, .c-pts { color:#6b6b6b; white-space:nowrap; }
  .c-pts { text-align:right; }
  .pill { display:inline-block; padding:3px 9px; border-radius:4px; font-size:12.5px;
    background:#e3e2e0; color:#32302c; white-space:nowrap; }
  .pill.course { background:#e8f2ec; color:#1c3829; font-weight:500; }
</style>
<div class="wrap">
  <div class="cap">
    <h2>Everything lands in your Notion database</h2>
    <p>Course, due date, status, points and grades — kept current, with your own columns untouched.</p>
  </div>
  <div class="win">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
      <span class="crumb">Assignments</span>
    </div>
    <div class="body">
      <h1 class="title"><span class="emoji">📚</span> Assignments</h1>
      <p class="meta">Synced from Canvas · 47 assignments across 6 courses · updated 2 minutes ago</p>
      <table>
        <tr><th></th><th>Course</th><th>Assignment Name</th><th>Status</th><th>Due Date</th><th style="text-align:right">Points</th></tr>
        ${rows}
      </table>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Promotional tiles
// ---------------------------------------------------------------------------
function tileHtml(w, h, { titleSize, subSize, iconSize, gap, sub }) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing:border-box; }
  html, body { margin:0; width:${w}px; height:${h}px; overflow:hidden;
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background:linear-gradient(135deg,#1b5e20 0%,#2e7d32 55%,#43a047 100%);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:${gap}px; position:relative; color:#fff; text-align:center; padding:0 6%; }
  body::after { content:""; position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(circle at 82% 16%, rgba(255,255,255,.18), transparent 58%); }
  .icon { width:${iconSize}px; height:${iconSize}px; z-index:1;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,.28)); }
  h1 { margin:0; font-size:${titleSize}px; font-weight:700; letter-spacing:-.5px;
    line-height:1.12; z-index:1; }
  p { margin:0; font-size:${subSize}px; color:rgba(255,255,255,.9); line-height:1.4; z-index:1; }
</style>
<svg class="icon" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect x="14" y="0" width="100" height="128" rx="15" fill="#ffffff"/>
  <rect x="31" y="28" width="67" height="11" rx="5.5" fill="#1B5E20"/>
  <rect x="31" y="51" width="67" height="11" rx="5.5" fill="#1B5E20"/>
  <rect x="31" y="73" width="45" height="11" rx="5.5" fill="#1B5E20"/>
</svg>
<h1>Canvas&#8209;Notion<br>Assignment Sync</h1>
<p>${sub}</p>`;
}

async function staticShot(browser, { html, w, h, path }) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path });
  await page.close();
  console.log('  ✓ ' + path.slice(ROOT.length + 1));
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(SHOTS, { recursive: true });
  await mkdir(PROMO, { recursive: true });

  // The environment may ship a Chromium that predates the installed Playwright
  // build, so prefer an explicitly provided binary over the bundled lookup.
  const browser = await chromium.launch({
    // Both the frame and popup.html are file:// documents; without this Chromium
    // gives each an opaque origin, contentDocument reads back null, and the
    // popup can neither be waited on nor driven into a particular state.
    args: ['--allow-file-access-from-files'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  console.log('Rendering store screenshots…');

  await popupShot(browser, {
    file: 'screenshot-1-popup-main.png',
    headline: 'Canvas assignments,<br>synced to Notion',
    sub: 'Runs in the background every 30 minutes, or sync on demand. Only writes to Notion when something actually changed.',

    drive: () => {
      const d = document.getElementById('ui').contentDocument;
      const s = d.getElementById('status-message');
      s.textContent = 'Synced 47 assignments across 6 courses';
      s.className = 'status success';
    }
  });

  await popupShot(browser, {
    file: 'screenshot-2-guided-setup.png',
    headline: 'Guided setup,<br>three steps',
    sub: 'Paste your Notion token, point it at a database, and let the extension add the columns sync needs. Every field saves as you type.',
    focus: '#setupToggle',

    drive: () => {
      const d = document.getElementById('ui').contentDocument;
      if (d.getElementById('settingsSection').classList.contains('hidden')) {
        d.getElementById('expandBtn').click();
      }
      if (d.getElementById('setupBody').classList.contains('hidden')) {
        d.getElementById('setupToggle').click();
      }
    }
  });

  await popupShot(browser, {
    file: 'screenshot-4-sync-logs.png',
    headline: 'See exactly<br>what synced',
    sub: 'A timestamped, colour-coded log of every sync — what was created, updated, archived, and anything that needed your attention.',

    drive: () => {
      const d = document.getElementById('ui').contentDocument;
      d.getElementById('logsExpandBtn').click();
    }
  });

  await popupShot(browser, {
    file: 'screenshot-5-no-token.png',
    headline: 'No Canvas token<br>required',
    sub: 'Sync runs on your existing Canvas login, so it works even where your school blocks student access tokens. Notion credentials are encrypted with AES-GCM 256.',
    focus: '#advancedToggle',

    drive: () => {
      const d = document.getElementById('ui').contentDocument;
      if (d.getElementById('settingsSection').classList.contains('hidden')) {
        d.getElementById('expandBtn').click();
      }
      if (!d.getElementById('setupBody').classList.contains('hidden')) {
        d.getElementById('setupToggle').click();
      }
      if (d.getElementById('advancedBody').classList.contains('hidden')) {
        d.getElementById('advancedToggle').click();
      }
    }
  });

  await staticShot(browser, {
    html: notionHtml(), w: W, h: H,
    path: join(SHOTS, 'screenshot-3-notion-database.png')
  });

  console.log('Rendering promotional tiles…');
  await staticShot(browser, {
    html: tileHtml(440, 280, { titleSize: 33, subSize: 14.5, iconSize: 54, gap: 16,
      sub: 'Keep your Notion database up to date with Canvas — automatically.' }),
    w: 440, h: 280, path: join(PROMO, 'small-tile-440x280.png')
  });

  await staticShot(browser, {
    html: tileHtml(1400, 560, { titleSize: 82, subSize: 30, iconSize: 120, gap: 34,
      sub: 'Due dates, grades and submission status, synced to Notion every 30 minutes.' }),
    w: 1400, h: 560, path: join(PROMO, 'marquee-1400x560.png')
  });

  await browser.close();
  console.log('\nDone.');
}

main().catch((err) => { console.error(err); process.exit(1); });
