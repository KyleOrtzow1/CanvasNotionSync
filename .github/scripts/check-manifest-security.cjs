'use strict';

/**
 * Manifest security checker.
 *
 * Asserts three things about manifest.json that ESLint cannot check, because
 * they are properties of the manifest itself rather than of JS source:
 *
 *   1. HTTPS   - every host pattern (host_permissions, content_scripts matches,
 *                CSP connect-src) uses https:// - no http://, wildcard schemes,
 *                or <all_urls>.
 *   2. Permissions - `permissions` contains only entries in an explicit
 *                allowlist of what the extension actually uses today. Adding
 *                a new permission requires updating the allowlist in the same
 *                PR, which is the point: it forces a deliberate decision
 *                instead of silent permission creep.
 *   3. CSP     - content_security_policy.extension_pages exists, script-src
 *                and object-src are locked to 'self', and every host that the
 *                content script is injected into (content_scripts[].matches)
 *                also appears in both host_permissions and CSP connect-src.
 *                That last check is what would have caught #36 (a
 *                canvaslms.com host present in `matches` but missing from
 *                host_permissions/connect-src).
 *
 * This module exports the pure assertion function so it can be unit tested
 * against synthetic manifests without touching the filesystem. The CLI
 * wrapper at the bottom just reads the real manifest.json and reports.
 *
 * Deliberately does NOT import anything from src/ - this runs under plain
 * Node with no extension globals (chrome.*, etc.) available.
 */

// Permissions the extension actually uses today. A new permission must be
// added here in the same PR that introduces it.
const ALLOWED_PERMISSIONS = ['storage', 'activeTab', 'scripting', 'alarms', 'notifications'];

/**
 * Strips the scheme and any path/wildcard suffix from a URL-shaped manifest
 * pattern so different manifest sections can be compared on host alone.
 *   "https://*.instructure.com/*" -> "*.instructure.com"
 *   "https://*.instructure.com"   -> "*.instructure.com"
 * Returns null for anything that isn't a plain string.
 */
function hostFromPattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const withoutScheme = pattern.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  return withoutScheme.split('/')[0];
}

function isHttpsUrl(pattern) {
  return typeof pattern === 'string' && pattern.startsWith('https://');
}

/**
 * Parses a CSP string ("script-src 'self'; object-src 'self'; ...") into a
 * map of directive name -> array of source tokens.
 */
function parseCsp(cspString) {
  const directives = {};
  if (!cspString || typeof cspString !== 'string') return directives;
  for (const part of cspString.split(';').map((s) => s.trim()).filter(Boolean)) {
    const tokens = part.split(/\s+/);
    const name = tokens[0];
    directives[name] = tokens.slice(1);
  }
  return directives;
}

/**
 * Runs all manifest security assertions against a parsed manifest object.
 * Returns an array of human-readable failure messages (empty = passed).
 * Never throws on a malformed/incomplete manifest - missing fields are
 * treated as their empty-collection default so every applicable assertion
 * still runs and reports.
 */
function checkManifestSecurity(manifest) {
  const errors = [];
  manifest = manifest || {};

  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const cspString =
    manifest.content_security_policy && typeof manifest.content_security_policy.extension_pages === 'string'
      ? manifest.content_security_policy.extension_pages
      : '';
  const cspDirectives = parseCsp(cspString);
  const connectSrc = cspDirectives['connect-src'] || [];

  const allMatches = [];
  for (const cs of contentScripts) {
    for (const match of (cs && Array.isArray(cs.matches) ? cs.matches : [])) {
      allMatches.push(match);
    }
  }

  // ---- 1. HTTPS ----
  for (const perm of hostPermissions) {
    if (!isHttpsUrl(perm)) {
      errors.push(`HTTPS check failed: host_permissions entry "${perm}" must start with https://`);
    }
  }
  for (const match of allMatches) {
    if (!isHttpsUrl(match)) {
      errors.push(`HTTPS check failed: content_scripts matches entry "${match}" must start with https://`);
    }
  }
  for (const src of connectSrc) {
    // CSP keyword sources (e.g. 'self') aren't URLs; only URL-shaped tokens
    // are subject to the https:// requirement.
    if (src.startsWith("'")) continue;
    if (!isHttpsUrl(src)) {
      errors.push(`HTTPS check failed: CSP connect-src source "${src}" must start with https://`);
    }
  }

  // ---- 2. Permissions allowlist ----
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const perm of permissions) {
    if (!ALLOWED_PERMISSIONS.includes(perm)) {
      errors.push(
        `Permissions check failed: "${perm}" is not in the allowlist [${ALLOWED_PERMISSIONS.join(', ')}]. ` +
          'Add it to ALLOWED_PERMISSIONS in .github/scripts/check-manifest-security.cjs if this is intentional.'
      );
    }
  }

  // ---- 3. CSP shape ----
  if (!cspString) {
    errors.push('CSP check failed: content_security_policy.extension_pages is missing');
  } else {
    const scriptSrc = cspDirectives['script-src'] || [];
    if (!scriptSrc.includes("'self'")) {
      errors.push(`CSP check failed: script-src must include 'self', got "${scriptSrc.join(' ') || '(empty)'}"`);
    }
    const disallowedScriptSrc = scriptSrc.filter((s) => s !== "'self'");
    if (disallowedScriptSrc.length > 0) {
      errors.push(`CSP check failed: script-src must be exactly 'self', found disallowed source(s): ${disallowedScriptSrc.join(', ')}`);
    }

    const objectSrc = cspDirectives['object-src'] || [];
    if (objectSrc.length !== 1 || objectSrc[0] !== "'self'") {
      errors.push(`CSP check failed: object-src must be exactly 'self', got "${objectSrc.join(' ') || '(missing)'}"`);
    }
  }

  // ---- 3b. Host consistency (the #36 class of drift) ----
  const hostPermissionHosts = new Set(hostPermissions.map(hostFromPattern));
  const connectSrcHosts = new Set(connectSrc.map(hostFromPattern));
  const matchHosts = new Set(allMatches.map(hostFromPattern));

  for (const host of matchHosts) {
    if (!hostPermissionHosts.has(host)) {
      errors.push(
        `CSP check failed: content_scripts host "${host}" is injected via matches but missing from host_permissions`
      );
    }
    if (!connectSrcHosts.has(host)) {
      errors.push(
        `CSP check failed: content_scripts host "${host}" is injected via matches but missing from CSP connect-src`
      );
    }
  }

  return errors;
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const manifestPath = path.join(__dirname, '..', '..', 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`Manifest security check failed: could not read/parse ${manifestPath}`);
    console.error(`  - ${err.message}`);
    process.exit(1);
  }

  const errors = checkManifestSecurity(manifest);
  if (errors.length > 0) {
    console.error('Manifest security check failed:\n');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error(`\n${errors.length} issue(s) found in manifest.json`);
    process.exit(1);
  }

  console.log('Manifest security check passed.');
}

module.exports = { checkManifestSecurity, ALLOWED_PERMISSIONS };
