#!/usr/bin/env node

/**
 * Security Check: Content Security Policy configuration
 * Verifies CSP is properly configured in manifest.json
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: []
};

function checkManifestCSP() {
  const manifestPath = path.join(process.cwd(), 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found!');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Check for CSP in manifest v3
  const csp = manifest.content_security_policy;

  if (!csp) {
    results.passed = false;
    results.warnings.push({
      severity: 'HIGH',
      message: 'No Content Security Policy defined in manifest.json'
    });
    return;
  }

  const cspString = typeof csp === 'string' ? csp :
                    (csp.extension_pages || csp.sandbox || '');

  console.log('Current CSP:', cspString);
  console.log('');

  // Check for unsafe-inline
  if (cspString.includes("'unsafe-inline'")) {
    results.warnings.push({
      severity: 'HIGH',
      message: "CSP contains 'unsafe-inline' which allows inline scripts"
    });
  }

  // Check for unsafe-eval
  if (cspString.includes("'unsafe-eval'")) {
    results.passed = false;
    results.warnings.push({
      severity: 'CRITICAL',
      message: "CSP contains 'unsafe-eval' which allows eval() and similar functions"
    });
  }

  // Check for wildcard sources
  if (cspString.includes('*') && !cspString.includes('https://*.instructure.com')) {
    results.warnings.push({
      severity: 'MEDIUM',
      message: 'CSP contains wildcard (*) sources which are too permissive'
    });
  }

  // Check for object-src
  if (!cspString.includes('object-src')) {
    results.warnings.push({
      severity: 'LOW',
      message: "Consider adding 'object-src' directive to CSP"
    });
  }

  // Good practices
  if (cspString.includes("default-src 'self'")) {
    console.log("✅ Good: CSP has restrictive default-src");
  }

  if (cspString.includes("script-src 'self'")) {
    console.log("✅ Good: CSP restricts script sources");
  }
}

console.log('🔍 Checking Content Security Policy...\n');

try {
  checkManifestCSP();

  if (results.warnings.length === 0) {
    console.log('\n✅ CSP configuration looks good!\n');
    process.exit(0);
  } else {
    console.log('\nCSP Issues:');

    const critical = results.warnings.filter(w => w.severity === 'CRITICAL');
    const high = results.warnings.filter(w => w.severity === 'HIGH');
    const medium = results.warnings.filter(w => w.severity === 'MEDIUM');
    const low = results.warnings.filter(w => w.severity === 'LOW');

    if (critical.length > 0) {
      console.log('\n🚨 CRITICAL:');
      critical.forEach(w => console.log(`  - ${w.message}`));
    }

    if (high.length > 0) {
      console.log('\n❌ HIGH:');
      high.forEach(w => console.log(`  - ${w.message}`));
    }

    if (medium.length > 0) {
      console.log('\n⚠️  MEDIUM:');
      medium.forEach(w => console.log(`  - ${w.message}`));
    }

    if (low.length > 0) {
      console.log('\nℹ️  LOW:');
      low.forEach(w => console.log(`  - ${w.message}`));
    }

    console.log('');
    process.exit(critical.length > 0 ? 1 : 0);
  }
} catch (error) {
  console.error('❌ Error checking CSP:', error.message);
  process.exit(1);
}
