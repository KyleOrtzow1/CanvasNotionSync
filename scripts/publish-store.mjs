#!/usr/bin/env node
// Upload and submit a build to the Chrome Web Store.
//   node scripts/publish-store.mjs --zip=canvas-notion-sync-v1.2.0.zip
//
// Talks to the Chrome Web Store API v2 directly over HTTPS with nothing but
// Node's standard library. That is a deliberate choice, for two reasons:
//
//   1. The v1 API is deprecated and stops answering on 15 October 2026. Most
//      of the published npm helpers and GitHub Actions still speak v1, so
//      depending on one would mean inheriting somebody else's migration
//      deadline for the one script we cannot afford to have break.
//   2. A release script is the worst place for a supply-chain surprise. This
//      one handles a signing key; it should not pull a dependency tree in to
//      do it.
//
// The same reasoning as scripts/build-zip.mjs, one layer up.
//
// Auth is a service account: we sign a JWT with the account's private key and
// exchange it for an access token. There is no refresh token to expire (the
// OAuth-client route hands you one that dies every 7 days unless the consent
// screen is published), and nothing interactive to re-do.
//
// See RELEASING.md for the one-time setup and the secrets this expects.

import { readFileSync, statSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com/v2';
const UPLOAD_API = 'https://chromewebstore.googleapis.com/upload/v2';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

// How long to wait for the store to finish processing an uploaded package.
// Uploads are asynchronous: the POST returns while the package is still being
// unpacked and validated, and publishing before it settles fails.
const UPLOAD_POLL_INTERVAL_MS = 5000;
const UPLOAD_POLL_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    zip: null,
    key: null,
    uploadOnly: false,
    dryRun: false,
    blockOnWarnings: true,
    publishType: 'STAGED_PUBLISH'
  };
  for (const arg of argv) {
    if (arg.startsWith('--zip=')) opts.zip = arg.slice('--zip='.length);
    else if (arg.startsWith('--key=')) opts.key = arg.slice('--key='.length);
    else if (arg === '--upload-only') opts.uploadOnly = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-block-on-warnings') opts.blockOnWarnings = false;
    // Publishing straight to users instead of staging for a manual release.
    // Staged is the default on purpose - see RELEASING.md.
    else if (arg === '--publish-immediately') opts.publishType = 'DEFAULT_PUBLISH';
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

const USAGE = `
Upload and submit a build to the Chrome Web Store.

  node scripts/publish-store.mjs [options]

Options:
  --zip=<path>              Package to upload. Defaults to the zip matching
                            the version in package.json.
  --key=<path>              Read the service account key from this file
                            instead of CWS_SERVICE_ACCOUNT_KEY. Easier
                            locally - the key file is multi-line JSON.
  --dry-run                 Authenticate and run the preflight checks, then
                            stop. Uploads nothing, changes nothing. Use this
                            to verify credentials without burning a version.
  --upload-only             Upload the package as the draft, but do not submit
                            it for review.
  --publish-immediately     Publish to users as soon as review passes, instead
                            of staging the approved build for a manual release.
  --no-block-on-warnings    Submit even if the store returns validation
                            warnings. By default warnings stop the release.

Environment:
  CWS_SERVICE_ACCOUNT_KEY   Service account JSON key (the whole file). CI uses
                            this; locally, --key=<path> is easier.
  CWS_SERVICE_ACCOUNT_KEY_FILE
                            Path to the key file, as an alternative to --key.
  CWS_PUBLISHER_ID          Publisher ID from the Developer Dashboard.
  CWS_EXTENSION_ID          Extension ID (the one in the store URL).
`.trim();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error(
      '\nRepository secrets and variables set on GitHub are only visible inside GitHub\n' +
        'Actions runs - they are not shared with your machine. To run this locally, set\n' +
        'them in your own shell first. See "Verify it works" in RELEASING.md.'
    );
    process.exit(1);
  }
  return value;
}

/**
 * Parses the service account JSON and pulls out the two fields we need.
 * Everything reported here is a shape problem, never the key material - an
 * error message from a release job ends up in a public CI log.
 */
