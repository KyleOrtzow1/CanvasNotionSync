#!/usr/bin/env node

/**
 * Performance Check: Non-blocking operations
 * Verifies background operations don't block UI
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  warnings: [],
  filesScanned: 0
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);
  const fileName = path.basename(filePath);

  results.filesScanned++;

  // Check for synchronous operations in popup/content scripts
  if (fileName === 'popup.js' || fileName === 'content-script.js') {
    // Check for while loops (can block UI)
    const whileLoops = content.match(/while\s*\([^)]+\)\s*{/g);
    if (whileLoops) {
      results.warnings.push({
        severity: 'HIGH',
        type: 'Potentially blocking while loop in UI script',
        file: relativePath,
        message: 'While loops in UI scripts can freeze the interface',
        count: whileLoops.length
      });
    }

    // Check for synchronous XMLHttpRequest
    const syncXHR = content.match(/\.open\([^)]*,\s*false\s*\)/g);
    if (syncXHR) {
      results.passed = false;
      results.warnings.push({
        severity: 'CRITICAL',
        type: 'Synchronous XMLHttpRequest',
        file: relativePath,
        message: 'Synchronous XHR is deprecated and blocks the UI',
        count: syncXHR.length
      });
    }

    // Check for long synchronous operations
    const longLoops = content.match(/for\s*\([^)]+;\s*[^;]+<\s*\d{4,}[^)]*\)/g);
    if (longLoops) {
      results.warnings.push({
        severity: 'MEDIUM',
        type: 'Potentially long synchronous loop',
        file: relativePath,
        message: 'Large loops should be chunked or moved to web worker',
        count: longLoops.length
      });
    }
  }

  // Check for missing async/await in event handlers
  const eventHandlers = content.match(/addEventListener\([^,]+,\s*function[^{]*{[^}]+fetch[^}]+}/gs);
  if (eventHandlers) {
    for (const handler of eventHandlers) {
      if (!handler.includes('async') && !handler.includes('await')) {
        results.warnings.push({
          severity: 'MEDIUM',
          type: 'Event handler with fetch but no async/await',
          file: relativePath,
          message: 'Consider using async/await for cleaner error handling'
        });
        break; // Only report once per file
      }
    }
  }

  // Check for setTimeout(0) pattern (code smell for blocking)
  const setTimeout0 = content.match(/setTimeout\([^,]+,\s*0\s*\)/g);
  if (setTimeout0) {
    results.warnings.push({
      severity: 'LOW',
      type: 'setTimeout(0) usage',
      file: relativePath,
      message: 'setTimeout(0) is often used to work around blocking code',
      count: setTimeout0.length
    });
  }
}

function scanDirectory(dir, extensions = ['.js']) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        scanDirectory(filePath, extensions);
      }
    } else if (extensions.some(ext => file.endsWith(ext))) {
      scanFile(filePath);
    }
  }
}

console.log('🔍 Checking for blocking operations...\n');

try {
  scanDirectory(process.cwd());

  console.log(`📊 Scanned ${results.filesScanned} files\n`);

  if (results.warnings.length === 0) {
    console.log('✅ No blocking operations detected!\n');
    process.exit(0);
  } else {
    const critical = results.warnings.filter(w => w.severity === 'CRITICAL');
    const high = results.warnings.filter(w => w.severity === 'HIGH');
    const medium = results.warnings.filter(w => w.severity === 'MEDIUM');
    const low = results.warnings.filter(w => w.severity === 'LOW');

    if (critical.length > 0) {
      console.log('🚨 CRITICAL issues:\n');
      for (const warning of critical) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        if (warning.count) console.log(`  Count: ${warning.count}`);
        console.log('');
      }
    }

    if (high.length > 0) {
      console.log('❌ HIGH severity issues:\n');
      for (const warning of high) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        if (warning.count) console.log(`  Count: ${warning.count}`);
        console.log('');
      }
    }

    if (medium.length > 0) {
      console.log('⚠️  MEDIUM severity issues:\n');
      for (const warning of medium) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    if (low.length > 0) {
      console.log('ℹ️  Suggestions:\n');
      for (const warning of low) {
        console.log(`  File: ${warning.file}`);
        console.log(`  Type: ${warning.type}`);
        console.log(`  Message: ${warning.message}`);
        console.log('');
      }
    }

    console.log(`Total warnings: ${results.warnings.length}\n`);

    // Fail only on CRITICAL
    process.exit(critical.length > 0 ? 1 : 0);
  }
} catch (error) {
  console.error('❌ Error checking blocking operations:', error.message);
  process.exit(1);
}
