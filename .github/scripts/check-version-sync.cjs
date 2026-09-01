'use strict';

/**
 * Version consistency checker.
 *
 * Three files can disagree about what version this extension is, and each
 * disagreement fails somewhere different and late:
 *
 *   1. package.json  - what `npm run build:zip` names the zip and what the
 *                      release workflow believes it is shipping.
 *   2. manifest.json - what the Chrome Web Store actually reads. If this is
 *                      not strictly higher than the live version, the upload
 *                      is rejected *after* CI has already gone green.
 *   3. the git tag   - the durable record of what shipped. A `v1.2.0` tag on
 *                      a tree that says 1.1.0 makes the history a lie.
 *
 * Left unchecked these drift silently: the two JSON files sat at 1.1.0 by
 * luck, not by enforcement, and nothing would have caught a bump applied to
 * one and forgotten in the other. This runs in normal CI (files only) and
 * again in the release workflow (files + tag).
 *
 * Exports the pure assertion function so it can be unit tested against
 * synthetic inputs, matching check-manifest-security.cjs. The CLI wrapper at
 * the bottom reads the real files.
 *
 * Usage:
 *   node .github/scripts/check-version-sync.cjs             # files agree
 *   node .github/scripts/check-version-sync.cjs --tag v1.2.0 # ...and match the tag
 */

// Chrome requires 1-4 dot-separated integers, each 0-65535, no leading zeros
// on multi-digit parts, and the first must be non-zero. Semver pre-release
// suffixes (-beta.1) and build metadata are NOT accepted by the store, so a
// version that npm would happily take can still be rejected at upload. Catch
// it here instead.
const CHROME_VERSION = /^(?!0\d)(?!0+$)\d{1,5}(\.(?!0\d)\d{1,5}){0,3}$/;

/** Every part within Chrome's 0-65535 range. Shape is checked separately. */
function partsInRange(version) {
  return version.split('.').every((part) => Number(part) <= 65535);
}

/**
 * Strips a leading "v" from a git tag: "v1.2.0" -> "1.2.0". Anything else is
 * returned unchanged so the mismatch is reported rather than silently coerced.
 */
function versionFromTag(tag) {
  if (typeof tag !== 'string') return null;
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Asserts that the package version, the manifest version, and (when given)
 * the release tag all describe the same release.
 *
 * @param {object} input
 * @param {string} input.packageVersion  `version` from package.json
 * @param {string} input.manifestVersion `version` from manifest.json
 * @param {string} [input.tag]           release tag, e.g. "v1.2.0". Omit to
 *                                       check the two files only.
 * @returns {string[]} human-readable failures (empty = passed)
 */
function checkVersionSync({ packageVersion, manifestVersion, tag } = {}) {
  const errors = [];

  for (const [label, value] of [
    ['package.json', packageVersion],
    ['manifest.json', manifestVersion]
  ]) {
    if (typeof value !== 'string' || value === '') {
      errors.push(`${label} has no "version" field`);
    } else if (!CHROME_VERSION.test(value) || !partsInRange(value)) {
      errors.push(
        `${label} version "${value}" is not a valid Chrome extension version. ` +
          'It must be 1-4 dot-separated integers between 0 and 65535, with a non-zero ' +
          'first part and no leading zeros. Pre-release suffixes like "-beta.1" are ' +
          'not accepted by the Chrome Web Store.'
      );
    }
  }

  // Only worth comparing once both are strings; otherwise the missing-field
  // error above already says everything useful.
  if (typeof packageVersion === 'string' && typeof manifestVersion === 'string') {
    if (packageVersion !== manifestVersion) {
      errors.push(
        `Version mismatch: package.json is "${packageVersion}" but manifest.json is "${manifestVersion}". ` +
          'Use `npm run bump` so both move together.'
      );
    }
  }

  if (tag !== undefined && tag !== null && tag !== '') {
    const tagVersion = versionFromTag(tag);
    if (tagVersion !== manifestVersion) {
      errors.push(
        `Tag mismatch: tag "${tag}" implies version "${tagVersion}" but manifest.json is "${manifestVersion}". ` +
          'The tag must match the version being released.'
      );
    }
  }

  return errors;
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  // --tag=v1.2.0 and "--tag v1.2.0" are both accepted; CI uses whichever is
  // less awkward to write in YAML.
  const argv = process.argv.slice(2);
  let tag;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--tag=')) tag = argv[i].slice('--tag='.length);
    else if (argv[i] === '--tag') tag = argv[i + 1];
  }

  const ROOT = path.join(__dirname, '..', '..');
  function readVersion(file) {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).version;
    } catch (err) {
      console.error(`Version check failed: could not read/parse ${file}`);
      console.error(`  - ${err.message}`);
      process.exit(1);
    }
  }

  const packageVersion = readVersion('package.json');
  const manifestVersion = readVersion('manifest.json');

  const errors = checkVersionSync({ packageVersion, manifestVersion, tag });
  if (errors.length > 0) {
    console.error('Version check failed:\n');
    for (const err of errors) console.error(`  - ${err}`);
    console.error(`\n${errors.length} issue(s) found`);
    process.exit(1);
  }

  console.log(`Version check passed: ${manifestVersion}${tag ? ` (tag ${tag})` : ''}`);
}

module.exports = { checkVersionSync, versionFromTag, CHROME_VERSION };