function loadServiceAccount(keyPath) {
  // A path is the friendlier route locally: the key file is pretty-printed
  // JSON, and getting several lines of it into an environment variable is
  // genuinely awkward on Windows (cmd.exe's `set /p` reads one line and
  // silently truncates the rest). CI passes the contents directly, because a
  // secret there never touches disk.
  const source = keyPath
    ? { label: keyPath, read: () => readFileSync(keyPath, 'utf8') }
    : { label: 'CWS_SERVICE_ACCOUNT_KEY', read: () => requireEnv('CWS_SERVICE_ACCOUNT_KEY') };

  let raw;
  try {
    raw = source.read();
  } catch (err) {
    console.error(`Could not read the service account key from ${source.label}`);
    console.error(`  - ${err.message}`);
    process.exit(1);
  }

  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    console.error(`${source.label} is not valid JSON.`);
    console.error('It should be the entire service account key file, including the braces.');
    // The truncation above produces exactly this, so name it rather than
    // leaving someone to wonder why a file they can see is "not valid JSON".
    if (!raw.trimEnd().endsWith('}')) {
      console.error('It looks cut off - the closing brace is missing. If you loaded it into an');
      console.error('environment variable, the multi-line file was probably truncated; pass');
      console.error('--key=<path> to read the file directly instead.');
    }
    process.exit(1);
  }

  if (!key.client_email || !key.private_key) {
    console.error(`${source.label} is missing "client_email" or "private_key".`);
    console.error('Make sure it is a service account key, not an OAuth client secret.');
    process.exit(1);
  }
  return { clientEmail: key.client_email, privateKey: key.private_key };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Builds and signs the assertion Google exchanges for an access token: a JWT
 * claiming to be the service account, scoped to the Chrome Web Store, valid
 * for an hour.
 */
function signAssertion({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  return `${signingInput}.${signer.sign(privateKey, 'base64url')}`;
}

async function getAccessToken(serviceAccount) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signAssertion(serviceAccount)
    })
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Could not get an access token (HTTP ${res.status}).`);
    console.error(body);
    if (body.includes('invalid_grant')) {
      console.error(
        '\n"invalid_grant" usually means the service account key is wrong, revoked, or ' +
          "this machine's clock is off by more than a few minutes."
      );
    }
    process.exit(1);
  }
  return JSON.parse(body).access_token;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * One API call. Returns the parsed JSON body; exits with the store's own error
 * text on failure, because that text is nearly always the actionable part
 * (version too low, item under review, service account not granted access).
 */
async function api(token, url, { method = 'GET', body, contentType, what } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();

  if (!res.ok) {
    console.error(`\n${what} failed (HTTP ${res.status}):`);
    console.error(text || '(empty response)');
    if (res.status === 403) {
      console.error(
        '\nA 403 here usually means the service account has not been granted access in the ' +
          'Developer Dashboard (Account > add the service account email), or the publisher ID is wrong.'
      );
    }
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

const itemPath = (pub, ext) => `publishers/${pub}/items/${ext}`;

const fetchStatus = (token, pub, ext) =>
  api(token, `${API}/${itemPath(pub, ext)}:fetchStatus`, { what: 'Fetching item status' });

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * Compares two Chrome extension versions ("1.2" vs "1.10.0"). Missing trailing
 * parts count as zero, so "1.2" and "1.2.0" are equal. Returns -1, 0, or 1.
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** The version the live item reports, or null if the store has none yet. */
function liveVersion(status) {
  const channels = status?.publishedItemRevisionStatus?.distributionChannels;
  if (!Array.isArray(channels)) return null;
  // Multiple channels exist during a percentage rollout; the highest version
  // present is the one a new upload has to beat.
  const versions = channels.map((c) => c?.crxVersion).filter(Boolean);
  if (versions.length === 0) return null;
  return versions.sort(compareVersions)[versions.length - 1];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Everything worth catching before we spend a version number. An upload that
 * the store rejects is not free: the local version has already been committed
 * and tagged by the time this runs, so a failure here means a bump and a new
 * tag rather than a retry.
 */
function preflight(status, localVersion) {
  const problems = [];

  if (status.takenDown) {
    problems.push('The store reports this item as taken down. Resolve that in the Developer Dashboard first.');
  }

  const submitted = status.submittedItemRevisionStatus?.state;
  if (submitted === 'PENDING_REVIEW') {
    problems.push(
      'A submission is already under review. Wait for it to finish, or cancel it in the ' +
        'Developer Dashboard, before submitting another.'
    );
  }
  if (submitted === 'STAGED') {
    problems.push(
      'An approved build is already staged and waiting to be released. Release or discard it ' +
        'in the Developer Dashboard before submitting another.'
    );
  }

  const live = liveVersion(status);
  if (live) {
    const cmp = compareVersions(localVersion, live);
    if (cmp === 0) {
      problems.push(`Version ${localVersion} is already live. Bump the version with \`npm run bump\` first.`);
    } else if (cmp < 0) {
      problems.push(`Version ${localVersion} is lower than the live version ${live}. The store will reject it.`);
    }
  }

  return { problems, live };
}

