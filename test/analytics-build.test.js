import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';

const repo = fileURLToPath(new URL('../', import.meta.url));
let fixture;
function checkout() {
  fixture = mkdtempSync(join(tmpdir(), 'canvas-analytics-'));
  mkdirSync(join(fixture, 'scripts'));
  for (const name of ['configure-analytics.mjs', 'build-zip.mjs']) {
    cpSync(join(repo, 'scripts', name), join(fixture, 'scripts', name));
  }
  for (const name of ['src', 'icons', 'manifest.json', 'package.json', 'background.js', 'content-script.js', 'popup.html', 'popup.js']) {
    cpSync(join(repo, name), join(fixture, name), { recursive: true });
  }
  return fixture;
}
afterEach(() => {
  if (!fixture) return;
  // Delete only the fresh fixture directly under the system temporary folder.
  if (dirname(resolve(fixture)) !== resolve(tmpdir()) || !basename(fixture).startsWith('canvas-analytics-')) {
    throw new Error('Unexpected fixture path');
  }
  rmSync(fixture, { recursive: true, force: true });
  fixture = undefined;
});

function run(script, env = {}) {
  return spawnSync(process.execPath, [join(fixture, 'scripts', script)], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, GA4_MEASUREMENT_ID: '', GA4_API_SECRET: '', GA4_DEBUG: '', ...env }
  });
}

// Read standard ZIP local file headers independently of the build script.
function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameSize = buffer.readUInt16LE(offset + 26);
    const extraSize = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameSize + extraSize;
    const name = buffer.subarray(offset + 30, offset + 30 + nameSize).toString();
    const bytes = buffer.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(bytes).toString() : bytes.toString());
    offset = start + size;
  }
  return entries;
}

describe('configured release package', () => {
  test('missing configuration fails without replacing the source config', () => {
    checkout();
    const configPath = join(fixture, 'src/utils/analytics-config.js');
    const original = readFileSync(configPath, 'utf8');
    const result = run('configure-analytics.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GA4_MEASUREMENT_ID');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  test('production configuration is packaged with the worker and no debug collection', () => {
    checkout();
    const env = { GA4_MEASUREMENT_ID: 'G-PACKAGE123', GA4_API_SECRET: 'test-package-secret' };
    const configured = run('configure-analytics.mjs', env);
    expect(configured.status).toBe(0);
    expect(configured.stdout + configured.stderr).not.toContain(env.GA4_API_SECRET);
    const built = run('build-zip.mjs');
    expect(built.status).toBe(0);
    const { version } = JSON.parse(readFileSync(join(fixture, 'package.json')));
    const entries = zipEntries(readFileSync(join(fixture, `canvas-notion-sync-v${version}.zip`)));
    expect(entries.get('src/utils/analytics-config.js')).toContain('"debug": false');
    expect(entries.get('src/utils/analytics-config.js')).toContain(env.GA4_MEASUREMENT_ID);
    expect(entries.get('src/utils/analytics.js')).toContain('https://www.google-analytics.com/mp/collect');
    expect(entries.get('background.js')).toContain('setupAnalytics();');
    expect([...entries.keys()].some(name => name.startsWith('test/') || name.startsWith('scripts/'))).toBe(false);
    const manifest = JSON.parse(entries.get('manifest.json'));
    expect(manifest.host_permissions).toContain('https://www.google-analytics.com/*');
    expect(manifest.content_security_policy.extension_pages).toContain('https://www.google-analytics.com');
    expect(manifest.content_scripts.some(script => script.matches.some(host => host.includes('google-analytics')))).toBe(false);
  });
});
