#!/usr/bin/env node
// Move the extension to a new version, everywhere at once.
//   npm run bump -- patch|minor|major|<explicit version>   [--tag] [--dry-run]
//
// The version lives in four places, and every one of them fails differently
// when it drifts:
//
//   package.json       names the zip and tells the release workflow what it
//                      is shipping
//   manifest.json      the only one the Chrome Web Store actually reads
//   package-lock.json  kept in step so the lockfile does not show a spurious
//                      diff on the next npm command
//   CHANGELOG.md       the release notes the workflow reads back out
//
// Editing these by hand is the kind of chore that works until the once it
// doesn't. `npm version` is not a substitute: it knows about package.json and
// the lockfile, and nothing about the other two.
//
// manifest.json is edited by targeted replacement rather than parse-and-
// reserialize, deliberately - the file is hand-formatted with blank lines
// grouping related keys, and JSON.stringify would flatten all of it into an
// unreviewable diff.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same rule the Chrome Web Store applies, and the same one
// .github/scripts/check-version-sync.cjs enforces in CI.
const CHROME_VERSION = /^(?!0\d)(?!0+$)\d{1,5}(\.(?!0\d)\d{1,5}){0,3}$/;

const USAGE = `
Bump the extension version in package.json, manifest.json, package-lock.json
and CHANGELOG.md together.

  npm run bump -- patch            1.1.0 -> 1.1.1
  npm run bump -- minor            1.1.0 -> 1.2.0
  npm run bump -- major            1.1.0 -> 2.0.0
  npm run bump -- 1.4.2            explicit version

Options:
  --tag        also create the annotated git tag (v<version>)
  --dry-run    print what would change, write nothing
`.trim();

/**
 * Works out the new version from the current one and what was asked for.
 * Chrome allows up to four parts; a release bump only ever touches the first
 * three, so anything beyond them is dropped rather than carried forward into
 * a version that means something different.
 */
function nextVersion(current, bump) {
  if (CHROME_VERSION.test(bump)) return bump;

  const [major = 0, minor = 0, patch = 0] = current.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return null;
  }
}

/**
 * Compares two dotted versions, treating missing trailing parts as zero.
 * Returns -1, 0, or 1.
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Replaces the value of a top-level "version" key without touching anything
 * else in the file - whitespace, key order, and comments-by-convention all
 * survive. Returns null if the key isn't found, so the caller can fail loudly
 * instead of writing a file that silently didn't change.
 */
function replaceVersion(source, from, to) {
  const pattern = new RegExp(`("version"\\s*:\\s*")${from.replace(/\./g, '\\.')}(")`);
  if (!pattern.test(source)) return null;
  return source.replace(pattern, `$1${to}$2`);
}

/**
 * Opens a new released section in the changelog, carrying whatever sits under
 * "Unreleased" into it and leaving a fresh Unreleased behind.
 */
function updateChangelog(source, version, date) {
  const heading = /^## \[Unreleased\].*$/m;
  if (!heading.test(source)) return null;
  return source.replace(heading, (line) => `${line}\n\n## [${version}] - ${date}`);
}

