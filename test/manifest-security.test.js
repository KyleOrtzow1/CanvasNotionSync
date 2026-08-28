import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkManifestSecurity, ALLOWED_PERMISSIONS } from '../.github/scripts/check-manifest-security.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function baseManifest() {
  return {
    manifest_version: 3,
    name: 'Test Extension',
    version: '1.0.0',
    background: { service_worker: 'background.js', type: 'module' },
    content_scripts: [
      {
        matches: ['https://*.instructure.com/*', 'https://*.canvaslms.com/*'],
        js: ['content-script.js'],
        run_at: 'document_idle'
      }
    ],
    permissions: ['storage', 'activeTab', 'scripting', 'alarms', 'notifications'],
    host_permissions: ['https://*.instructure.com/*', 'https://*.canvaslms.com/*', 'https://api.notion.com/*'],
    action: { default_popup: 'popup.html', default_title: 'Test' },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src https://*.instructure.com https://*.canvaslms.com https://api.notion.com"
    }
  };
}

describe('checkManifestSecurity', () => {
  test('passes on a well-formed manifest', () => {
    expect(checkManifestSecurity(baseManifest())).toEqual([]);
  });

  test('passes on the repo\'s real manifest.json', () => {
    const manifestPath = path.join(__dirname, '..', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(checkManifestSecurity(manifest)).toEqual([]);
  });

  test('fails when host_permissions has an http:// entry', () => {
    const manifest = baseManifest();
    manifest.host_permissions.push('http://insecure.example.com/*');
    const errors = checkManifestSecurity(manifest);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('HTTPS check failed') && e.includes('http://insecure.example.com/*'))).toBe(
      true
    );
  });

  test('fails when host_permissions uses a wildcard scheme', () => {
    const manifest = baseManifest();
    manifest.host_permissions.push('*://wildcard.example.com/*');
    const errors = checkManifestSecurity(manifest);
    expect(errors.some((e) => e.includes('HTTPS check failed') && e.includes('*://wildcard.example.com/*'))).toBe(
      true
    );
  });

  test('fails when host_permissions grants <all_urls>', () => {
    const manifest = baseManifest();
    manifest.host_permissions.push('<all_urls>');
    const errors = checkManifestSecurity(manifest);
    expect(errors.some((e) => e.includes('HTTPS check failed') && e.includes('<all_urls>'))).toBe(true);
  });

  test('fails when permissions includes an un-allowlisted entry', () => {
    const manifest = baseManifest();
    manifest.permissions.push('tabs');
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some((e) => e.includes('Permissions check failed') && e.includes('"tabs"') && e.includes('allowlist'))
    ).toBe(true);
  });

  test('fails for each disallowed permission individually (webRequest, cookies, history)', () => {
    for (const perm of ['webRequest', 'cookies', 'history']) {
      const manifest = baseManifest();
      manifest.permissions.push(perm);
      const errors = checkManifestSecurity(manifest);
      expect(errors.some((e) => e.includes('Permissions check failed') && e.includes(`"${perm}"`))).toBe(true);
    }
  });

  test('the allowlist matches the plan exactly', () => {
    expect(ALLOWED_PERMISSIONS).toEqual(['storage', 'activeTab', 'scripting', 'alarms', 'notifications']);
  });

  test('fails when content_security_policy.extension_pages is missing', () => {
    const manifest = baseManifest();
    delete manifest.content_security_policy;
    const errors = checkManifestSecurity(manifest);
    expect(errors.some((e) => e.includes('CSP check failed') && e.includes('extension_pages is missing'))).toBe(
      true
    );
  });

  test('fails when script-src allows unsafe-inline', () => {
    const manifest = baseManifest();
    manifest.content_security_policy.extension_pages =
      "script-src 'self' 'unsafe-inline'; object-src 'self'; connect-src https://*.instructure.com https://*.canvaslms.com https://api.notion.com";
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some((e) => e.includes('CSP check failed') && e.includes('script-src') && e.includes("'unsafe-inline'"))
    ).toBe(true);
  });

  test('fails when script-src allows unsafe-eval', () => {
    const manifest = baseManifest();
    manifest.content_security_policy.extension_pages =
      "script-src 'self' 'unsafe-eval'; object-src 'self'; connect-src https://*.instructure.com https://*.canvaslms.com https://api.notion.com";
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some((e) => e.includes('CSP check failed') && e.includes('script-src') && e.includes("'unsafe-eval'"))
    ).toBe(true);
  });

  test('fails when script-src allows a remote origin', () => {
    const manifest = baseManifest();
    manifest.content_security_policy.extension_pages =
      "script-src 'self' https://evil.example.com; object-src 'self'; connect-src https://*.instructure.com https://*.canvaslms.com https://api.notion.com";
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some((e) => e.includes('CSP check failed') && e.includes('script-src') && e.includes('https://evil.example.com'))
    ).toBe(true);
  });

  test('fails when object-src is not exactly \'self\'', () => {
    const manifest = baseManifest();
    manifest.content_security_policy.extension_pages =
      "script-src 'self'; object-src 'none'; connect-src https://*.instructure.com https://*.canvaslms.com https://api.notion.com";
    const errors = checkManifestSecurity(manifest);
    expect(errors.some((e) => e.includes('CSP check failed') && e.includes('object-src'))).toBe(true);
  });

  test('fails when a content_scripts match host is missing from connect-src (the #36 class of bug)', () => {
    const manifest = baseManifest();
    // Mirrors #36: canvaslms.com is injected into but omitted from connect-src.
    manifest.content_security_policy.extension_pages =
      "script-src 'self'; object-src 'self'; connect-src https://*.instructure.com https://api.notion.com";
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some(
        (e) => e.includes('CSP check failed') && e.includes('*.canvaslms.com') && e.includes('connect-src')
      )
    ).toBe(true);
  });

  test('fails when a content_scripts match host is missing from host_permissions', () => {
    const manifest = baseManifest();
    manifest.host_permissions = ['https://*.instructure.com/*', 'https://api.notion.com/*'];
    const errors = checkManifestSecurity(manifest);
    expect(
      errors.some(
        (e) => e.includes('CSP check failed') && e.includes('*.canvaslms.com') && e.includes('host_permissions')
      )
    ).toBe(true);
  });

  test('reports multiple independent failures at once, not just the first', () => {
    const manifest = baseManifest();
    manifest.host_permissions.push('http://bad.example.com/*');
    manifest.permissions.push('tabs');
    const errors = checkManifestSecurity(manifest);
    expect(errors.some((e) => e.includes('HTTPS check failed'))).toBe(true);
    expect(errors.some((e) => e.includes('Permissions check failed'))).toBe(true);
  });

  test('does not throw on an empty/malformed manifest and reports failures instead', () => {
    expect(() => checkManifestSecurity({})).not.toThrow();
    const errors = checkManifestSecurity({});
    expect(errors.some((e) => e.includes('CSP check failed') && e.includes('extension_pages is missing'))).toBe(
      true
    );
  });
});
