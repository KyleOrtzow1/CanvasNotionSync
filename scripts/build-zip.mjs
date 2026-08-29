#!/usr/bin/env node
// Build a clean .zip for Chrome Web Store upload.
//   npm run build:zip
//
// This is deliberately a Node script rather than a shell script. The previous
// build-zip.sh went through `bash`, and on Windows which bash you get is not
// predictable - it broke three different ways in a row:
//
//   1. Git checked the script out with CRLF, so bash rejected `set -euo
//      pipefail\r` (fixed by .gitattributes, but only for shell scripts).
//   2. The bash that npm handed the script to had no node on its PATH, so
//      reading the version failed.
//   3. That bash was not Git Bash, so `zip` was missing AND the PowerShell
//      fallback's `pwd -W` (a Git Bash extension) was not available either.
//
// npm resolves node itself, so running the build through node removes the
// entire class of problem: no bash, no `zip` binary, no path translation, no
// line-ending sensitivity. It behaves the same on Windows, macOS, Linux, and
// CI, with no dependencies beyond Node's standard library.

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Everything the extension needs at runtime. Kept as an explicit list rather
// than an exclude list so a new top-level file cannot slip into a release
// unnoticed - adding one here is a deliberate act.
const FILES = [
  'manifest.json',
  'background.js',
  'content-script.js',
  'popup.html',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

// src/ ships wholesale except for anything that only exists for the test suite.
const SRC_DIR = 'src';
const SRC_EXCLUDE = (path) => path.endsWith('.test.js') || path.split('/').includes('__mocks__');

/** Every file under `dir`, relative to ROOT, with forward slashes. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

// CRC-32 (IEEE), which the zip format requires per entry. Table built once.
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Fixed timestamp (1980-01-01, the earliest a zip can represent) so that
// building the same commit twice produces a byte-identical archive. The store
// does not care about mtimes, and reproducibility makes it possible to verify
// that a rebuild changed nothing.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // month=1, day=1, year=1980

/**
 * Writes a zip archive. Entries are stored in the order given, each deflated,
 * followed by the central directory and the end-of-central-directory record.
 * No zip64: this archive is ~64KB, far below the 4GB/65535-entry limits.
 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Fall back to storing when deflate does not actually help, which happens
    // with already-compressed PNGs.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // central directory header signature
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed to extract
    dir.writeUInt16LE(0, 8); // flags
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra field length
    dir.writeUInt16LE(0, 32); // file comment length
    dir.writeUInt16LE(0, 34); // disk number start
    dir.writeUInt16LE(0, 36); // internal file attributes
    dir.writeUInt32LE(0o644 << 16, 38); // external attributes: regular file, 0644
    dir.writeUInt32LE(offset, 42); // offset of local header
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 18); // comment length

  return Buffer.concat([...chunks, centralBuf, end]);
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (!version) {
  console.error('No "version" in package.json');
  process.exit(1);
}

const names = [...FILES, ...walk(SRC_DIR).filter((p) => !SRC_EXCLUDE(p))].sort();

const missing = names.filter((name) => {
  try {
    return !statSync(join(ROOT, ...name.split('/'))).isFile();
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error(`Missing file(s) the build expects:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

const entries = names.map((name) => ({
  name,
  data: readFileSync(join(ROOT, ...name.split('/')))
}));

const out = join(ROOT, `canvas-notion-sync-v${version}.zip`);
rmSync(out, { force: true });
writeFileSync(out, buildZip(entries));

const size = statSync(out).size;
console.log(`\nBuilt: ${relative(ROOT, out).split(sep).join('/')}`);
console.log(`Files: ${entries.length}`);
console.log(`Size:  ${(size / 1024).toFixed(0)}K`);
