// Single source of truth for which hosts count as "Canvas" (issue #36).
// Loaded as a plain script (content script, popup) and via side-effect
// import (service worker). Access via globalThis.* in both contexts,
// matching the pattern used by debug.js and canvas-validator.js.
//
// manifest.json's host_permissions/content_scripts.matches/CSP connect-src
// are static JSON and cannot import this module, so they must literally
// list the same domains as CANVAS_DOMAINS below — keep them in sync by hand.

const CANVAS_DOMAINS = ['instructure.com', 'canvaslms.com'];

// chrome.tabs.query match patterns — https only, deliberately not *://.
// The manifest only ever grants https host permissions, so allowing an
// http:// tab to be discovered here would just fail later on permissions.
const CANVAS_TAB_PATTERNS = CANVAS_DOMAINS.map((domain) => `https://*.${domain}/*`);

// Matches a Canvas origin at the start of a URL string (e.g. window.location.href
// or a chrome.tabs onUpdated tab.url). Capture group 1 is the origin, e.g.
// "https://school.instructure.com", for building an API base URL from it.
const CANVAS_HOST_RE = new RegExp(
  `^(https://[^/]+\\.(?:${CANVAS_DOMAINS.map((domain) => domain.replace(/\./g, '\\.')).join('|')}))`
);

// Make available as global for content scripts, popup, and the service worker.
if (typeof globalThis !== 'undefined') {
  globalThis.CANVAS_DOMAINS = CANVAS_DOMAINS;
  globalThis.CANVAS_TAB_PATTERNS = CANVAS_TAB_PATTERNS;
  globalThis.CANVAS_HOST_RE = CANVAS_HOST_RE;
}