async function upload(token, pub, ext, zipPath, expectedVersion) {
  const zip = readFileSync(zipPath);
  console.log(`Uploading ${basename(zipPath)} (${(zip.length / 1024).toFixed(0)}K)...`);

  const result = await api(token, `${UPLOAD_API}/${itemPath(pub, ext)}:upload`, {
    method: 'POST',
    body: zip,
    contentType: 'application/zip',
    what: 'Upload'
  });

  if (result.crxVersion && result.crxVersion !== expectedVersion) {
    console.error(
      `\nUpload succeeded but the store read version ${result.crxVersion} from the package, ` +
        `not ${expectedVersion}. The zip does not contain the manifest this build expects.`
    );
    process.exit(1);
  }

  await waitForUpload(token, pub, ext, result.uploadState);
  console.log(`Uploaded version ${expectedVersion}.`);
}

/**
 * Uploads are processed asynchronously, so a package can still be unpacking
 * when the POST returns. Publishing during that window fails, so wait it out.
 */
async function waitForUpload(token, pub, ext, initialState) {
  if (initialState && initialState !== 'UPLOAD_IN_PROGRESS') {
    if (initialState === 'FAILURE') {
      console.error('\nThe store rejected the uploaded package.');
      process.exit(1);
    }
    return;
  }

  const deadline = Date.now() + UPLOAD_POLL_TIMEOUT_MS;
  process.stdout.write('Waiting for the store to process the package');

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS));
    const state = (await fetchStatus(token, pub, ext)).lastAsyncUploadState;
    if (state && state !== 'UPLOAD_IN_PROGRESS') {
      process.stdout.write('\n');
      if (state === 'FAILURE') {
        console.error('The store rejected the uploaded package.');
        process.exit(1);
      }
      return;
    }
    process.stdout.write('.');
  }

  process.stdout.write('\n');
  console.error(
    `The package was still processing after ${UPLOAD_POLL_TIMEOUT_MS / 1000}s. ` +
      'It may still succeed - check the Developer Dashboard before re-running.'
  );
  process.exit(1);
}

async function publish(token, pub, ext, { publishType, blockOnWarnings }) {
  console.log(`Submitting for review (${publishType})...`);

  const result = await api(token, `${API}/${itemPath(pub, ext)}:publish`, {
    method: 'POST',
    body: JSON.stringify({ publishType, blockOnWarnings }),
    contentType: 'application/json',
    what: 'Publish'
  });

  const warnings = result.warningInfo?.warnings ?? [];
  if (warnings.length > 0) {
    console.warn('\nThe store returned warnings:');
    for (const w of warnings) console.warn(`  - ${w.reason}: ${w.description}`);
  }

  console.log(`\nSubmitted. Item state: ${result.state ?? 'unknown'}`);
  if (publishType === 'STAGED_PUBLISH') {
    console.log('Once review passes, the build waits staged until you release it in the Developer Dashboard.');
  } else {
    console.log('It will go live automatically once review passes.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const zipPath = opts.zip ? join(ROOT, opts.zip) : join(ROOT, `canvas-notion-sync-v${version}.zip`);

  // Skipped for a dry run, which deliberately works before anything is built:
  // its whole job is to prove the credentials without needing a package.
  if (!opts.dryRun) {
    try {
      statSync(zipPath);
    } catch {
      console.error(`No package at ${zipPath}`);
      console.error('Run `npm run build:zip` first.');
      process.exit(1);
    }
  }

  const publisherId = requireEnv('CWS_PUBLISHER_ID');
  const extensionId = requireEnv('CWS_EXTENSION_ID');
  const serviceAccount = loadServiceAccount(opts.key || process.env.CWS_SERVICE_ACCOUNT_KEY_FILE || null);

  console.log(`Extension: ${extensionId}`);
  console.log(`Version:   ${version}`);

  const token = await getAccessToken(serviceAccount);
  console.log('Authenticated.\n');

  const status = await fetchStatus(token, publisherId, extensionId);
  const { problems, live } = preflight(status, version);

  console.log(`Live version: ${live ?? '(none published yet)'}`);
  if (status.submittedItemRevisionStatus?.state) {
    console.log(`Pending submission: ${status.submittedItemRevisionStatus.state}`);
  }

  if (problems.length > 0) {
    console.error('\nPreflight failed:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('Preflight passed.\n');

  if (opts.dryRun) {
    console.log('Dry run: credentials and preflight are good. Nothing was uploaded.');
    return;
  }

  await upload(token, publisherId, extensionId, zipPath, version);

  if (opts.uploadOnly) {
    console.log('\nUpload only: the draft is in place but has not been submitted for review.');
    return;
  }

  await publish(token, publisherId, extensionId, opts);
}

// Run only when invoked directly, so the pure helpers above can be unit
// tested without the script trying to publish anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}

export { parseArgs, compareVersions, liveVersion, preflight, signAssertion, base64url };