/** Whether the Unreleased section has anything in it beyond whitespace. */
function unreleasedIsEmpty(source) {
  const match = source.match(/^## \[Unreleased\].*$([\s\S]*?)(?=^## |\Z)/m);
  return !match || match[1].trim() === '';
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')));

  if (flags.has('--help') || flags.has('-h')) {
    console.log(USAGE);
    return;
  }
  if (args.length !== 1) {
    console.log(USAGE);
    process.exit(2);
  }

  const dryRun = flags.has('--dry-run');
  const shouldTag = flags.has('--tag');

  const pkgPath = join(ROOT, 'package.json');
  const manifestPath = join(ROOT, 'manifest.json');
  const lockPath = join(ROOT, 'package-lock.json');
  const changelogPath = join(ROOT, 'CHANGELOG.md');

  const pkgSource = readFileSync(pkgPath, 'utf8');
  const manifestSource = readFileSync(manifestPath, 'utf8');
  const current = JSON.parse(pkgSource).version;
  const manifestCurrent = JSON.parse(manifestSource).version;

  if (current !== manifestCurrent) {
    console.error(
      `package.json (${current}) and manifest.json (${manifestCurrent}) already disagree. ` +
        'Fix that by hand first - bumping from here would just pick one and hide the other.'
    );
    process.exit(1);
  }

  const version = nextVersion(current, args[0]);
  if (!version) {
    console.error(`Not a version or a bump type: "${args[0]}"\n`);
    console.log(USAGE);
    process.exit(2);
  }
  if (!CHROME_VERSION.test(version)) {
    console.error(
      `"${version}" is not a valid Chrome extension version: 1-4 integers between 0 and 65535, ` +
        'non-zero first part, no leading zeros, no pre-release suffix.'
    );
    process.exit(1);
  }
  if (compareVersions(version, current) <= 0) {
    console.error(`${version} is not higher than the current ${current}. The store only accepts increases.`);
    process.exit(1);
  }

  // --- work out every edit before writing any of them ---
  const edits = [];

  for (const [path, source, label] of [
    [pkgPath, pkgSource, 'package.json'],
    [manifestPath, manifestSource, 'manifest.json']
  ]) {
    const updated = replaceVersion(source, current, version);
    if (!updated) {
      console.error(`Could not find "version": "${current}" in ${label}.`);
      process.exit(1);
    }
    edits.push([path, updated, label]);
  }

  if (existsSync(lockPath)) {
    // Parsed rather than pattern-replaced, unlike the two files above. The
    // root version appears exactly twice in a lockfile - at the top level and
    // as packages[""].version - but the same "version": "1.1.0" text also
    // appears against any dependency that happens to sit on that version, and
    // a blind replace silently repins them. npm writes lockfiles with 2-space
    // indent and a trailing newline, so this round-trips byte for byte.
    const lockSource = readFileSync(lockPath, 'utf8');
    const lock = JSON.parse(lockSource);
    if (lock.version === current) lock.version = version;
    if (lock.packages?.['']?.version === current) lock.packages[''].version = version;
    const updated = `${JSON.stringify(lock, null, 2)}\n`;
    if (updated !== lockSource) edits.push([lockPath, updated, 'package-lock.json']);
  }

  if (existsSync(changelogPath)) {
    const changelogSource = readFileSync(changelogPath, 'utf8');
    if (unreleasedIsEmpty(changelogSource)) {
      console.warn('Warning: the Unreleased section of CHANGELOG.md is empty.');
      console.warn('         The release notes for this version will be blank.\n');
    }
    const date = new Date().toISOString().slice(0, 10);
    const updated = updateChangelog(changelogSource, version, date);
    if (!updated) {
      console.error('Could not find a "## [Unreleased]" heading in CHANGELOG.md.');
      process.exit(1);
    }
    edits.push([changelogPath, updated, 'CHANGELOG.md']);
  }

  console.log(`${current} -> ${version}\n`);
  for (const [, , label] of edits) console.log(`  ${dryRun ? 'would update' : 'updated'} ${label}`);

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    return;
  }

  for (const [path, contents] of edits) writeFileSync(path, contents);

  if (shouldTag) {
    execFileSync('git', ['tag', '-a', `v${version}`, '-m', `v${version}`], { stdio: 'inherit' });
    console.log(`\nTagged v${version}.`);
  }

  console.log('\nNext:');
  console.log('  1. Fill in the CHANGELOG entry for this version.');
  console.log(`  2. git commit -am "Release v${version}"`);
  if (!shouldTag) console.log(`  3. git tag -a v${version} -m "v${version}"`);
  console.log(`  ${shouldTag ? '3' : '4'}. git push && git push origin v${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

export { nextVersion, replaceVersion, updateChangelog, unreleasedIsEmpty, compareVersions, CHROME_VERSION };
