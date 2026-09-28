import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const handlers = fs.readFileSync(path.join(root, 'src/handlers/background-handlers.js'), 'utf8');

// The file list handleBackgroundSync passes to chrome.scripting.executeScript
// when a Canvas tab has no live content script (one opened before an update).
function injectedFiles() {
  const match = handlers.match(/executeScript\(\{[\s\S]*?files:\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('No executeScript files list found in background-handlers.js');
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, file]) => file);
}

describe('content script injection', () => {
  // A file the manifest loads but the injection list omits leaves one of its
  // globals undefined on the injected path, so the content script throws on
  // load and every popup and periodic sync on that tab fails until a refresh.
  test('injects exactly the manifest content scripts, in the same order', () => {
    expect(injectedFiles()).toEqual(manifest.content_scripts[0].js);
  });

  test('every injected file exists', () => {
    for (const file of injectedFiles()) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    }
  });
});
