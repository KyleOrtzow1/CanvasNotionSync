#!/usr/bin/env node

/**
 * Performance Check: Content script efficiency
 */

const fs = require('fs');
const path = require('path');

const results = {
  checks: [],
  warnings: []
};

function checkContentScript() {
  const contentPath = path.join(process.cwd(), 'content-script.js');

  if (!fs.existsSync(contentPath)) {
    console.log('⚠️  content-script.js not found');
    return;
  }

  const content = fs.readFileSync(contentPath, 'utf8');
  const lines = content.split('\n').length;
  const size = Buffer.byteLength(content, 'utf8');

  console.log(`  File size: ${size} bytes (${lines} lines)`);

  // Check file size (content scripts should be small)
  if (size > 50000) {
    results.warnings.push({
      severity: 'HIGH',
      message: `Content script is ${size} bytes - consider code splitting`
    });
  } else {
    results.checks.push({
      name: 'Content script size is reasonable',
      passed: true
    });
  }

  // Check for DOM queries (should be minimal)
  const domQueries = (content.match(/querySelector|getElementById|getElementsBy/g) || []).length;
  console.log(`  DOM queries: ${domQueries}`);

  if (domQueries > 20) {
    results.warnings.push({
      severity: 'MEDIUM',
      message: `${domQueries} DOM queries detected - consider caching selectors`
    });
  } else {
    results.checks.push({
      name: 'Reasonable number of DOM queries',
      passed: true
    });
  }

  // Check for mutation observers (good for reactive updates)
  if (content.includes('MutationObserver')) {
    results.checks.push({
      name: 'Uses MutationObserver for DOM changes',
      passed: true
    });
  }

  // Check for large inline data (should be in background)
  if (content.match(/const\s+\w+\s*=\s*{[^}]{500,}}/s)) {
    results.warnings.push({
      severity: 'MEDIUM',
      message: 'Large inline data structures - consider moving to background script'
    });
  }

  // Check for event delegation
  if (content.match(/addEventListener.*document|addEventListener.*window/)) {
    results.checks.push({
      name: 'Uses event delegation',
      passed: true
    });
  }
}

console.log('🔍 Checking content script efficiency...\n');

try {
  checkContentScript();

  if (results.checks.length > 0) {
    console.log('\nEfficiency checks:');
    results.checks.forEach(check => {
      console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    results.warnings.forEach(w => {
      console.log(`  [${w.severity}] ${w.message}`);
    });
  }

  console.log('\n✅ Content script efficiency check complete\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking content script:', error.message);
  process.exit(1);
}
