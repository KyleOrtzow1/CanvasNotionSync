'use strict';

/**
 * Prints one version's section of CHANGELOG.md, for use as GitHub Release
 * notes.
 *
 * The alternative is auto-generating notes from commit subjects, which
 * describe what a developer did rather than what a user got. The changelog is
 * written for users, so the release should quote it verbatim - and having the
 * release workflow read the file back gives the changelog a job, which is the
 * only thing that keeps one current.
 *
 * Usage: node .github/scripts/changelog-section.cjs 1.2.0
 *
 * Never fails the release: a missing or empty section prints a placeholder
 * rather than exiting non-zero. A version that shipped without notes is a
 * documentation problem, not a reason to strand a package that is already
 * uploaded to the store.
 */

/**
 * Returns the body of the section for `version`, without its heading.
 * Matches "## [1.2.0] - 2026-09-01", "## [1.2.0]" and "## 1.2.0" alike, and
 * stops at the next "## " heading.
 *
 * The lookahead after the version is what stops a prefix from matching a
 * longer version: without it, "1.1" matches the "## [1.1.0]" heading (the
 * closing bracket is optional and the trailing .* eats ".0]"), and the
 * release ships the wrong version's notes.
 */
function sectionFor(changelog, version) {
  const escaped = version.replace(/\./g, '\\.');
  const pattern = new RegExp(`^## \\[?${escaped}\\]?(?![\\d.]).*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
  const match = changelog.match(pattern);
  return match ? match[1].trim() : null;
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node .github/scripts/changelog-section.cjs <version>');
    process.exit(2);
  }

  const changelogPath = path.join(__dirname, '..', '..', 'CHANGELOG.md');
  let changelog = '';
  try {
    changelog = fs.readFileSync(changelogPath, 'utf8');
  } catch {
    // Falls through to the placeholder below.
  }

  const section = changelog ? sectionFor(changelog, version) : null;
  if (section) {
    console.log(section);
  } else {
    console.log(`See [CHANGELOG.md](CHANGELOG.md) for changes in ${version}.`);
  }
}

module.exports = { sectionFor };
