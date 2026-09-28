import { describe, test, expect, beforeAll } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipPath = path.join(root, `canvas-notion-sync-v${version}.zip`);

// Reads the archive the way a strict unzipper does: from the end-of-central-
// directory record, through the central directory, to each local header. A
// tolerant reader (Chrome's) can recover from wrong offsets, so the store
// accepting a package proves nothing about whether it is well formed.
function readArchive(buf) {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  const dirSize = buf.readUInt32LE(end + 12);
  const dirOffset = buf.readUInt32LE(end + 16);
  const entries = [];
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    entries.push({
      name: buf.toString('utf8', at + 46, at + 46 + nameLength),
      localOffset: buf.readUInt32LE(at + 42)
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, dirOffset, dirSize, commentLength: buf.readUInt16LE(end + 20) };
}

describe('build:zip output', () => {
  let buf;

  beforeAll(() => {
    execFileSync(process.execPath, [path.join(root, 'scripts/build-zip.mjs')], { cwd: root, stdio: 'pipe' });
    buf = fs.readFileSync(zipPath);
  }, 30000);

  // The package outgrew 64 KB before this was caught: the comment length was
  // written over the top half of the central directory offset, which only
  // reads back correctly while that offset fits in 16 bits.
  test('is larger than 64 KB, so the 32-bit offsets are really exercised', () => {
    expect(buf.length).toBeGreaterThan(0x10000);
  });

  test('the end record points exactly at the central directory', () => {
    const { dirOffset, dirSize, commentLength } = readArchive(buf);
    expect(commentLength).toBe(0);
    expect(dirOffset + dirSize).toBe(buf.length - 22);
  });

  test('every entry points at its own local header', () => {
    const { entries } = readArchive(buf);
    expect(entries.length).toBeGreaterThan(0);
    for (const { name, localOffset } of entries) {
      expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
      const nameLength = buf.readUInt16LE(localOffset + 26);
      expect(buf.toString('utf8', localOffset + 30, localOffset + 30 + nameLength)).toBe(name);
    }
  });
});
