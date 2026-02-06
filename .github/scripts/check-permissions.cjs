#!/usr/bin/env node

/**
 * Security Check: Minimal permissions in manifest.json
 * Verifies that only necessary permissions are requested
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: [],
  permissions: []
};

// Required permissions for the extension
const requiredPermissions = [
  'storage',
  'activeTab',
  'scripting',
  'alarms',
  'notifications'
];

// Optional but acceptable permissions
const acceptablePermissions = [
  'tabs',
  'webRequest'
];

// Dangerous permissions that require justification
const dangerousPermissions = [
  'cookies',
  'history',
  'management',
  'debugger',
  'privacy',
  'proxy',
  'webRequestBlocking',
  'geolocation',
  'clipboardWrite',
  'clipboardRead'
];

function checkManifest() {
  const manifestPath = path.join(process.cwd(), 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found!');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const permissions = manifest.permissions || [];
  const hostPermissions = manifest.host_permissions || [];

  results.permissions = permissions;

  console.log('📋 Current permissions:');
  permissions.forEach(p => console.log(`  - ${p}`));
  console.log('\n📡 Host permissions:');
  hostPermissions.forEach(p => console.log(`  - ${p}`));
  console.log('');

  // Check for dangerous permissions
  const foundDangerous = permissions.filter(p => dangerousPermissions.includes(p));
  if (foundDangerous.length > 0) {
    results.passed = false;
    results.warnings.push({
      severity: 'HIGH',
      type: 'Dangerous permissions',
      permissions: foundDangerous,
      message: 'These permissions are potentially dangerous and should be justified'
    });
  }

  // Check for unnecessary permissions
  const unnecessary = permissions.filter(p =>
    !requiredPermissions.includes(p) &&
    !acceptablePermissions.includes(p) &&
    !dangerousPermissions.includes(p)
  );

  if (unnecessary.length > 0) {
    results.warnings.push({
      severity: 'MEDIUM',
      type: 'Potentially unnecessary permissions',
      permissions: unnecessary,
      message: 'Review if these permissions are actually needed'
    });
  }

  // Check for overly broad host permissions
  const broadHosts = hostPermissions.filter(h =>
    h === '<all_urls>' || h === 'http://*/' || h === 'https://*/'
  );

  if (broadHosts.length > 0) {
    results.passed = false;
    results.warnings.push({
      severity: 'HIGH',
      type: 'Overly broad host permissions',
      permissions: broadHosts,
      message: 'Host permissions should be as specific as possible'
    });
  }

  // Verify required permissions are present
  const missing = requiredPermissions.filter(p => !permissions.includes(p));
  if (missing.length > 0) {
    results.warnings.push({
      severity: 'INFO',
      type: 'Missing expected permissions',
      permissions: missing,
      message: 'These permissions are typically needed for this extension'
    });
  }

  // Check CSP
  if (!manifest.content_security_policy) {
    results.warnings.push({
      severity: 'MEDIUM',
      type: 'Missing CSP',
      message: 'Content Security Policy should be defined in manifest'
    });
  }
}

console.log('🔍 Checking manifest.json permissions...\n');

try {
  checkManifest();

  if (results.warnings.length === 0) {
    console.log('✅ Permissions configuration looks good!\n');
    process.exit(0);
  } else {
    const high = results.warnings.filter(w => w.severity === 'HIGH');
    const medium = results.warnings.filter(w => w.severity === 'MEDIUM');
    const info = results.warnings.filter(w => w.severity === 'INFO');

    if (high.length > 0) {
      console.log('❌ HIGH severity issues:\n');
      for (const warning of high) {
        console.log(`  Type: ${warning.type}`);
        if (warning.permissions) {
          console.log(`  Permissions: ${warning.permissions.join(', ')}`);
        }
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM severity issues:\n');
      for (const warning of medium) {
        console.log(`  Type: ${warning.type}`);
        if (warning.permissions) {
          console.log(`  Permissions: ${warning.permissions.join(', ')}`);
        }
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    if (info.length > 0) {
      console.log('ℹ️  INFO:\n');
      for (const warning of info) {
        console.log(`  Type: ${warning.type}`);
        if (warning.permissions) {
          console.log(`  Permissions: ${warning.permissions.join(', ')}`);
        }
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    // Fail on HIGH severity issues
    process.exit(high.length > 0 ? 1 : 0);
  }
} catch (error) {
  console.error('❌ Error checking manifest permissions:', error.message);
  process.exit(1);
}
