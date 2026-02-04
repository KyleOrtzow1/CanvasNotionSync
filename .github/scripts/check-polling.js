#!/usr/bin/env node

/**
 * Performance Check: No polling without purpose
 */

const fs = require('fs');
const path = require('path');

const results = {
  passed: true,
  issues: []
};

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check for setInterval (potential polling)
  const intervals = content.match(/setInterval\s*\(/g);
  if (intervals && intervals.length > 0) {
    // Check if it's for sync/polling
    if (content.match(/setInterval[^}]*fetch|setInterval[^}]*api/is)) {
      results.issues.push({
        severity: 'HIGH',
        file: relativePath,
        message: 'Found setInterval with API calls - prefer chrome.alarms for periodic tasks'
      });
      results.passed = false;
    }
  }

  // Check for chrome.alarms (good practice)
  if (content.includes('chrome.alarms')) {
    console.log(`  ✅ Using chrome.alarms in ${relativePath}`);
  }

  // Check for while(true) polling
  if (content.match(/while\s*\(\s*true\s*\)/)) {
    results.issues.push({
      severity: 'CRITICAL',
      file: relativePath,
      message: 'Found while(true) loop - potential infinite polling'
    });
    results.passed = false;
  }
}

console.log('🔍 Checking for unnecessary polling...\n');

try {
  const files = ['background.js', 'content-script.js', 'popup.js'];

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      scanFile(filePath);
    }
  }

  if (results.issues.length > 0) {
    console.log('\nPolling issues:');
    results.issues.forEach(issue => {
      console.log(`  [${issue.severity}] ${issue.file}: ${issue.message}`);
    });
    console.log('');
  }

  if (results.passed) {
    console.log('✅ No problematic polling detected!\n');
    process.exit(0);
  } else {
    console.log('❌ Polling issues found!\n');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error checking polling:', error.message);
  process.exit(1);
}
